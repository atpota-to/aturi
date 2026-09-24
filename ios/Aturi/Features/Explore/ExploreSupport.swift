import SwiftUI
import AturiCore

/// The explorer's trail: PDS host, repo, collection, rkey. Every segment
/// before the last pushes its own page; the last one is the page the
/// visitor is on, so it is plain text rather than a link to itself.
struct ExploreBreadcrumb: View {
    private struct Segment: Identifiable {
        let id: String
        let label: String
        let route: Route?
        let systemImage: String?
    }

    let identity: IdentityBundle?
    /// The identifier the route was opened with, shown until the identity
    /// resolves (and instead of it when resolution fails).
    let repo: String
    var collection: String? = nil
    var rkey: String? = nil

    @Environment(\.aturiTheme) private var theme

    init(identity: IdentityBundle?, repo: String, collection: String? = nil, rkey: String? = nil) {
        self.identity = identity
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
    }

    private var segments: [Segment] {
        var out: [Segment] = []
        let repoValue = identity.map { $0.handle ?? $0.did } ?? repo
        let repoLabel = identity.flatMap(\.handle).map { "@\($0)" } ?? repoValue
        if let identity {
            let host = PDSServer.pdsHostname(identity.pds)
            out.append(Segment(id: "pds", label: host, route: .pds(host: host), systemImage: "server.rack"))
        }
        out.append(Segment(id: "repo", label: repoLabel, route: .repo(repoValue), systemImage: nil))
        if let collection, !collection.isEmpty {
            out.append(Segment(id: "collection", label: collection, route: .collection(repo: repoValue, collection: collection), systemImage: nil))
            if let rkey, !rkey.isEmpty {
                out.append(Segment(id: "rkey", label: rkey, route: .record(repo: repoValue, collection: collection, rkey: rkey), systemImage: nil))
            }
        }
        return out
    }

    var body: some View {
        let segments = segments
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(segments.enumerated()), id: \.element.id) { index, segment in
                    if index > 0 {
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(theme.textTertiary)
                    }
                    if index < segments.count - 1, let route = segment.route {
                        NavigationLink(value: route) {
                            segmentLabel(segment, current: false)
                        }
                        .buttonStyle(.plain)
                    } else {
                        segmentLabel(segment, current: true)
                    }
                }
            }
            .padding(.vertical, 2)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Location")
    }

    private func segmentLabel(_ segment: Segment, current: Bool) -> some View {
        HStack(spacing: 4) {
            if let systemImage = segment.systemImage {
                Image(systemName: systemImage)
                    .font(.caption2)
                    .foregroundStyle(theme.textTertiary)
            }
            Text(segment.label)
                .font(AturiFont.monoSmall)
                .lineLimit(1)
                .truncationMode(.middle)
                .foregroundStyle(current ? theme.textPrimary : theme.textAccent)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

/// The explorer's "that did not resolve" panel: a small-caps eyebrow, a
/// serif headline and the resolver's own words, with a retry when the
/// failure might be transient.
struct ExploreNotFoundPanel: View {
    let eyebrow: String
    let headline: String
    let message: String
    var retry: (() -> Void)? = nil

    @Environment(\.aturiTheme) private var theme

    init(eyebrow: String, headline: String, message: String, retry: (() -> Void)? = nil) {
        self.eyebrow = eyebrow
        self.headline = headline
        self.message = message
        self.retry = retry
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(eyebrow, systemImage: "questionmark.circle")
                .aturiLabel()
                .foregroundStyle(theme.textAccent)
            Text(headline)
                .font(AturiFont.title)
                .foregroundStyle(theme.textPrimary)
            Text(message)
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if let retry {
                Button("Retry", action: retry)
                    .buttonStyle(.aturiSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

/// The in-page filter box the list screens share: narrows what has been
/// fetched, never fetches by itself.
struct ExploreFilterField: View {
    let placeholder: String
    @Binding var text: String
    let label: String

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    init(_ placeholder: String, text: Binding<String>, label: String) {
        self.placeholder = placeholder
        self._text = text
        self.label = label
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        HStack(spacing: 8) {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
            TextField(placeholder, text: $text)
                .font(AturiFont.monoSmall)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityLabel(label)
            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(theme.textTertiary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Clear filter")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(theme.bgTertiary, in: shape)
        .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}

/// The quiet text switch under a section (rich preview, JSON views, the
/// profile card): the web's `ViewSwitchButton`.
struct ExploreTextSwitch: View {
    let label: String
    let action: () -> Void

    @Environment(\.aturiTheme) private var theme

    init(_ label: String, action: @escaping () -> Void) {
        self.label = label
        self.action = action
    }

    var body: some View {
        Button(label, action: action)
            .font(.caption)
            .foregroundStyle(theme.textTertiary)
            .buttonStyle(.plain)
    }
}

/// A waypoint that can open the page on screen, with its URL built.
struct WaypointOpenTarget: Identifiable, Hashable {
    let waypoint: Waypoint
    let url: String

    var id: String { waypoint.id }

    /// The user's picker groups for a type, flattened in their order with
    /// duplicates dropped, narrowed to waypoints that build a URL for the
    /// target. The catalog's recommendations move to the front so the row
    /// leads with the client most likely to be wanted.
    static func targets(
        type: WaypointType,
        prefs: Preferences,
        handle: String,
        collection: String?,
        rkey: String?,
        did: String?
    ) -> [WaypointOpenTarget] {
        var seen = Set<String>()
        var out: [WaypointOpenTarget] = []
        for group in Personalize.personalizeCategorized(prefs, type: type) {
            for waypoint in group.waypoints where !seen.contains(waypoint.id) {
                guard let url = waypoint.url(handle: handle, collection: collection, rkey: rkey, did: did) else { continue }
                seen.insert(waypoint.id)
                out.append(WaypointOpenTarget(waypoint: waypoint, url: url))
            }
        }
        let recommendedIds = WaypointCatalog.recommended(for: type, collection: collection).waypoints.map(\.id)
        let recommended = recommendedIds.compactMap { id in out.first { $0.id == id } }
        let rest = out.filter { !recommendedIds.contains($0.id) }
        return recommended + rest
    }
}

/// "Open in": the first target as the one filled button, the rest as a
/// scrolling row of marks. Opening leaves the app through `openURL`, so an
/// installed client's universal links take over when it has any.
struct WaypointOpenRow: View {
    let targets: [WaypointOpenTarget]
    var title: String = "Open in"

    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(targets: [WaypointOpenTarget], title: String = "Open in") {
        self.targets = targets
        self.title = title
    }

    var body: some View {
        if let featured = targets.first {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader(title)
                Button {
                    open(featured.url)
                } label: {
                    HStack(spacing: 8) {
                        WaypointMark(id: featured.id, size: 18)
                        Text("Open in \(featured.waypoint.name)")
                    }
                }
                .buttonStyle(.aturiPrimary)
                .accessibilityHint("Opens outside the app")
                if targets.count > 1 {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(targets.dropFirst()) { target in
                                Button {
                                    open(target.url)
                                } label: {
                                    HStack(spacing: 6) {
                                        WaypointMark(id: target.id, size: 16)
                                        Text(target.waypoint.name)
                                            .lineLimit(1)
                                    }
                                }
                                .buttonStyle(.aturiSecondary)
                                .accessibilityLabel("Open in \(target.waypoint.name)")
                                .accessibilityHint("Opens outside the app")
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
    }

    private func open(_ string: String) {
        guard let url = URL(string: string) else { return }
        openURL(url)
    }
}

/// A small line chart of counts, the lexicon strips' sparkline. Drawn with
/// a `Path` so it costs nothing beyond the points; a flat series draws a
/// baseline rather than nothing.
struct UsageSparkline: View {
    let data: [Int]
    let label: String

    @Environment(\.aturiTheme) private var theme

    init(data: [Int], label: String) {
        self.data = data
        self.label = label
    }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let maxValue = max(data.max() ?? 0, 1)
            let count = max(data.count - 1, 1)
            Path { path in
                for (index, value) in data.enumerated() {
                    let x = size.width * CGFloat(index) / CGFloat(count)
                    let y = size.height - size.height * CGFloat(value) / CGFloat(maxValue)
                    if index == 0 {
                        path.move(to: CGPoint(x: x, y: y))
                    } else {
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                }
            }
            .stroke(theme.accent, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
        }
        .frame(width: 90, height: 24)
        .accessibilityLabel(label)
    }
}

/// Where a `SearchDestination` goes on iOS. Pages the app models push on
/// the router; index pages (`/explore/lexicons`) select their tab through
/// the deep-link grammar; anything else opens the aturi.to page.
enum ExploreNavigator {
    @MainActor
    static func open(_ destination: SearchDestination, router: AppRouter, openURL: OpenURLAction) {
        if let route = Route(destination: destination) {
            router.open(route)
            return
        }
        let link = Endpoints.aturiBase.absoluteString + destination.explorePath
        if router.handle(string: link) { return }
        if let url = URL(string: link) {
            openURL(url)
        }
    }
}
