import Foundation

/// Reads a web page for the page checker, port of
/// `src/app/api/tools/page/route.ts` and the bounded fetch under it
/// (`src/utils/fetchPageHtml.ts`).
///
/// Returns what a client would learn from the page and nothing else: its
/// title, its Open Graph and Twitter card fields, its canonical link, and
/// the at:// records it declares. The fetch keeps the web's bounds: public
/// http(s) hosts only, every redirect hop checked, HTML only, a five-second
/// deadline and a 1MB cap. A page that cannot be read is an answer
/// (`.unread`), not an error, since "this page refuses to be fetched" is
/// itself what the checker is there to say.
///
/// The cap is generous because metadata does not always land in `<head>`: a
/// streaming framework flushes it whenever its data resolves, and on
/// aturi.to's own record pages `at:canonical` has been seen 300KB in. A body
/// cut off by the deadline or the cap is still read: the tags may well be in
/// the part that arrived.
public struct PageCheckerClient: Sendable {
    /// `PAGE_HTML_MAX_BYTES`.
    static let maxBytes = 1024 * 1024
    /// `PAGE_FETCH_TIMEOUT_MS`.
    static let timeout: TimeInterval = 5
    static let maxRedirects = 5
    /// Some atmosphere apps (Leaflet, Offprint, pckt) gate on the user agent;
    /// this one says plainly what is asking, and asks for HTML.
    static let userAgent = "Mozilla/5.0 (compatible; AturiApp/1.0; +https://aturi.to)"
    static let accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5"

    private let fetcher: ServiceFetcher
    private let slingshot: SlingshotClient

    public init(fetcher: ServiceFetcher = .shared, http: HTTPClient = .shared) {
        self.fetcher = fetcher
        slingshot = SlingshotClient(http: http)
    }

    /// The page's HTML, or nil when it could not be read as HTML.
    func fetchHTML(_ url: String) async -> String? {
        let answer: ServiceFetchResponse
        do {
            answer = try await fetcher.fetch(
                url,
                maxBytes: Self.maxBytes,
                timeout: Self.timeout,
                accept: Self.accept,
                maxRedirects: Self.maxRedirects,
                userAgent: Self.userAgent
            )
        } catch {
            return nil
        }
        guard (200..<300).contains(answer.status) else { return nil }
        let type = answer.contentType ?? ""
        guard type.range(of: "text/html|application/xhtml", options: [.regularExpression, .caseInsensitive]) != nil else {
            return nil
        }
        return answer.text
    }

    /// Fetch and read the page at `url` (already through `normalizeUrl`).
    public func read(_ url: String) async -> PageChecker.Report {
        guard let html = await fetchHTML(url) else { return .unread(url: url) }
        return .fetched(url: url, reading: PageChecker.readPage(html))
    }

    /// The record the page says it is a view of, for a look at it beside
    /// the page. Nil when Slingshot has no such record.
    public func record(_ uri: String) async -> FetchedRecord? {
        await slingshot.getRecordByUri(uri)
    }
}
