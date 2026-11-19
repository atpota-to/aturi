import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// The state behind src/components/tools/XrpcConsole.tsx: pick an atproto
// query, fill in its parameters from the lexicon, send it, read the
// response. The logic is `XrpcConsole`; this holds the state and does the IO.
//
// The request is what the link says. A request that arrives by link is sent
// on its own only when it is whole: the lexicon is in hand, every required
// parameter has a value and there is a host to ask. Choosing a method from
// the list is not a request to send it, even when it takes no parameters, so
// those requests are remembered as unsent until Send is pressed. The web
// pushes each sent request onto the browser's history; the app keeps the
// page and updates it in place, and the share button carries the request.
//
// No signed-in mode, as on the web: a method that needs a session answers
// 401 and the response says why.

/// Where a method's parameters were read from.
public enum XrpcLexiconSource: String, Hashable, Sendable {
    /// The lexicon record the method's authority published.
    case published
    /// The copy in the atproto repository.
    case repository
    /// Nowhere: only the index's parameter names are known.
    case names

    /// `SOURCE_NOTE`, shown for everything but a published lexicon.
    public var note: String? {
        switch self {
        case .published: return nil
        case .repository: return "Parameters are read from the lexicon in the atproto repository."
        case .names: return "This method\u{2019}s lexicon could not be found, so its parameters are plain text fields."
        }
    }
}

/// `MethodLexicon`: what the form is built from.
public struct XrpcMethodLexicon: Hashable, Sendable {
    public let paramSet: XrpcParamSet
    public let summary: XrpcLexiconSummary?
    public let description: String
    public let source: XrpcLexiconSource

    public init(paramSet: XrpcParamSet, summary: XrpcLexiconSummary?, description: String, source: XrpcLexiconSource) {
        self.paramSet = paramSet
        self.summary = summary
        self.description = description
        self.source = source
    }
}

/// What came back from a request (`ConsoleResult`).
public struct XrpcConsoleResult: Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        /// No response at all: the host is down or refused the connection.
        case network
        /// A response whose body is not text: `com.atproto.sync.getRepo`
        /// answers with a whole repository, a blob with a file.
        case binary
        /// A body over the 2 MB the console reads, which was not kept.
        case tooLarge
        /// A response whose body was read: JSON, or anything textual.
        case text
    }

    public let kind: Kind
    /// The address the request was sent to.
    public let url: String
    /// The host it went to, which for a PDS is only known once the account is resolved.
    public let origin: String
    public var status: Int?
    /// Milliseconds from sending to the last byte.
    public var ms: Double
    public var contentType: String?
    public var bytes: Int?
    public var text: String
    /// The parsed body, or nil when it is not JSON.
    public var json: JSONValue?
    /// `RateLimit-Remaining`, where the host sends it.
    public var rateRemaining: String?

    public init(
        kind: Kind,
        url: String,
        origin: String,
        status: Int? = nil,
        ms: Double = 0,
        contentType: String? = nil,
        bytes: Int? = nil,
        text: String = "",
        json: JSONValue? = nil,
        rateRemaining: String? = nil
    ) {
        self.kind = kind
        self.url = url
        self.origin = origin
        self.status = status
        self.ms = ms
        self.contentType = contentType
        self.bytes = bytes
        self.text = text
        self.json = json
        self.rateRemaining = rateRemaining
    }

    public var isOK: Bool {
        guard let status else { return false }
        return (200..<300).contains(status)
    }

    /// The host part of `url`, for the section's heading.
    public var host: String {
        URL(string: url)?.host ?? "The host"
    }

    /// The failure the body names, when the status is one.
    public var failure: XrpcFailure? {
        isOK ? nil : XrpcConsole.readXrpcFailure(json)
    }

    /// `200 OK`, or `400 Bad Request: InvalidRequest`.
    public var title: String {
        let line = status.map(XrpcConsole.statusLine) ?? ""
        if let failure { return "\(line): \(failure.error)" }
        return line
    }

    /// The timing, size, type and rate line under the status.
    public var facts: String {
        var parts = [XrpcConsole.formatDuration(ms)]
        if let bytes { parts.append(XrpcConsole.formatBytes(bytes)) }
        if let type = contentType?.split(separator: ";").first {
            parts.append(type.trimmingCharacters(in: .whitespaces))
        }
        if let rateRemaining, !rateRemaining.isEmpty { parts.append("\(rateRemaining) requests left") }
        return parts.joined(separator: " \u{00B7} ")
    }

    /// The host's message, the lexicon's word on the error it named, and
    /// what the failure most likely means, as sentences.
    public func explanation(summary: XrpcLexiconSummary?) -> String {
        guard !isOK, let status else { return "" }
        var text = ""
        if let message = failure?.message { text += XrpcConsole.sentence(message) }
        if let error = failure?.error, let named = summary?.errors.first(where: { $0.name == error }), let description = named.description {
            text += XrpcConsole.sentence(description)
        }
        if let hint = XrpcConsole.failureHint(status: status, error: failure?.error) { text += hint + " " }
        return text.trimmingCharacters(in: .whitespaces)
    }
}

/// What is being edited, before Send makes it the request (`Draft`).
public struct XrpcConsoleDraft: Hashable, Sendable {
    public var host: XrpcHostChoice
    public var acct: String
    public var url: String
    public var params: XrpcParamValues

    public init(host: XrpcHostChoice, acct: String = "", url: String = "", params: XrpcParamValues = [:]) {
        self.host = host
        self.acct = acct
        self.url = url
        self.params = params
    }

    public init(_ request: XrpcConsoleRequest) {
        self.init(host: request.host, acct: request.acct, url: request.url, params: request.params)
    }
}

/// A whole request to try, as the link would hold it (`EXAMPLES`).
public struct XrpcConsoleExample: Hashable, Sendable, Identifiable {
    public var id: String { search }
    public let label: String
    public let search: String
}

/// A problem with the request itself, not with what the host did.
public struct XrpcConsoleError: Error, Hashable, Sendable {
    public let message: String
}

@MainActor
@Observable
public final class XrpcConsoleModel {
    /// Whole requests to try. Each is complete, so picking one sends it.
    public nonisolated static let examples: [XrpcConsoleExample] = [
        XrpcConsoleExample(label: "getProfile", search: "method=app.bsky.actor.getProfile&p.actor=bsky.app"),
        XrpcConsoleExample(
            label: "listRecords",
            search: "method=com.atproto.repo.listRecords&p.repo=bsky.app&p.collection=app.bsky.feed.post&p.limit=3"
        ),
        XrpcConsoleExample(label: "getAuthorFeed", search: "method=app.bsky.feed.getAuthorFeed&p.actor=bsky.app&p.limit=5"),
        XrpcConsoleExample(label: "listHosts", search: "method=com.atproto.sync.listHosts&p.limit=5"),
    ]

    /// Matches offered under the field while a method is open.
    public nonisolated static let popoverLimit = 8
    /// Matches listed on the page while none is.
    public nonisolated static let searchLimit = 60

    /// A found lexicon is kept an hour, which keeps stepping between
    /// methods quick; a miss five minutes, since the lookups underneath
    /// answer a network failure the way they answer "not there".
    private nonisolated static let foundLexicons = TTLCache<String, XrpcMethodLexicon>(ttl: 60 * 60)
    private nonisolated static let missingLexicons = TTLCache<String, XrpcMethodLexicon>(ttl: 5 * 60)

    /// Every query the console lists.
    public let methods: [XrpcMethod]
    /// The request the page shows: what the link said, or the last one sent.
    public private(set) var request: XrpcConsoleRequest
    /// The form, before Send.
    public var draft: XrpcConsoleDraft
    /// The method field's text.
    public var methodQuery: String
    public private(set) var lexicon: Loadable<XrpcMethodLexicon> = .idle
    public private(set) var run: Loadable<XrpcConsoleResult> = .idle

    @ObservationIgnored private let http: HTTPClient
    @ObservationIgnored private let cachesLexicons: Bool
    @ObservationIgnored private var started = false
    /// Requests made by choosing a method, which are not sent until asked.
    @ObservationIgnored private var unsent = Set<String>()
    /// The request Send was last pressed on, which runs whether or not it is whole.
    @ObservationIgnored private var forced: String?
    @ObservationIgnored private var lexiconFor: String?
    @ObservationIgnored private var lexiconTask: Task<Void, Never>?
    @ObservationIgnored private var runKey: String?
    @ObservationIgnored private var runTask: Task<Void, Never>?

    /// `cachesLexicons` shares found lexicons between screens for an hour;
    /// tests turn it off so one test's answers do not leak into the next.
    public init(
        request: XrpcConsoleRequest = .empty,
        http: HTTPClient = .shared,
        methods: [XrpcMethod] = XrpcMethodIndex.methods,
        cachesLexicons: Bool = true
    ) {
        self.request = request
        draft = XrpcConsoleDraft(request)
        methodQuery = request.method
        self.http = http
        self.cachesLexicons = cachesLexicons
        self.methods = XrpcConsole.queries(from: methods)
    }

    /// The console for a `/tools/xrpc?…` link.
    public convenience init(query: [String: String], http: HTTPClient = .shared) {
        self.init(request: XrpcConsole.request(from: NetworkToolQuery.items(from: query)), http: http)
    }

    /// On first appear: look the linked method up, and send the request when
    /// it is whole.
    public func start() {
        guard !started else { return }
        started = true
        navigate(to: request, mode: .ifComplete)
    }

    // MARK: Derived

    public var methodValid: Bool {
        XrpcConsole.looksLikeMethodNsid(request.method)
    }

    public var paramSet: XrpcParamSet? {
        lexicon.value?.paramSet
    }

    public var specs: [XrpcParamSpec] {
        paramSet?.specs ?? []
    }

    public var lexiconKnown: Bool {
        paramSet?.source == .lexicon
    }

    /// A lexicon that says the method is something other than a query: a
    /// procedure typed in by hand.
    public var notAQuery: String? {
        guard let type = lexicon.value?.summary?.type, type != "query" else { return nil }
        return type
    }

    /// The fields to draw: the method's parameters, then any extras.
    public var fields: [XrpcParamSpec] {
        XrpcConsole.withExtraParams(specs, values: draft.params)
    }

    /// Required parameters still empty, once the lexicon says which.
    public var missing: [String] {
        lexiconKnown ? XrpcConsole.missingRequired(specs, values: draft.params) : []
    }

    /// The request as the link keeps it.
    public var queryItems: NetworkToolQueryItems {
        XrpcConsole.queryItems(for: request)
    }

    public var canonical: String {
        XrpcConsole.search(for: request)
    }

    /// The method takes a cursor, so a page that hands one back can be followed.
    public var canPage: Bool {
        specs.contains { $0.name == "cursor" }
    }

    /// The address the draft would be sent to, where it is known without
    /// asking anyone. A PDS is only known once a request has resolved it.
    public var previewOrigin: String? {
        switch draft.host {
        case .pds:
            let draftAccount = XrpcConsole.pdsAccount(acct: draft.acct, params: draft.params)
            guard let result = run.value, request.host == .pds, XrpcConsole.pdsAccount(for: request) == draftAccount else {
                return nil
            }
            return result.origin
        case .other:
            return XrpcConsole.normalizeHostURL(draft.url).origin
        case .appview, .relay:
            return XrpcConsole.fixedOrigin(for: draft.host)
        }
    }

    /// `GET` and the URL the draft would go to, with a placeholder for a
    /// host not known yet.
    public var previewURL: String {
        var origin = previewOrigin
        if origin == nil {
            if draft.host == .pds {
                let account = XrpcConsole.pdsAccount(acct: draft.acct, params: draft.params)
                origin = "https://{PDS" + (account.map { " of " + $0 } ?? "") + "}"
            } else {
                origin = "https://{host}"
            }
        }
        return XrpcConsole.buildRequestURL(origin: origin ?? "", nsid: request.method, values: draft.params, specs: specs)
    }

    /// The method that is open, from the list or as typed.
    public var openMethod: XrpcMethod? {
        guard methodValid else { return nil }
        return methods.first { $0.nsid == request.method } ?? XrpcConsole.unlistedMethod(methods, query: request.method)
    }

    // MARK: Choosing a method

    /// Matches for the field while a method is open: a short list under it.
    public var pickerMatches: [XrpcMethod] {
        let text = methodQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard methodValid, !text.isEmpty, text != request.method else { return [] }
        let found = XrpcConsole.searchMethods(methods, query: text, limit: XrpcConsoleModel.popoverLimit)
        if let unlisted = XrpcConsole.unlistedMethod(methods, query: text) { return [unlisted] + found }
        return found
    }

    /// The list on the page while no method is open: the matches for what
    /// was typed, an unlisted NSID first.
    public var searchResults: (rows: [XrpcMethod], found: Int) {
        let text = methodQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        let found = XrpcConsole.searchMethods(methods, query: text, limit: XrpcConsoleModel.searchLimit)
        if let unlisted = XrpcConsole.unlistedMethod(methods, query: text) { return (rows: [unlisted] + found, found: found.count) }
        return (rows: found, found: found.count)
    }

    public var families: [String] {
        XrpcConsole.familiesOf(methods)
    }

    /// The catalogue by namespace, for one family or all of them.
    public func groups(family: String?) -> [XrpcMethodGroup] {
        let shown = family.map { family in methods.filter { $0.nsid.hasPrefix(family + ".") } } ?? methods
        return XrpcConsole.groupMethods(shown)
    }

    /// Open a method. Choosing one is not a request to send it.
    public func pick(_ nsid: String) {
        if nsid == request.method {
            methodQuery = nsid
            return
        }
        navigate(to: XrpcConsoleRequest(method: nsid, host: XrpcConsole.defaultHost(for: nsid)), mode: .never)
    }

    /// Enter in the method field: the first match.
    public func pickFirstMatch() {
        let matches = methodValid ? pickerMatches : searchResults.rows
        if let first = matches.first { pick(first.nsid) }
    }

    /// Back to the list of methods.
    public func showAllMethods() {
        navigate(to: .empty, mode: .never)
    }

    /// A try-chip: a whole request, sent.
    public func runExample(_ example: XrpcConsoleExample) {
        send(XrpcConsole.request(from: NetworkToolQuery.decode(example.search)))
    }

    // MARK: Editing and sending

    public func setParam(_ name: String, _ values: [String]) {
        draft.params[name] = values
    }

    /// A parameter added by name, for a method whose lexicon could not be found.
    public func addParam(_ name: String) {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard XrpcConsole.isParamName(trimmed), draft.params[trimmed] == nil, !specs.contains(where: { $0.name == trimmed }) else { return }
        draft.params[trimmed] = [""]
    }

    /// Send: the draft becomes the request, and runs.
    public func submit() {
        send(XrpcConsoleRequest(method: request.method, host: draft.host, acct: draft.acct, url: draft.url, params: draft.params))
    }

    /// The response's "Next page".
    public func nextPage(_ cursor: String) {
        var params = XrpcConsole.cleanValues(request.params)
        params["cursor"] = [cursor]
        send(XrpcConsoleRequest(method: request.method, host: request.host, acct: request.acct, url: request.url, params: params))
    }

    /// Send a request whether or not it looks whole; the host says what it
    /// did not like.
    public func send(_ next: XrpcConsoleRequest) {
        navigate(to: next, mode: .always)
    }

    /// Try the last request again.
    public func retry() {
        decideRun(rerun: true)
    }

    private enum SendMode {
        case never
        case ifComplete
        case always
    }

    private func navigate(to next: XrpcConsoleRequest, mode: SendMode) {
        let search = XrpcConsole.search(for: next)
        let sameRequest = started && search == canonical && next.method == request.method
        request = next
        draft = XrpcConsoleDraft(next)
        methodQuery = next.method
        switch mode {
        case .never:
            unsent.insert(search)
        case .always:
            unsent.remove(search)
            forced = search
        case .ifComplete:
            break
        }

        guard XrpcConsole.looksLikeMethodNsid(next.method) else {
            lexiconTask?.cancel()
            lexiconTask = nil
            lexiconFor = nil
            lexicon = .idle
            cancelRun()
            return
        }
        if lexiconFor != next.method || lexicon.isFailed {
            loadLexicon(next.method)
        }
        decideRun(rerun: mode == .always && sameRequest)
    }

    private func loadLexicon(_ nsid: String) {
        lexiconTask?.cancel()
        lexiconFor = nsid
        lexicon = .loading
        let http = http
        let cached = cachesLexicons
        let entry = methods.first { $0.nsid == nsid }
        lexiconTask = Task { [weak self] in
            let found = await XrpcConsoleModel.lexicon(for: nsid, entry: entry, http: http, cached: cached)
            guard !Task.isCancelled, let self, self.lexiconFor == nsid else { return }
            self.lexicon = .loaded(found)
            self.decideRun(rerun: false)
        }
    }

    /// Whether the request should run now: it was sent, or arrived whole by
    /// link; never a method only picked from the list, or a lexicon that
    /// says it is no query.
    private func decideRun(rerun: Bool) {
        let key = canonical
        guard methodValid, notAQuery == nil, !unsent.contains(key) else {
            cancelRun()
            return
        }
        let wanted = forced == key || (!lexicon.isLoading && XrpcConsole.isComplete(request, paramSet: paramSet))
        guard wanted else {
            cancelRun()
            return
        }
        if !rerun, runKey == key, run.isLoading || run.value != nil || run.isFailed {
            return
        }
        startRun(key: key)
    }

    private func cancelRun() {
        runTask?.cancel()
        runTask = nil
        runKey = nil
        run = .idle
    }

    private func startRun(key: String) {
        runTask?.cancel()
        runKey = key
        run = .loading
        let request = request
        let specs = specs
        let http = http
        runTask = Task { [weak self] in
            let outcome: Loadable<XrpcConsoleResult>
            do {
                let result = try await XrpcConsoleModel.perform(request, specs: specs, http: http)
                outcome = .loaded(result)
            } catch let error as XrpcConsoleError {
                outcome = .failed(error.message)
            } catch {
                outcome = .failed("The request could not be sent.")
            }
            guard !Task.isCancelled, let self, self.runKey == key else { return }
            self.run = outcome
        }
    }

    // MARK: IO

    /// Find a method's lexicon, so the form can be built from it.
    ///
    /// The published record comes first: it is the protocol's own answer
    /// (`_lexicon` DNS record, then `com.atproto.lexicon.schema` in the
    /// authority's repository), it covers any NSID rather than only the ones
    /// in the index, and it is what the lexicons explorer shows. The copy in
    /// the atproto repository is the fallback for a listed method whose
    /// namespace publishes nothing.
    nonisolated static func lexicon(for nsid: String, entry: XrpcMethod?, http: HTTPClient, cached: Bool = true) async -> XrpcMethodLexicon {
        if cached, let hit = await foundLexicons.get(nsid) { return hit }
        if cached, let hit = await missingLexicons.get(nsid) { return hit }

        var doc: JSONValue?
        var source = XrpcLexiconSource.names
        if let published = await publishedLexicon(nsid, http: http) {
            doc = published
            source = .published
        } else if let raw = entry?.raw, let fetched = try? await http.getJSONValue(from: raw) {
            doc = fetched
            source = .repository
        }

        let summary = doc.map { XrpcConsole.summarizeMethodLexicon($0) }
        let found = XrpcMethodLexicon(
            paramSet: XrpcConsole.paramSet(fromLexicon: doc, fallbackNames: entry?.params ?? []),
            summary: summary,
            description: summary?.description ?? entry?.description ?? "",
            source: source
        )
        if !cached {
            return found
        }
        if source == .names {
            await missingLexicons.set(nsid, found)
        } else {
            await foundLexicons.set(nsid, found)
        }
        return found
    }

    /// The schema an NSID's authority published, as the lexicons explorer
    /// finds it (`lookupLexiconSchema`): the `_lexicon` TXT record on the
    /// NSID's domain names the authority's DID, failing that the reversed
    /// NSID as a handle (`app.bsky.feed.post` -> `bsky.app`); then the
    /// record from Slingshot, and from the authority's own PDS before giving
    /// up, since Slingshot misses records it has never been asked for.
    nonisolated static func publishedLexicon(_ nsid: String, http: HTTPClient) async -> JSONValue? {
        guard isValidNsid(nsid) else { return nil }
        let domain = nsid.split(separator: ".").dropLast().reversed().joined(separator: ".")
        let slingshot = SlingshotClient(http: http)

        var authority: String?
        let probe = await DNSTXTClient(http: http).lookup("_lexicon." + domain)
        for record in probe.records {
            if let match = record.wholeMatch(of: #/did=(did:[a-z]+:[^\s;]+)/#) {
                authority = String(match.output.1)
                break
            }
        }
        if authority == nil {
            authority = await slingshot.resolveMiniDoc(UFOsClient.publisherForNsid(nsid))?.did
        }
        guard let authority else { return nil }

        let collection = "com.atproto.lexicon.schema"
        if let cached = await slingshot.getRecordByUri("at://\(authority)/\(collection)/\(nsid)") {
            return cached.value
        }
        if let host = await slingshot.resolveMiniDoc(authority), !host.pds.isEmpty,
            let record = try? await PDSClient(http: http).getRecord(pds: host.pds, repo: authority, collection: collection, rkey: nsid),
            record.value.objectValue != nil {
            return record.value
        }
        return nil
    }

    /// The host for a request: fixed, typed, or the PDS of the account it
    /// names. Problems with the request itself are thrown.
    nonisolated static func resolveOrigin(for request: XrpcConsoleRequest, http: HTTPClient) async throws -> String {
        if let fixed = XrpcConsole.fixedOrigin(for: request.host) { return fixed }
        if request.host == .other {
            switch XrpcConsole.normalizeHostURL(request.url) {
            case .ok(let origin): return origin
            case .invalid(let reason): throw XrpcConsoleError(message: reason)
            }
        }
        guard let account = XrpcConsole.pdsAccount(for: request) else {
            throw XrpcConsoleError(message: "Name the account whose PDS should answer, or send the request somewhere else.")
        }
        guard let identity = await SlingshotClient(http: http).resolveMiniDoc(account), !identity.pds.isEmpty else {
            throw XrpcConsoleError(message: "No PDS could be found for \(account). Check the handle or DID.")
        }
        return identity.pds.hasSuffix("/") ? String(identity.pds.dropLast()) : identity.pds
    }

    /// Send one request, straight from the device. There is no proxy: the
    /// host sees the app. Whatever the host does, an error status included,
    /// is a result.
    nonisolated static func perform(_ request: XrpcConsoleRequest, specs: [XrpcParamSpec], http: HTTPClient) async throws -> XrpcConsoleResult {
        let origin = try await resolveOrigin(for: request, http: http)
        let url = XrpcConsole.buildRequestURL(origin: origin, nsid: request.method, values: request.params, specs: specs)
        guard let address = URL(string: url) else {
            throw XrpcConsoleError(message: "That request does not make a URL.")
        }
        var urlRequest = URLRequest(url: address)
        urlRequest.httpMethod = "GET"
        let clock = ContinuousClock()
        let startedAt = clock.now

        let data: Data
        let response: HTTPURLResponse
        do {
            (data, response) = try await http.send(urlRequest)
        } catch HTTPFailure.tooLarge(let bytes) {
            return XrpcConsoleResult(kind: .tooLarge, url: url, origin: origin, ms: milliseconds(clock.now - startedAt), bytes: bytes)
        } catch {
            if Task.isCancelled { throw CancellationError() }
            return XrpcConsoleResult(kind: .network, url: url, origin: origin)
        }
        let ms = milliseconds(clock.now - startedAt)
        let contentType = HTTPClient.header("Content-Type", in: response)

        if !XrpcConsole.isTextual(contentType) {
            let declared = HTTPClient.header("Content-Length", in: response).flatMap { Int($0.trimmingCharacters(in: .whitespaces)) }
            return XrpcConsoleResult(
                kind: .binary, url: url, origin: origin, status: response.statusCode, ms: ms,
                contentType: contentType, bytes: declared ?? data.count
            )
        }
        return XrpcConsoleResult(
            kind: .text,
            url: url,
            origin: origin,
            status: response.statusCode,
            ms: ms,
            contentType: contentType,
            bytes: data.count,
            text: String(decoding: data, as: UTF8.self),
            json: try? JSONValue.parse(data),
            rateRemaining: HTTPClient.header("RateLimit-Remaining", in: response)
        )
    }

    private nonisolated static func milliseconds(_ duration: Duration) -> Double {
        let parts = duration.components
        return Double(parts.seconds) * 1000 + Double(parts.attoseconds) / 1e15
    }
}
