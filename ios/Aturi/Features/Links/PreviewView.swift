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
    @State private var originDecided = false
    /// The countdown runs at most once per page, however often the link
    /// re-resolves (pull to refresh sets `link` again).
    @State private var autoRedirectOffered = false

    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL
    @Environment(\.dismiss) private var dismiss

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
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                preview
                picker
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .background(theme.bgPrimary)
        .navigationTitle(model.link?.displayName ?? "Preview")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .safeAreaInset(edge: .bottom) { countdownBar }
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
            if openedFromLink, !autoRedirectOffered {
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
                .foregroundStyle(theme.textPrimary)
            Text("We tried to resolve \(components.identifier) as an Atmosphere handle and did not find anything. Try a different handle, DID or AT URI.")
                .font(.footnote)
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

    // MARK: Auto-redirect

    @ViewBuilder
    private var countdownBar: some View {
        if model.isAutoRedirectArmed, let name = model.autoRedirectTargetName {
            AutoRedirectCountdownBar(name: name, duration: LinkResolverModel.autoRedirectDelay, cancel: cancelCountdown)
        }
    }

    private func cancelCountdown() {
        guard model.isAutoRedirectArmed else { return }
        model.cancelAutoRedirect()
    }

    /* Only a preview that reached the Links tab without an in-app note was
       opened from outside: the router lands universal links there, while
       cards on the other tabs push onto their own stacks. */
    private func decideOrigin() {
        guard !originDecided else { return }
        originDecided = true
        let pushedInApp = LinkNavigation.consumeInAppPreview(components)
        openedFromLink = !pushedInApp && router?.selectedTab == .links
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
                        .font(.body.weight(.medium))
                        .foregroundStyle(theme.textPrimary)
                    Text("Your auto-redirect preference. Tap anywhere to stay.")
                        .font(.caption)
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
