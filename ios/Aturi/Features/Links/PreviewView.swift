import SwiftUI
import UIKit
import AturiCore

/// The universal-link page (`/profile/{handle}` and
/// `/profile/{handle}/{collection}/{rkey}` on the web): the preview card
/// for whatever the link names and the waypoint picker beneath it. Reads
/// the preferences store here and hands it to the screen, since a `@State`
/// model cannot be built from the environment.
struct PreviewView: View {
    let components: AtUriComponents

    @Environment(PreferencesStore.self) private var preferences

    init(components: AtUriComponents) {
        self.components = components
    }

    var body: some View {
        PreviewScreen(components: components, preferences: preferences)
    }
}

/// The page proper. The router pushes the same route for a pasted link, a
/// tapped card and an incoming universal link; only the last may open a
/// favourite client on its own, so the origin is settled on first
/// appearance from the note `LinkNavigation` leaves behind in-app pushes.
private struct PreviewScreen: View {
    let components: AtUriComponents

    @State private var model: LinkResolverModel
    /// Settled once, on first appearance.
    @State private var openedFromLink = false
    /// The incoming link carried `?stay=1`: show the picker, never count down.
    @State private var stayRequested = false
    @State private var originDecided = false
    /// The countdown runs at most once per page, however often the link
    /// re-resolves (pull to refresh sets `link` again).
    @State private var autoRedirectOffered = false
    /* Where the picker is, for the bar along the bottom edge (see
       `bottomBar`). The page's height is measured outside the bottom inset
       and the picker from the scroll view's top, so neither moves when the
       inset's content changes height. Until measured, the picker counts as
       on screen, so the scroll hint cannot flash on a page that has no need
       of it, as the web's starts. */
    @State private var pageHeight: CGFloat = .infinity
    @State private var pickerOnScreen = true
    @State private var scrolledPastHint = false

    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The scroll view's coordinate space, which the picker and the
    /// content measure themselves in.
    private static let scrollSpaceName = "preview-scroll"
    private static let scrollSpace = CoordinateSpace.named(PreviewScreen.scrollSpaceName)
    /// The picker's scroll target, for the hint's tap.
    private static let pickerAnchor = "waypoint-picker"
    /// How far the page scrolls before the hint is put away, the web's
    /// `window.scrollY > 150`.
    private static let hintScrollDistance: CGFloat = 150

    init(components: AtUriComponents, preferences: PreferencesStore) {
        self.components = components
        _model = State(initialValue: LinkResolverModel(preferences: preferences))
    }

    /* The model is fed the `at://` spelling rather than the aturi.to link:
       `extractAtUriComponents` reads any collection through it, while the
       `/profile/` form only names posts and lists. */
    private var input: String {
        if let collection = components.collection, let rkey = components.rkey,
           !collection.isEmpty, !rkey.isEmpty {
            return "at://\(components.identifier)/\(collection)/\(rkey)"
        }
        return "at://\(components.identifier)"
    }

    private var shareURL: URL? {
        model.link.flatMap { URL(string: $0.aturiLink) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    preview
                    picker
                        .id(Self.pickerAnchor)
                        .background { pickerPositionReader }
                }
                .background { scrollDistanceReader }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
            }
            .coordinateSpace(name: Self.scrollSpaceName)
            .safeAreaInset(edge: .bottom) { bottomBar(proxy) }
            .background { pageHeightReader }
        }
        .background(theme.bgPrimary)
        .navigationTitle(model.link?.displayName ?? "Preview")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        /* Any sign of life means the visitor is reading this page, not
           waiting to be sent elsewhere: a scroll or a tap anywhere stops the
           countdown, and the control underneath still gets its tap. */
        .simultaneousGesture(DragGesture(minimumDistance: 8).onChanged { _ in cancelCountdown() })
        .simultaneousGesture(TapGesture().onEnded { cancelCountdown() })
        .refreshable {
            await model.resolve(input)
        }
        .task(id: components) {
            /* Coming back after a push (a tapped card) must not restart a
               resolution that already settled; only a new input, or one that
               never started, warrants a load. */
            if model.input != input || model.state.isIdle {
                await model.resolve(input)
            }
        }
        .onAppear(perform: decideOrigin)
        .onChange(of: model.link) { _, link in
            guard let link else { return }
            RecentLinksStore.shared.record(input: link.aturiLink, label: link.displayName, detail: link.collection)
            if openedFromLink, !stayRequested, !autoRedirectOffered {
                autoRedirectOffered = true
                model.armAutoRedirect()
            }
        }
        .onChange(of: model.autoRedirectFired) { _, fired in
            guard fired != nil, let target = model.consumeAutoRedirect(), let url = URL(string: target.url) else { return }
            openURL(url)
        }
        .onDisappear {
            model.cancelAutoRedirect()
        }
    }

    // MARK: Preview card

    @ViewBuilder
    private var preview: some View {
        switch model.state {
        case .idle, .loading:
            SkeletonRows(count: 5)
                .padding(16)
                .cardBackground()
        case .failed(let message):
            ErrorPanel(message: message) {
                model.reload()
            }
        case .loaded(let loaded):
            switch loaded {
            case .post(let post, let parent):
                PostCardView(post: post, parent: parent)
            case .profile(let profile, _):
                ProfileCardView(profile: profile)
            case .record(let record, let identity):
                GenericRecordCardView(record: record, identity: identity)
            case .notFound:
                notFoundPanel
            case .unavailable(let message):
                EmptyState(title: "No preview", detail: message, systemImage: "eye.slash")
            }
        }
    }

    /// The web's 404: the handle definitively does not resolve. No picker.
    private var notFoundPanel: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Could not resolve", systemImage: "questionmark.circle")
                .aturiLabel()
                .foregroundStyle(theme.textAccent)
            Text("That handle did not resolve.")
                .font(AturiFont.title)
                .tracking(AturiFont.titleTracking)
                .foregroundStyle(theme.textPrimary)
            Text("We tried to resolve \(components.identifier) as an Atmosphere handle and did not find anything. Try a different handle, DID or AT URI.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button("Try another link") {
                    dismiss()
                }
                .buttonStyle(.aturiSecondary)
                if router != nil {
                    Button("Search in Explore") {
                        router?.popToRoot(.explore)
                        router?.select(.explore)
                    }
                    .buttonStyle(.aturiSecondary)
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    // MARK: Picker

    /* The identity resolves before the preview arrives, so the picker
       renders under the card's skeleton; a failed or not-found resolution
       has no identity and therefore no picker, as on the web. */
    @ViewBuilder
    private var picker: some View {
        if let link = model.link {
            WaypointPickerView(
                type: link.type,
                handle: link.handle,
                collection: link.collection,
                rkey: link.rkey,
                did: link.did,
                displayName: link.displayName,
                repoCollections: model.repoCollections,
                openedFromLink: openedFromLink
            )
        } else if model.state.isIdle || model.state.isLoading {
            SkeletonRows(count: 4)
                .padding(16)
                .cardBackground()
        }
    }

    // MARK: Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            HStack(spacing: 4) {
                if let shareURL {
                    ShareLink(item: shareURL) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share link")
                }
                Menu {
                    menuItems
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("More actions")
                .disabled(model.link == nil)
            }
        }
    }

    @ViewBuilder
    private var menuItems: some View {
        if let link = model.link {
            Button {
                UIPasteboard.general.string = link.aturiLink
            } label: {
                Label("Copy link", systemImage: "doc.on.doc")
            }
            Button {
                UIPasteboard.general.string = link.atUri
            } label: {
                Label("Copy AT URI", systemImage: "doc.on.doc")
            }
            if let route = Route(atUri: link.atUri) {
                Button {
                    LinkNavigation.open(route, router: router, openURL: openURL)
                } label: {
                    Label("Open in Explorer", systemImage: "binoculars")
                }
            }
            if let url = URL(string: link.aturiLink) {
                Button {
                    openURL(url)
                } label: {
                    Label("Open on aturi.to", systemImage: "safari")
                }
            }
        }
    }

    // MARK: Bottom edge

    /* The bottom edge holds one bar at a time. The countdown wins while it
       runs. Otherwise the remember bar stands there once the picker's top
       is on screen, as the web's sticks once the picker reaches the
       viewport, and until then the scroll hint does, put away after a
       short scroll; on the web the two share that spot too. */
    @ViewBuilder
    private func bottomBar(_ proxy: ScrollViewProxy) -> some View {
        if model.isAutoRedirectArmed, let name = model.autoRedirectTargetName {
            AutoRedirectCountdownBar(name: name, duration: LinkResolverModel.autoRedirectDelay, cancel: cancelCountdown)
        } else if model.link != nil {
            if pickerOnScreen {
                WaypointRememberBar()
            } else if !scrolledPastHint {
                PickerScrollHint {
                    scrollToPicker(proxy)
                }
            }
        }
    }

    private func scrollToPicker(_ proxy: ScrollViewProxy) {
        withAnimation(AturiMotion.animation(AturiMotion.soft(AturiMotion.arrive), reduceMotion: reduceMotion)) {
            proxy.scrollTo(Self.pickerAnchor, anchor: .top)
        }
    }

    /// Whether the picker's top edge has come up past the page's bottom
    /// edge, measured from the scroll view's top.
    private var pickerPositionReader: some View {
        GeometryReader { geometry in
            let onScreen = geometry.frame(in: Self.scrollSpace).minY < pageHeight
            Color.clear
                .onChange(of: onScreen, initial: true) { _, value in
                    pickerOnScreen = value
                }
        }
    }

    /// Whether the content has scrolled far enough to put the hint away.
    private var scrollDistanceReader: some View {
        GeometryReader { geometry in
            let scrolled = geometry.frame(in: Self.scrollSpace).minY < -Self.hintScrollDistance
            Color.clear
                .onChange(of: scrolled, initial: true) { _, value in
                    scrolledPastHint = value
                }
        }
    }

    /// The page's height, bottom inset included.
    private var pageHeightReader: some View {
        GeometryReader { geometry in
            Color.clear
                .onChange(of: geometry.size.height, initial: true) { _, height in
                    pageHeight = height
                }
        }
    }

    // MARK: Auto-redirect

    private func cancelCountdown() {
        guard model.isAutoRedirectArmed else { return }
        model.cancelAutoRedirect()
    }

    /* Only a preview the router noted as incoming, and that nothing in the
       app noted as its own push, was opened from outside. Both notes are
       consumed here, so neither outlives this page. */
    private func decideOrigin() {
        guard !originDecided else { return }
        originDecided = true
        let pushedInApp = LinkNavigation.consumeInAppPreview(components)
        let incoming = LinkNavigation.consumeIncomingPreview(components)
        stayRequested = LinkNavigation.consumeStay(components)
        openedFromLink = incoming && !pushedInApp
    }
}

/// The bar pinned to the bottom while the auto-redirect countdown runs:
/// what is about to open, a way to stay, and a draining line so the wait
/// is legible. Pinned rather than placed in the picker so it is on screen
/// however tall the preview card above turns out to be.
private struct AutoRedirectCountdownBar: View {
    let name: String
    let duration: TimeInterval
    let cancel: () -> Void

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale
    @State private var remaining: CGFloat = 1

    var body: some View {
        VStack(spacing: 0) {
            GeometryReader { proxy in
                Rectangle()
                    .fill(theme.accent)
                    .frame(width: proxy.size.width * remaining)
            }
            .frame(height: 3)
            .accessibilityHidden(true)
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Opening in \(name)")
                        .font(AturiFont.sans(.body, weight: .medium))
                        .foregroundStyle(theme.textPrimary)
                    Text("Your auto-redirect preference. Tap anywhere to stay.")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textSecondary)
                }
                Spacer(minLength: 0)
                Button("Stay here", action: cancel)
                    .buttonStyle(.aturiSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
        }
        .background(theme.bgElevated)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(theme.borderSubtle)
                .frame(height: AturiTheme.hairline(displayScale: displayScale))
        }
        .onAppear {
            withAnimation(.linear(duration: duration)) {
                remaining = 0
            }
        }
    }
}

/// The web's "Scroll to choose an app" pill (`ScrollIndicator.tsx`): there
/// while a tall preview keeps the picker below the fold, and a tap scrolls
/// to the picker. Floats on a clear strip, so the page shows around it.
private struct PickerScrollHint: View {
    let action: () -> Void

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.down")
                Text("Scroll to choose an app")
            }
            .font(AturiFont.sans(.caption, weight: .semibold))
            .foregroundStyle(theme.textSecondary)
            .padding(.leading, 10)
            .padding(.trailing, 14)
            .frame(minHeight: 32)
            .background(theme.bgSecondary, in: Capsule())
            .overlay(Capsule().strokeBorder(theme.borderMedium, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
            .shadow(color: Color.black.opacity(0.12), radius: 8, y: 2)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
        .padding(.bottom, 12)
    }
}
