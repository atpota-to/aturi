import Foundation

/// The page checker's logic, port of `src/lib/tools/page.ts`: what a web
/// page says about itself to the Atmosphere, read out of its HTML.
///
/// Two things matter to a client that is handed a link:
///
///   The link card. Clients draw one from the page's Open Graph tags
///   (`og:title`, `og:description`, `og:image`), falling back to the Twitter
///   card tags and the plain `<title>` and description where those are
///   missing.
///
///   The record behind the page. A page can say which atproto record it is a
///   view of with AT Tags, `<meta name="at:canonical" content="at://…">` and
///   its siblings, or with the older `<link href="at://…">` some publishing
///   tools write. The tags are parsed by `PageCheckerAtTags`; this adds the
///   ones that parser dropped, since a tag that is silently ignored is
///   exactly what someone debugging their page needs to see.
///
/// Pure: `PageCheckerClient` fetches the HTML and calls `readPage`.
public enum PageChecker {
    public enum Input: Hashable, Sendable {
        case ok(url: String)
        case invalid(String)

        public var url: String? {
            if case .ok(let url) = self { return url }
            return nil
        }

        public var reason: String? {
            if case .invalid(let reason) = self { return reason }
            return nil
        }
    }

    /// Tidy what was typed into an http(s) URL. A bare host gains `https://`,
    /// and the URL is written the way the WHATWG parser writes it back: the
    /// scheme and host in lower case, and an empty path as `/`.
    public static func normalizeUrl(_ raw: String) -> Input {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .invalid("Enter the address of a web page.") }
        let lower = value.lowercased()
        if lower.hasPrefix("at://") || lower.hasPrefix("did:") {
            return .invalid("That is an atproto identifier. Enter the address of a web page.")
        }
        if value.range(of: "^[a-z][a-z0-9+.-]*:", options: [.regularExpression, .caseInsensitive]) == nil {
            value = "https://" + value
        }
        guard var components = URLComponents(string: value), let scheme = components.scheme?.lowercased() else {
            return .invalid("That is not a well-formed URL.")
        }
        if scheme != "http" && scheme != "https" {
            return .invalid("Only http and https pages can be read.")
        }
        guard let host = components.host, !host.isEmpty else {
            return .invalid("That is not a well-formed URL.")
        }
        if !host.contains(".") {
            return .invalid("Enter a full address, such as https://example.com/post.")
        }
        components.scheme = scheme
        components.host = host.lowercased()
        if components.percentEncodedPath.isEmpty {
            components.percentEncodedPath = "/"
        }
        guard let url = components.url else {
            return .invalid("That is not a well-formed URL.")
        }
        return .ok(url: url.absoluteString)
    }

    // MARK: - What the read reports

    public struct OpenGraph: Hashable, Sendable {
        public var title: String?
        public var description: String?
        public var image: String?
        public var siteName: String?
        public var type: String?
        public var url: String?
    }

    public struct TwitterCard: Hashable, Sendable {
        public var card: String?
        public var title: String?
        public var description: String?
        public var image: String?
    }

    public struct Meta: Hashable, Sendable {
        /// The `<title>` element.
        public var title: String?
        /// `<meta name="description">`.
        public var description: String?
        /// `<link rel="canonical">`, as written.
        public var canonical: String?
        public var og: OpenGraph
        public var twitter: TwitterCard
    }

    /// An `at:` meta tag the parser dropped, and why.
    public struct IgnoredTag: Hashable, Sendable {
        public var name: String
        public var content: String
        public var reason: String
    }

    /// A `<link href="at://…">`, the convention that predates AT Tags.
    public struct HeadLink: Hashable, Sendable {
        public var rel: String?
        public var href: String
    }

    public struct Reading: Hashable, Sendable {
        public var meta: Meta
        public var tags: PageCheckerAtTags.Result
        /// The one record the page is about: `at:canonical`, then `at:alternate`.
        public var primary: String?
        public var ignored: [IgnoredTag]
        public var headLinks: [HeadLink]
    }

    public enum Report: Hashable, Sendable {
        case fetched(url: String, reading: Reading)
        /// The page could not be read as HTML: blocked, timed out, or not a web page.
        case unread(url: String)

        public var url: String {
            switch self {
            case .fetched(let url, _), .unread(let url): return url
            }
        }

        public var reading: Reading? {
            if case .fetched(_, let reading) = self { return reading }
            return nil
        }
    }

    // MARK: - Reading the HTML

    /// Nothing shown on the page needs more of a field than this.
    static let maxField = 600

    static func clean(_ value: String?) -> String? {
        guard let value else { return nil }
        let decoded = PageCheckerHTML.decodeEntities(value, nbsp: true)
        let text = decoded
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : ServiceFormat.clip(text, maxField)
    }

    /// Read everything the checker reports out of a page's HTML.
    public static func readPage(_ html: String) -> Reading {
        let bytes = Array(html.utf8)
        // The first value wins: a page that repeats og:image means the first
        // as its card image and the rest as alternates.
        var fields: [String: String] = [:]
        var ignored: [IgnoredTag] = []

        for tag in PageCheckerHTML.tags(named: "meta", in: bytes) {
            guard let rawName = PageCheckerHTML.attribute("property", in: tag) ?? PageCheckerHTML.attribute("name", in: tag) else { continue }
            let name = PageCheckerHTML.decodeEntities(rawName, nbsp: true).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = clean(PageCheckerHTML.attribute("content", in: tag))
            let key = name.lowercased()
            if let value, fields[key] == nil {
                fields[key] = value
            }
            if key.hasPrefix("at:") {
                let text = value ?? ""
                if PageCheckerAtTags.parseTagName(name) == nil {
                    ignored.append(IgnoredTag(
                        name: name,
                        content: text,
                        reason: "Not one of at:canonical, at:alternate, at:author or at:me, and not namespaced as at:{namespace}:{property}."
                    ))
                } else if !PageCheckerAtTags.isValidAtUri(text) {
                    ignored.append(IgnoredTag(name: name, content: text, reason: "The content is not a valid at:// URI."))
                }
            }
        }

        var canonical: String?
        var headLinks: [HeadLink] = []
        for tag in PageCheckerHTML.tags(named: "link", in: bytes) {
            guard let href = clean(PageCheckerHTML.attribute("href", in: tag)) else { continue }
            let rel = clean(PageCheckerHTML.attribute("rel", in: tag))
            if href.lowercased().hasPrefix("at://") {
                if !headLinks.contains(where: { $0.href == href }) {
                    headLinks.append(HeadLink(rel: rel, href: href))
                }
            } else if canonical == nil, let rel, rel.lowercased().split(separator: " ").contains("canonical") {
                canonical = href
            }
        }

        let parsed = PageCheckerAtTags.parse(html: html)
        func get(_ key: String) -> String? { fields[key] }
        let meta = Meta(
            title: clean(PageCheckerHTML.title(in: bytes)),
            description: get("description"),
            canonical: canonical,
            og: OpenGraph(
                title: get("og:title"),
                description: get("og:description"),
                image: get("og:image") ?? get("og:image:url") ?? get("og:image:secure_url"),
                siteName: get("og:site_name"),
                type: get("og:type"),
                url: get("og:url")
            ),
            twitter: TwitterCard(
                card: get("twitter:card"),
                title: get("twitter:title"),
                description: get("twitter:description"),
                image: get("twitter:image") ?? get("twitter:image:src")
            )
        )
        return Reading(
            meta: meta,
            tags: parsed,
            primary: PageCheckerAtTags.primaryRecord(parsed),
            ignored: ignored,
            headLinks: headLinks
        )
    }

    // MARK: - The link card

    public struct LinkCard: Hashable, Sendable {
        public var title: String?
        public var description: String?
        /// The image as an absolute URL, or nil when there is none to draw.
        public var image: String?
        /// The page's hostname, without `www.`.
        public var host: String
    }

    static func hostOf(_ url: String) -> String {
        guard let host = URL(string: url)?.host, !host.isEmpty else { return url }
        let lower = host.lowercased()
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }

    /// Resolve an image address against the page it came from. Nil when it cannot be.
    public static func absoluteImage(_ image: String?, pageUrl: String) -> String? {
        guard let image, !image.isEmpty, let base = URL(string: pageUrl) else { return nil }
        guard let url = URL(string: image, relativeTo: base)?.absoluteURL,
            let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https"
        else { return nil }
        return url.absoluteString
    }

    /// The card a client would draw: Open Graph first, then the fallbacks.
    public static func linkCard(_ reading: Reading, pageUrl: String) -> LinkCard {
        let meta = reading.meta
        return LinkCard(
            title: meta.og.title ?? meta.twitter.title ?? meta.title,
            description: meta.og.description ?? meta.twitter.description ?? meta.description,
            image: absoluteImage(meta.og.image ?? meta.twitter.image, pageUrl: pageUrl),
            host: hostOf(pageUrl)
        )
    }

    // MARK: - The records the page declares

    public struct DeclaredRecord: Hashable, Sendable, Identifiable {
        /// The tag as written, e.g. `at:canonical`, or `link` for the older form.
        public var name: String
        /// What the relation means, in a few words.
        public var meaning: String
        public var uri: String

        public var id: String { "\(name):\(uri)" }
    }

    static func relationMeaning(_ relation: PageCheckerAtTags.Relation) -> String {
        switch relation {
        case .canonical: return "The record this page is a view of"
        case .alternate: return "Another record with the same content"
        case .author: return "Who wrote it"
        case .me: return "The identity behind the site"
        }
    }

    public static func declaredRecords(_ reading: Reading) -> [DeclaredRecord] {
        var out: [DeclaredRecord] = []
        for relation in PageCheckerAtTags.Relation.allCases {
            for uri in reading.tags.uris(relation) {
                out.append(DeclaredRecord(name: "at:\(relation.rawValue)", meaning: relationMeaning(relation), uri: uri))
            }
        }
        for namespace in reading.tags.namespaces {
            for property in namespace.properties {
                for uri in property.uris {
                    out.append(DeclaredRecord(name: "at:\(namespace.name):\(property.name)", meaning: "A \(namespace.name) relation", uri: uri))
                }
            }
        }
        for link in reading.headLinks where !out.contains(where: { $0.uri == link.href }) {
            out.append(DeclaredRecord(
                name: link.rel.map { "link rel=\"\($0)\"" } ?? "link",
                meaning: "A link element, the convention before AT Tags",
                uri: link.href
            ))
        }
        return out
    }

    // MARK: - The check list

    private enum CheckID: String, CaseIterable {
        case fetch
        case title
        case description
        case image
        case tags
        case link

        var title: String {
            switch self {
            case .fetch: return "Page loads"
            case .title: return "Title"
            case .description: return "Description"
            case .image: return "Image"
            case .tags: return "AT Tags"
            case .link: return "Link element"
            }
        }
    }

    private static let order: [CheckID] = [.fetch, .title, .description, .image, .tags]

    private static func check(_ id: CheckID, _ status: ServiceCheckStatus, _ summary: String, detail: [String] = [], fix: [String] = []) -> ServiceCheck {
        ServiceCheck(id: id.rawValue, status: status, title: id.title, summary: summary, detail: detail, fix: fix)
    }

    /// Build the check list. `pending` means the fetch is still on its way;
    /// `failed` means it could not be made at all.
    public static func buildChecks(_ report: ServiceStep<Report>) -> [ServiceCheck] {
        let skipRest = order.dropFirst().map { check($0, .skip, "Not checked, because the page could not be read.") }
        let fetched: Report
        switch report {
        case .pending:
            return order.map { check($0, .pending, "Checking…") }
        case .failed:
            return [check(.fetch, .fail, "The lookup could not be made. Try again in a moment.")] + skipRest
        case .done(let done):
            fetched = done
        }
        guard case .fetched(let url, let reading) = fetched else {
            return [
                check(
                    .fetch,
                    .fail,
                    "The page could not be read as HTML. It may block automated requests, have timed out, or not be a web page.",
                    detail: ["GET \(fetched.url)"],
                    fix: ["A client building a link card fetches the page the same way, so a page that refuses this request gets no card either."]
                ),
            ] + skipRest
        }

        let meta = reading.meta
        var checks = [check(.fetch, .pass, "The page answered with HTML.", detail: ["GET \(url)"])]

        // Title
        if let title = meta.og.title {
            checks.append(check(.title, .pass, "og:title is set.", detail: [title]))
        } else if let fallback = meta.twitter.title ?? meta.title {
            let source = meta.twitter.title != nil ? "twitter:title" : "the page’s <title>, which often carries the site name as well"
            checks.append(check(
                .title,
                .warn,
                "No og:title. Clients fall back to \(source).",
                detail: [fallback],
                fix: ["Add <meta property=\"og:title\" content=\"…\"> with the title as it should read on a card."]
            ))
        } else {
            checks.append(check(
                .title,
                .fail,
                "The page has no title at all, so a card has nothing to show but the address.",
                fix: ["Add <meta property=\"og:title\" content=\"…\">, and a <title> element."]
            ))
        }

        // Description
        if let description = meta.og.description {
            checks.append(check(.description, .pass, "og:description is set.", detail: [description]))
        } else if let fallback = meta.twitter.description ?? meta.description {
            let source = meta.twitter.description != nil ? "twitter:description" : "the plain description meta tag"
            checks.append(check(
                .description,
                .warn,
                "No og:description. Clients that fall back read \(source); others show none.",
                detail: [fallback],
                fix: ["Add <meta property=\"og:description\" content=\"…\">."]
            ))
        } else {
            checks.append(check(
                .description,
                .warn,
                "No description. The card shows the title alone.",
                fix: ["Add <meta property=\"og:description\" content=\"…\"> with a sentence or two."]
            ))
        }

        // Image
        if let image = meta.og.image ?? meta.twitter.image {
            let lower = image.lowercased()
            if meta.og.image == nil {
                checks.append(check(
                    .image,
                    .warn,
                    "No og:image. There is a twitter:image, which only some clients read.",
                    detail: [image],
                    fix: ["Add <meta property=\"og:image\" content=\"…\"> with the same address."]
                ))
            } else if !lower.hasPrefix("https://") {
                checks.append(check(
                    .image,
                    .warn,
                    lower.hasPrefix("http://")
                        ? "og:image is a plain http address. Clients that fetch images over https only will not show it."
                        : "og:image is not an absolute address. A client that does not resolve it against the page shows no image.",
                    detail: [image],
                    fix: ["Give og:image as a full https URL."]
                ))
            } else {
                checks.append(check(.image, .pass, "og:image is an absolute https address.", detail: [image]))
            }
        } else {
            checks.append(check(.image, .info, "No og:image, so the card is drawn as text only."))
        }

        // AT Tags
        let tags = reading.tags
        var declared = tags.canonical.count + tags.alternate.count + tags.author.count + tags.me.count
        for namespace in tags.namespaces {
            for property in namespace.properties {
                declared += property.uris.count
            }
        }
        if !reading.ignored.isEmpty {
            let count = reading.ignored.count
            var beside = ""
            if declared > 0 {
                beside = ", beside \(declared) that \(declared == 1 ? "reads" : "read") correctly"
            }
            checks.append(check(
                .tags,
                .warn,
                "\(count == 1 ? "One at: tag is" : "\(count) at: tags are") ignored\(beside).",
                detail: reading.ignored.map { "\($0.name) = \($0.content.isEmpty ? "(empty)" : $0.content) → \($0.reason)" },
                fix: ["Each tag is <meta name=\"at:canonical\" content=\"at://<did>/<collection>/<rkey>\">, with a DID or handle as the authority."]
            ))
        } else if declared > 0 {
            let names = reading.primary == nil ? "" : ", and names the record it is a view of"
            checks.append(check(
                .tags,
                .pass,
                "The page declares \(declared == 1 ? "one at:// URI" : "\(declared) at:// URIs")\(names)."
            ))
        } else {
            checks.append(check(
                .tags,
                .info,
                reading.headLinks.isEmpty
                    ? "The page declares no at:// records. That only matters when there is a record behind it."
                    : "No at: meta tags. The page points at a record with a link element instead."
            ))
        }

        if !reading.headLinks.isEmpty {
            checks.append(check(
                .link,
                .info,
                "The page carries a <link> to an at:// URI, the convention some publishing tools used before AT Tags.",
                detail: reading.headLinks.map { link -> String in
                    let rel = link.rel.map { "rel=\"\($0)\" " } ?? ""
                    return "\(rel)\(link.href)"
                }
            ))
        }
        return checks
    }

    public static func verdict(_ report: ServiceStep<Report>, checks: [ServiceCheck]) -> ServiceVerdict {
        if report.isPending || checks.contains(where: { $0.status == .pending }) {
            return ServiceVerdict(tone: .pending, title: "Fetching the page", text: "Reading its Open Graph tags and at: meta tags.")
        }
        guard let reading = report.value?.reading else {
            return ServiceVerdict(
                tone: .fail,
                title: "This page could not be read",
                text: checks.first?.summary ?? "The page did not answer."
            )
        }
        if let failure = checks.first(where: { $0.status == .fail }) {
            return ServiceVerdict(tone: .fail, title: "This page gives a client nothing to draw", text: failure.summary)
        }
        let records = declaredRecords(reading).count
        let recordText = records == 0
            ? "It declares no at:// records."
            : "It declares \(records == 1 ? "one at:// URI" : "\(records) at:// URIs")."
        let warnings = checks.filter { $0.status == .warn }
        if let first = warnings.first {
            let things = warnings.count == 1 ? "one thing" : "\(warnings.count) things"
            return ServiceVerdict(
                tone: .warn,
                title: "The page has a link card, with \(things) to look at",
                text: "\(first.summary) \(recordText)"
            )
        }
        return ServiceVerdict(tone: .pass, title: "The page presents a complete link card", text: recordText)
    }

    /// The fields the page states, in the order the web's table lists them.
    public static func fields(_ reading: Reading) -> [(label: String, value: String)] {
        let meta = reading.meta
        let rows: [(String, String?)] = [
            ("og:title", meta.og.title),
            ("og:description", meta.og.description),
            ("og:image", meta.og.image),
            ("og:site_name", meta.og.siteName),
            ("og:type", meta.og.type),
            ("og:url", meta.og.url),
            ("twitter:card", meta.twitter.card),
            ("twitter:title", meta.twitter.title),
            ("twitter:description", meta.twitter.description),
            ("twitter:image", meta.twitter.image),
            ("<title>", meta.title),
            ("description", meta.description),
            ("canonical", meta.canonical),
        ]
        return rows.compactMap { row -> (label: String, value: String)? in
            guard let value = row.1 else { return nil }
            return (label: row.0, value: value)
        }
    }
}
