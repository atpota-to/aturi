import SwiftUI
import Observation
import UIKit
import AturiCore

// The share sheet's picker: the shared link, read with AturiCore alone, and
// the person's waypoint groups from the app group suite. Deliberately
// lighter than the app's Links tab: no preview card, no layout toggle and
// no brand marks (the extension bundle does not carry the Waypoints asset
// catalog), just the rows needed to hand the link somewhere. Nothing here
// depends on the app target, so the extension links only AturiCore.

// MARK: - Target

/// What the shared text named, once `extractAtUriComponents` accepted it.
/// `handle` and `did` start as whatever the input spelled and are filled in
/// as the identity resolves, so the rows render before the network answers.
struct ShareTarget: Hashable {
    /// The shared text, trimmed to the token that parsed.
    let original: String
    let components: AtUriComponents
    let parsed: ParsedURI
    let type: WaypointType
    var handle: String
    var did: String?

    var collection: String? { parsed.collection }
    var rkey: String? { parsed.rkey }

    /// "@alice.test", or a shortened DID when that is all we know.
    var subjectName: String {
        AturiCore.displayName(handle: handle, did: did)
    }

    /// `getContextText`: the line above the rows.
    var contextText: String {
        switch type {
        case .post: return "Open post by \(subjectName) on"
        case .profile: return "Open profile for \(subjectName) on"
        case .list: return "Open list by \(subjectName) on"
        case .record: return "Open record from \(subjectName) on"
        case .unknown: return "Open content from \(subjectName) on"
        }
    }

    /// The aturi.to universal link: what "Copy link" copies and what the
    /// web's share button hands out.
    var aturiLink: String {
        generateAturiLink(AtUriComponents(identifier: handle, collection: collection, rkey: rkey))
    }

    /* The app's `aturi://open?url=` grammar is narrower than
       `extractAtUriComponents`: it routes at:// URIs, aturi.to pages and
       the reverse-parsed hosts, and needs a scheme. A bare handle or DID,
       or a universal `/did:plc:.../collection/rkey` path on a host the
       reverse parsers do not know, would be refused and the tap would do
       nothing, so those are handed over as their aturi.to link, which the
       app always places. Recognised input goes through verbatim so the app
       still knows which client it came from. */
    var appHandoffLink: String {
        if original.hasPrefix("at://") { return original }
        if matchSupportedUrl(string: original) != nil { return original }
        if let host = URLComponents(string: original)?.host?.lowercased(),
           host == Endpoints.aturiHost || host == "www." + Endpoints.aturiHost {
            return original
        }
        return aturiLink
    }

    /// `aturi://open?url=<encoded>`. Only unreserved characters are left
    /// bare so the app's query parser (split on `&` and `=`, then
    /// `removingPercentEncoding`) gets the link back byte for byte,
    /// whatever the wrapped link contains.
    var appHandoffURL: URL? {
        let unreserved = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
        guard let encoded = appHandoffLink.addingPercentEncoding(withAllowedCharacters: unreserved) else { return nil }
        return URL(string: "aturi://open?url=\(encoded)")
    }
}

/// A waypoint that can open the target, with its URL built.
struct ShareWaypointRow: Identifiable, Hashable {
    let id: String
    let name: String
    /// The host the link lands on; the row's right-hand column.
    let host: String
    let url: String
    /// The catalog's one-line description, read out as the row's hint.
    let detail: String
}

/// One section of rows: the recommended row or one of the person's groups.
struct ShareWaypointGroup: Identifiable, Hashable {
    let id: String
    let name: String
    let rows: [ShareWaypointRow]
}

// MARK: - Model

/// State for the sheet: what was shared, what it resolved to, and the
/// transient feedback the controller and the copy button post.
@MainActor
@Observable
final class SharePickerModel {
    enum Phase: Hashable {
        /// The item provider has not answered yet.
        case waiting
        case ready(ShareTarget)
        /// The text names nothing Aturi understands; `reason` says why.
        case unrecognised(text: String, reason: String)
        /// Nothing usable was shared at all.
        case empty
    }

    /// Feedback shown above the rows, cleared on its own.
    struct Notice: Hashable {
        let title: String
        let detail: String?
    }

    /// Prefixed so it can never collide with a user group id.
    static let recommendedGroupId = "share:recommended"
    /// Must match the app's `Appearance.storageKey`; both sides read the
    /// app group suite so the sheet paints the way the app does.
    static let appearanceKey = "aturi.appearance"
    /// Matches the web's copy feedback (`setTimeout(..., 2000)`).
    static let copiedDuration: TimeInterval = 2
    /// A notice with a sentence under it needs longer to be read.
    static let noticeDuration: TimeInterval = 6
    static let unrecognisedReason = "Aturi opens links from Bluesky and other Atmosphere apps, aturi.to pages, handles, DIDs and at:// URIs."
    /// How many whitespace-separated tokens of a text share are tried for a
    /// link before giving up; a shared paragraph rarely hides one deeper.
    static let tokenScanLimit = 32

    private(set) var phase: Phase = .waiting
    private(set) var notice: Notice?
    /// True for a beat after "Copy link"; the button relabels itself.
    private(set) var linkCopied = false
    let preferences: PreferencesStore
    /// Dark or light when the app's appearance setting forces one; nil
    /// follows the system, as the app does.
    let forcedScheme: SwiftUI.ColorScheme?

    @ObservationIgnored private let identity: IdentityResolver
    @ObservationIgnored private var resolveTask: Task<Void, Never>?
    @ObservationIgnored private var noticeTask: Task<Void, Never>?
    @ObservationIgnored private var copiedTask: Task<Void, Never>?

    /// - Parameters:
    ///   - preferences: defaults to the app group suite, so the groups are
    ///     the ones arranged in the app.
    ///   - identity: the resolver used for the one lookup the sheet makes.
    init(preferences: PreferencesStore? = nil, identity: IdentityResolver = .shared) {
        self.preferences = preferences ?? PreferencesStore()
        self.identity = identity
        switch PreferencesStore.appGroupDefaults().string(forKey: SharePickerModel.appearanceKey) {
        case "dark": forcedScheme = .dark
        case "light": forcedScheme = .light
        default: forcedScheme = nil
        }
    }

    var target: ShareTarget? {
        if case .ready(let target) = phase { return target }
        return nil
    }

    // MARK: Input

    /// The shared item, or nil when the provider gave nothing usable.
    func receive(_ text: String?) {
        resolveTask?.cancel()
        resolveTask = nil
        let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmed.isEmpty else {
            phase = .empty
            return
        }
        guard let (token, rawComponents) = SharePickerModel.extract(from: trimmed) else {
            phase = .unrecognised(text: trimmed, reason: SharePickerModel.unrecognisedReason)
            return
        }
        var components = rawComponents
        // The pages strip a presentation-only `@` before resolving.
        if components.identifier.hasPrefix("@") {
            components.identifier.removeFirst()
        }
        let parsed = parseURI(handle: components.identifier, collection: components.collection, rkey: components.rkey)
        if let error = parsed.error {
            phase = .unrecognised(text: trimmed, reason: error)
            return
        }
        let target = ShareTarget(
            original: token,
            components: components,
            parsed: parsed,
            type: WaypointType(rawValue: parsed.type.rawValue) ?? .unknown,
            handle: parsed.handle,
            did: parsed.did
        )
        phase = .ready(target)
        resolveIdentity(for: target)
    }

    /* A share from a text field often wraps the link in a sentence
       ("look at this https://bsky.app/..."), which the extractor refuses
       as a whole. The whole text is tried first so a lone link or handle
       keeps its exact spelling; then each token, first hit wins. */
    private static func extract(from text: String) -> (String, AtUriComponents)? {
        if let components = extractAtUriComponents(text) {
            return (text, components)
        }
        let tokens = text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).prefix(tokenScanLimit)
        for token in tokens {
            let candidate = String(token)
            if let components = extractAtUriComponents(candidate) {
                return (candidate, components)
            }
        }
        return nil
    }

    /* One lookup, never a preview: waypoints build their URLs from both
       the handle and the DID, so whichever half the input lacked is
       fetched and the rows are rebuilt when it lands. Nothing is hidden
       while waiting; a row that needs the missing half simply appears
       then, and the DID input is shown by its handle once known, as the
       app's pages do. */
    private func resolveIdentity(for target: ShareTarget) {
        resolveTask = Task { [weak self, identity = self.identity] in
            var resolved = target
            if let did = target.did {
                guard let handle = await identity.resolveDIDHandle(did) else { return }
                resolved.handle = handle
            } else {
                guard let did = await identity.resolveHandle(target.handle) else { return }
                resolved.did = did
            }
            guard !Task.isCancelled, let self, self.target?.original == target.original else { return }
            self.phase = .ready(resolved)
        }
    }

    /// Stop the lookup (the sheet is going away).
    func cancelResolution() {
        resolveTask?.cancel()
        resolveTask = nil
    }

    // MARK: Rows

    /// The recommended row first, then the person's groups in their order,
    /// each narrowed to waypoints that can build a URL for the target and
    /// dropped when nothing is left, as the app's picker does.
    var groups: [ShareWaypointGroup] {
        guard let target else { return [] }
        let prefs = preferences.prefs
        var result: [ShareWaypointGroup] = []

        let recommended = WaypointCatalog.recommended(for: target.type, collection: target.collection)
        let recommendedRows = rows(for: Personalize.personalizeRecommended(recommended.waypoints, prefs: prefs), target: target)
        if !recommendedRows.isEmpty {
            result.append(ShareWaypointGroup(id: SharePickerModel.recommendedGroupId, name: recommended.label, rows: recommendedRows))
        }

        for group in Personalize.personalizeCategorized(prefs, type: target.type) {
            let groupRows = rows(for: group.waypoints, target: target)
            guard !groupRows.isEmpty else { continue }
            result.append(ShareWaypointGroup(id: group.category.id, name: group.category.name, rows: groupRows))
        }
        return result
    }

    /* Duplicate ids within one group can only come from a hand-edited
       preferences record, but `ForEach` keys on the id, so they are
       dropped rather than trusted. */
    private func rows(for waypoints: [Waypoint], target: ShareTarget) -> [ShareWaypointRow] {
        var seen = Set<String>()
        return waypoints.compactMap { waypoint -> ShareWaypointRow? in
            guard seen.insert(waypoint.id).inserted,
                  let url = waypoint.url(handle: target.handle, collection: target.collection, rkey: target.rkey, did: target.did)
            else { return nil }
            return ShareWaypointRow(
                id: waypoint.id,
                name: waypoint.name,
                host: SharePickerModel.host(of: url, waypointId: waypoint.id),
                url: url,
                detail: waypoint.describe(collection: target.collection)
            )
        }
    }

    /// The host a row's link lands on, minus a leading `www.`. Waypoint
    /// URLs can carry `at://` in their paths, which Foundation's parser
    /// refuses, so the catalog's probed host is the fallback (custom
    /// waypoints have no catalog entry and read as no host).
    private static func host(of url: String, waypointId: String) -> String {
        var host = URLComponents(string: url)?.host?.lowercased()
            ?? WaypointCatalog.host(of: waypointId)?.lowercased()
            ?? ""
        if host.hasPrefix("www.") {
            host.removeFirst(4)
        }
        return host
    }

    // MARK: Feedback

    /// "Copy link": the aturi.to universal link, the one form that opens
    /// this same picker anywhere.
    func copyLink() {
        guard let target else { return }
        UIPasteboard.general.string = target.aturiLink
        linkCopied = true
        copiedTask?.cancel()
        copiedTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(SharePickerModel.copiedDuration))
            guard !Task.isCancelled else { return }
            self?.linkCopied = false
        }
    }

    /// What goes on the pasteboard when a URL could not be opened: the
    /// aturi.to link for the app handoff (an `aturi://` string is useless
    /// pasted anywhere else), the row's own link otherwise.
    func fallbackLink(for url: URL) -> String {
        if let target, url == target.appHandoffURL {
            return target.aturiLink
        }
        return url.absoluteString
    }

    /// Post feedback above the rows; a title alone lasts the web's two
    /// seconds, a title with a sentence long enough to read it.
    func showNotice(_ title: String, detail: String? = nil) {
        notice = Notice(title: title, detail: detail)
        let duration = detail == nil ? SharePickerModel.copiedDuration : SharePickerModel.noticeDuration
        noticeTask?.cancel()
        noticeTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(duration))
            guard !Task.isCancelled else { return }
            self?.notice = nil
        }
    }
}

// MARK: - Palette

/// The app's palette rebuilt from `AturiCore.Palette`, since the extension
/// cannot link the app target's `AturiTheme`. Only the tokens the sheet
/// draws with are exposed.
struct SharePalette: Equatable {
    let palette: Palette

    init(scheme: AturiCore.ColorScheme, isDark: Bool) {
        palette = scheme.palette(dark: isDark)
    }

    var bgPrimary: Color { SharePalette.color(palette.bgPrimary) }
    var bgSecondary: Color { SharePalette.color(palette.bgSecondary) }
    /// `--accent-moss`: the tint.
    var accent: Color { SharePalette.color(palette.accentMoss) }
    var textPrimary: Color { SharePalette.color(palette.textPrimary) }
    var textSecondary: Color { SharePalette.color(palette.textSecondary) }
    var textTertiary: Color { SharePalette.color(palette.textTertiary) }
    var textAccent: Color { SharePalette.color(palette.textAccent) }

    /// The palette is covered by a drift test, so an unparseable token only
    /// happens for hand-typed input; it paints a neutral grey rather than
    /// nothing.
    private static func color(_ hex: String) -> Color {
        guard let rgb = Palette.rgb(fromHex: hex) else {
            return Color(.sRGB, red: 0.5, green: 0.5, blue: 0.5, opacity: 1)
        }
        return Color(.sRGB, red: Double(rgb.red) / 255, green: Double(rgb.green) / 255, blue: Double(rgb.blue) / 255, opacity: 1)
    }
}

private struct SharePaletteKey: EnvironmentKey {
    static let defaultValue = SharePalette(scheme: .default, isDark: true)
}

extension EnvironmentValues {
    /// The resolved palette, read as `@Environment(\.sharePalette)`.
    var sharePalette: SharePalette {
        get { self[SharePaletteKey.self] }
        set { self[SharePaletteKey.self] = newValue }
    }
}

// MARK: - View

/// The sheet's content. `open` hands a URL to the controller (which walks
/// the responder chain); `finish` completes the extension request.
struct SharePickerView: View {
    let model: SharePickerModel
    let open: (URL) -> Void
    let finish: () -> Void

    @Environment(\.colorScheme) private var systemScheme

    init(model: SharePickerModel, open: @escaping (URL) -> Void, finish: @escaping () -> Void) {
        self.model = model
        self.open = open
        self.finish = finish
    }

    private var palette: SharePalette {
        let isDark = (model.forcedScheme ?? systemScheme) == .dark
        return SharePalette(scheme: model.preferences.prefs.colorScheme, isDark: isDark)
    }

    var body: some View {
        NavigationStack {
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(palette.bgPrimary.ignoresSafeArea())
                .navigationTitle("Open with")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel", action: finish)
                    }
                }
        }
        .tint(palette.accent)
        .preferredColorScheme(model.forcedScheme)
        .environment(\.sharePalette, palette)
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .waiting:
            ProgressView("Reading the shared link")
                .foregroundStyle(palette.textSecondary)
        case .empty:
            ShareMessage(
                title: "Nothing to open",
                text: nil,
                detail: "Share a link or some text that contains an Atmosphere URL, a handle or an at:// URI."
            )
        case .unrecognised(let text, let reason):
            ShareMessage(title: "Not an Atmosphere link", text: text, detail: reason)
        case .ready(let target):
            picker(for: target)
        }
    }

    private func picker(for target: ShareTarget) -> some View {
        List {
            if let notice = model.notice {
                Section {
                    ShareNoticeRow(notice: notice)
                }
                .listRowBackground(palette.bgSecondary)
            }

            Section {
                Button {
                    if let url = target.appHandoffURL {
                        open(url)
                    }
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "arrow.up.forward.app")
                            .font(.title3)
                            .foregroundStyle(palette.textAccent)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Open in Aturi")
                                .font(.body.weight(.semibold))
                                .foregroundStyle(palette.textPrimary)
                            Text("Preview, explore and every waypoint")
                                .font(.footnote)
                                .foregroundStyle(palette.textSecondary)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(palette.textTertiary)
                            .accessibilityHidden(true)
                    }
                }
                .disabled(target.appHandoffURL == nil)
                .accessibilityHint("Opens the Aturi app")
            } header: {
                Text(target.contextText)
                    .font(.subheadline)
                    .foregroundStyle(palette.textSecondary)
                    .textCase(nil)
            }
            .listRowBackground(palette.bgSecondary)

            let groups = model.groups
            if groups.isEmpty {
                Section {
                    Text(LinkResolverModel.noWaypointsMessage)
                        .font(.footnote)
                        .foregroundStyle(palette.textSecondary)
                }
                .listRowBackground(palette.bgSecondary)
            } else {
                ForEach(groups) { group in
                    Section {
                        ForEach(group.rows) { row in
                            ShareWaypointRowView(row: row) {
                                if let url = URL(string: row.url) {
                                    open(url)
                                }
                            }
                        }
                    } header: {
                        Text(group.name)
                            .foregroundStyle(group.id == SharePickerModel.recommendedGroupId ? palette.textAccent : palette.textTertiary)
                    }
                    .listRowBackground(palette.bgSecondary)
                }
            }

            Section {
                Button(action: model.copyLink) {
                    Label(model.linkCopied ? "Copied" : "Copy link", systemImage: model.linkCopied ? "checkmark" : "doc.on.doc")
                        .foregroundStyle(model.linkCopied ? palette.textAccent : palette.textPrimary)
                }
                .accessibilityLabel(model.linkCopied ? "Copied" : "Copy aturi.to link")
                Text(target.aturiLink)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(palette.textTertiary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            } footer: {
                Text("The aturi.to link opens this same picker on any device.")
                    .foregroundStyle(palette.textTertiary)
            }
            .listRowBackground(palette.bgSecondary)
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
    }
}

/// One line per waypoint: symbol, name, host. The brand marks live in the
/// app's asset catalog, which the extension does not carry, so every row
/// shares one outbound symbol.
private struct ShareWaypointRowView: View {
    let row: ShareWaypointRow
    let action: () -> Void

    @Environment(\.sharePalette) private var palette

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "arrow.up.right.square")
                    .foregroundStyle(palette.textSecondary)
                    .accessibilityHidden(true)
                Text(row.name)
                    .font(.body)
                    .foregroundStyle(palette.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(row.host)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(palette.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .accessibilityLabel("Open in \(row.name)")
        .accessibilityHint(row.detail)
    }
}

/// Feedback above the rows: a copy, or a host that refused to open a link.
private struct ShareNoticeRow: View {
    let notice: SharePickerModel.Notice

    @Environment(\.sharePalette) private var palette

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.circle")
                .foregroundStyle(palette.textAccent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(notice.title)
                    .font(.body.weight(.medium))
                    .foregroundStyle(palette.textPrimary)
                if let detail = notice.detail {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(palette.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The empty and error states: a serif title, the offending text when
/// there is one, and a sentence of explanation. Cancel lives in the bar.
private struct ShareMessage: View {
    let title: String
    let text: String?
    let detail: String

    @Environment(\.sharePalette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(.title2, design: .serif))
                .foregroundStyle(palette.textPrimary)
            if let text, !text.isEmpty {
                Text(text)
                    .font(.system(.footnote, design: .monospaced))
                    .foregroundStyle(palette.textSecondary)
                    .lineLimit(4)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            Text(detail)
                .font(.footnote)
                .foregroundStyle(palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
