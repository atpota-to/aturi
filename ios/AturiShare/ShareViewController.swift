import UIKit
import SwiftUI
import UniformTypeIdentifiers

/*
 Opening the chosen link from a share extension
 ==============================================

 Why the responder chain

 The extension is built with APPLICATION_EXTENSION_API_ONLY, so
 `UIApplication.shared` and `open(_:options:completionHandler:)` are
 unavailable to it, at compile time and at run time. The obvious
 replacement, `NSExtensionContext.open(_:completionHandler:)`, is only
 honoured by Today widgets and a few other extension points; in a share
 extension it calls back with `false` and nothing happens.

 What does work: the extension's view controllers sit in a responder chain
 that ends in the host application's `UIApplication`, which still
 implements the `openURL:` selector. Walking `UIResponder.next` until
 something responds to that selector and calling `perform(_:with:)` hands
 the URL to the host app, which asks the system to open it (the `aturi`
 scheme lands in the app; an https link lands in Safari or in whichever
 app claims it as a universal link). Everything involved is public API:
 `UIResponder.next`, `NSObject.responds(to:)` / `perform(_:with:)`, and
 `openURL:`, a deprecated but public UIApplication method.

 What App Review has historically accepted

 This responder-chain form is the pattern "open in" and password-manager
 share extensions have shipped with for years, and it has been accepted
 in review: no private symbols, no selector that is not in the public
 UIKit headers. The variant that reaches `UIApplication.sharedApplication`
 through `NSClassFromString` and key-value coding has drawn rejections
 under guideline 2.5.1 (private API), so it is deliberately not used
 here. Treat the trick as best effort all the same: a host is free not to
 forward the selector, and nothing forwards it when the sheet is shown
 without an app behind it. `open(_:)` therefore falls back to copying the
 link and saying so, and never leaves the person with a dead tap.
 */

/// The share extension's principal class (named in Info.plist as
/// `$(PRODUCT_MODULE_NAME).ShareViewController`). It reads the shared
/// item, hosts `SharePickerView` and owns the two things SwiftUI cannot
/// do from inside an extension: opening a URL and completing the request.
final class ShareViewController: UIViewController {
    private let model = SharePickerModel()
    /// Set once a URL has been handed off, so a second tap while the sheet
    /// is closing does not open twice.
    private var isFinishing = false

    /// Completing the request tears the extension down; doing it in the
    /// same turn as the `openURL:` call has been seen to cancel the open
    /// on some hosts, so the request waits a beat.
    private static let handoffDelay: TimeInterval = 0.4

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        embedPicker()
        loadSharedItem()
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        model.cancelResolution()
    }

    private func embedPicker() {
        let picker = SharePickerView(
            model: model,
            open: { [weak self] url in self?.open(url) },
            finish: { [weak self] in self?.finish() }
        )
        let host = UIHostingController(rootView: picker)
        addChild(host)
        host.view.translatesAutoresizingMaskIntoConstraints = false
        host.view.backgroundColor = .clear
        view.addSubview(host.view)
        NSLayoutConstraint.activate([
            host.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            host.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            host.view.topAnchor.constraint(equalTo: view.topAnchor),
            host.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])
        host.didMove(toParent: self)
    }

    // MARK: Shared item

    /// The first web URL, else the first plain text, across every input
    /// item. Safari shares both (the page URL and its title as text), so
    /// the URL wins; a text-only share still gets scanned for a link.
    private func loadSharedItem() {
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        let providers = items.flatMap { $0.attachments ?? [] }
        let candidates: [UTType] = [.url, .plainText, .text]
        for type in candidates {
            guard let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(type.identifier) }) else { continue }
            provider.loadItem(forTypeIdentifier: type.identifier, options: nil) { [weak self] item, _ in
                let text = ShareViewController.text(from: item)
                Task { @MainActor in
                    self?.model.receive(text)
                }
            }
            return
        }
        model.receive(nil)
    }

    /// Providers hand a URL back as `NSURL` or as its data, and text as
    /// `NSString`, `NSAttributedString` or UTF-8 data, depending on the
    /// host app; every spelling reduces to a string here. Runs on the
    /// provider's queue, hence nonisolated.
    private nonisolated static func text(from item: NSSecureCoding?) -> String? {
        if let url = item as? URL {
            return url.absoluteString
        }
        if let string = item as? String {
            return string
        }
        if let attributed = item as? NSAttributedString {
            return attributed.string
        }
        if let data = item as? Data {
            if let url = URL(dataRepresentation: data, relativeTo: nil), url.scheme != nil {
                return url.absoluteString
            }
            return String(data: data, encoding: .utf8)
        }
        return nil
    }

    // MARK: Opening

    /// Hand a URL to the host app through the responder chain (see the
    /// note at the top). On success the request completes shortly after,
    /// so the sheet closes behind the app switch; when no responder takes
    /// it the link goes to the pasteboard instead and the sheet stays.
    func open(_ url: URL) {
        guard !isFinishing else { return }
        if openThroughResponderChain(url) {
            isFinishing = true
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(ShareViewController.handoffDelay))
                self?.finish()
            }
            return
        }
        UIPasteboard.general.string = model.fallbackLink(for: url)
        model.showNotice("Copied", detail: "This app does not let the share sheet open links. Paste it in Aturi or Safari to continue.")
    }

    private func openThroughResponderChain(_ url: URL) -> Bool {
        let selector = Selector(("openURL:"))
        var responder: UIResponder? = self
        while let current = responder {
            if current.responds(to: selector) {
                current.perform(selector, with: url)
                return true
            }
            responder = current.next
        }
        return false
    }

    /// Complete the request with nothing returned: the sheet closes, and
    /// the host app carries on. Used for Cancel as well as after an open.
    func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
