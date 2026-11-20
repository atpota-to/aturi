import SafariServices
import os.log

/// The principal class of both Safari web extension targets
/// (`NSExtensionPrincipalClass` in AturiSafari/iOS/Info.plist and
/// AturiSafari/macOS/Info.plist). Safari hands it what the extension's
/// JavaScript sends with `browser.runtime.sendNativeMessage`, which needs the
/// `nativeMessaging` permission. The manifest does not ask for it, so today
/// nothing arrives here. It answers with an echo, as Xcode's template does,
/// so a future native call starts from a working round trip.
///
/// SFExtensionProfileKey is iOS 17 and macOS 14, the deployment floors of
/// both targets, so neither key needs an availability check.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]
        /* The Safari profile the message came from. Logged so a future
           native feature can tell profiles apart; os_log keeps both values
           private in release logs. */
        let profile = request?.userInfo?[SFExtensionProfileKey] as? UUID

        os_log(
            .default,
            "Native message from the Aturi web extension: %@ (profile %@)",
            String(describing: message),
            profile?.uuidString ?? "none"
        )

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["echo": message as Any]]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
