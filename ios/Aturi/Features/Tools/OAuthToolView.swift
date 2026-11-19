import SwiftUI
import AturiCore

/// `/tools/oauth`, port of `src/components/tools/OAuthChecker.tsx` and
/// `OAuthCheckerScopes.tsx`: checks an OAuth client metadata document
/// against the atproto profile, and builds or reads a scope string. The
/// rules are `OAuthChecker` and `OAuthCheckerScopes` in AturiCore; the
/// document is fetched from the app, straight from its host.
///
/// Reads `?client_id=`, and `?view=scopes&scope=` for the scope view.
struct OAuthToolView: View {
    let query: [String: String]

    init(query: [String: String]) {
        self.query = query
    }

    @State private var model = OAuthCheckerModel()
    @State private var clientText = ""
    @State private var scopeText = ""
    @State private var form = OAuthCheckerScopes.BuilderForm()
    @State private var started = false

    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL

    /// Both of the site's own documents, which are live, and the development
    /// form, which needs no document at all.
    private static let clientExamples = [
        ServicesExample(label: "aturi.to (web)", value: "https://aturi.to/oauth-client-metadata.json"),
        ServicesExample(label: "Aturi for iOS (native)", value: "https://aturi.to/oauth-client-metadata-ios.json"),
        ServicesExample(
            label: "localhost (development)",
            value: "http://localhost?redirect_uri=http%3A%2F%2F127.0.0.1%3A8080%2Fcallback&scope=atproto"
        ),
    ]

    private static let scopeExamples = [
        ServicesExample(label: "Sign in only", value: "atproto"),
        ServicesExample(label: "Own records and uploads", value: "atproto repo:app.example.post repo:app.example.like blob:*/*"),
        ServicesExample(
            label: "Bluesky profile lookups",
            value: "atproto rpc:app.bsky.actor.getProfile?aud=did:web:api.bsky.app%23bsky_appview"
        ),
        ServicesExample(label: "App password equivalent", value: "atproto transition:generic"),
    ]

    var body: some View {
        ToolFrame(slug: "oauth", shareQuery: model.shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                Picker("What to do", selection: $model.mode) {
                    ForEach(OAuthCheckerModel.Mode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)

                if model.mode == .client {
                    ToolInputBar(
                        placeholder: "https://app.example.com/oauth-client-metadata.json",
                        text: $clientText,
                        isRunning: model.isRunning
                    ) {
                        model.check(clientText)
                    }
                    ServicesExamples(examples: Self.clientExamples) { value in
                        clientText = value
                        model.check(value)
                    }
                } else {
                    ToolTextEditor(
                        placeholder: "atproto repo:app.example.post blob:*/*",
                        text: $scopeText,
                        buttonTitle: "Read",
                        minHeight: 80
                    ) {
                        model.setScope(scopeText)
                    }
                    ServicesExamples(examples: Self.scopeExamples) { value in
                        model.setScope(value)
                    }
                }
            }
        } content: {
            if model.mode == .client {
                clientResults
            } else {
                scopeResults
            }
        }
        .onAppear(perform: start)
        .onChange(of: model.scope) { _, scope in
            scopeText = scope
        }
    }

    private func start() {
        guard !started else { return }
        started = true
        clientText = query["client_id"] ?? ""
        model.apply(query: query)
        scopeText = model.scope
    }

    // MARK: Checking a client

    @ViewBuilder
    private var clientResults: some View {
        if model.clientIdRaw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ServicesIntro(
                items: [
                    ServicesIntroItem(
                        term: "The document is served correctly",
                        text: "A client_id is an https URL with no port. It has to answer 200 with application/json, without redirecting, and repeat its own URL as client_id."
                    ),
                    ServicesIntroItem(
                        term: "The required fields are there",
                        text: "grant_types with authorization_code, response_types with code, a scope that includes atproto, and dpop_bound_access_tokens set to true."
                    ),
                    ServicesIntroItem(
                        term: "Redirect URIs fit the client type",
                        text: "A web client redirects to https URLs. A native client may use a scheme of its own, which must be the client_id’s hostname in reverse."
                    ),
                    ServicesIntroItem(
                        term: "A confidential client publishes its key",
                        text: "private_key_jwt needs a public key in jwks or at a jwks_uri, one or the other. The key set itself is not fetched."
                    ),
                ],
                note: "The rules are the Clients section of the atproto OAuth specification, atproto.com/specs/oauth."
            )
        } else if let reason = model.input?.reason {
            ServicesInputError(message: reason)
        } else if let verdict = model.verdict {
            ServicesVerdictCard(verdict: verdict)
            ToolSection("Checks", detail: checksDetail) {
                ServicesCheckList(checks: model.checks)
                if model.loopback == nil && !model.isRunning {
                    Button("Check again") {
                        model.recheck()
                    }
                    .buttonStyle(.aturiSecondary)
                    .padding(.top, 8)
                }
            }
            if let document = model.document {
                clientSection
                ToolSection(model.loopback == nil ? "Document" : "Document a server derives") {
                    JSONTreeView(value: document, expandedDepth: 2)
                    if !model.otherFields.isEmpty {
                        Text("Shown are the fields client metadata defines. The document also carries \(model.otherFields.joined(separator: ", ")), which a server ignores.")
                            .font(AturiFont.caption)
                            .foregroundStyle(theme.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.top, 8)
                    }
                }
            }
        }
    }

    private var checksDetail: String? {
        if model.loopback != nil { return "Read from the URL" }
        return model.isRunning ? "Checking…" : nil
    }

    private var clientSection: some View {
        ToolSection(model.loopback == nil ? "Client" : "Implied metadata") {
            VStack(alignment: .leading, spacing: 4) {
                if let name = model.clientName {
                    ToolFactRow(label: "Name", value: name, mono: false)
                }
                if let kind = model.kindLabel {
                    ToolFactRow(label: "Kind", value: kind, mono: false)
                }
                if let clientId = model.input?.clientId {
                    CopyRow(label: "Client ID", value: clientId)
                }
                if model.loopback != nil {
                    Text("A server that supports this form builds the document below from the URL, and adds a client_name of its own choosing.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let scope = model.documentScope {
                    Button("Read its scopes") {
                        model.readScopes(scope)
                    }
                    .buttonStyle(.aturiSecondary)
                    .padding(.top, 6)
                }
            }
        }
    }

    // MARK: Scopes

    @ViewBuilder
    private var scopeResults: some View {
        let analysis = model.analysis
        if let verdict = model.scopeVerdict {
            ServicesVerdictCard(verdict: verdict)
        }
        if analysis.scopes.isEmpty {
            ServicesIntro(
                title: "What a scope string holds",
                items: [
                    ServicesIntroItem(
                        term: "atproto, always",
                        text: "Every atproto session asks for atproto. On its own it signs the account in and grants nothing else."
                    ),
                    ServicesIntroItem(
                        term: "Granular permissions",
                        text: "One item per thing the app does: repo: to write a record type, rpc: to call a service, blob: to upload, and account: or identity: for the account itself."
                    ),
                    ServicesIntroItem(
                        term: "Permission sets",
                        text: "include: names a bundle that a lexicon’s author published, so a consent screen can show one line instead of dozens."
                    ),
                    ServicesIntroItem(
                        term: "Transitional scopes",
                        text: "transition:generic and its two companions give the broad access an app password had. They are meant to go away."
                    ),
                ],
                note: "The grammar is the atproto permission specification, atproto.com/specs/permission. A client’s metadata has to list every scope it might ask for."
            )
        } else {
            ToolSection("Scopes", detail: analysis.notes.first ?? scopeCount(analysis.scopes.count)) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(analysis.scopes.enumerated()), id: \.offset) { index, scope in
                        if index > 0 {
                            Divider()
                        }
                        scopeRow(scope, index: index)
                    }
                }
            }
        }
        ToolSection("Add a permission") {
            builder
        }
        if !analysis.scopes.isEmpty {
            ToolSection("Scope string") {
                VStack(alignment: .leading, spacing: 10) {
                    ServicesCodeBlock(text: model.normalizedScope, label: "scope string")
                    Text("In a client metadata document:")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                    ServicesCodeBlock(text: model.metadataField, label: "metadata field")
                }
            }
        }
    }

    private func scopeCount(_ count: Int) -> String {
        count == 1 ? "one scope" : "\(count) scopes"
    }

    private static func status(_ validity: OAuthCheckerScopes.Validity) -> ToolCheckStatus {
        switch validity {
        case .valid: return .pass
        case .unknown: return .warn
        case .invalid: return .fail
        }
    }

    private func tint(_ status: ToolCheckStatus) -> Color {
        switch status {
        case .pass: return theme.textAccent
        case .warn: return .orange
        case .fail: return theme.danger
        case .info, .pending: return theme.textTertiary
        }
    }

    private func scopeRow(_ scope: OAuthCheckerScopes.Parsed, index: Int) -> some View {
        let status = Self.status(scope.status)
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: status.systemImage)
                .foregroundStyle(tint(status))
                .frame(width: 18)
                .accessibilityLabel(status.accessibilityLabel)
            VStack(alignment: .leading, spacing: 4) {
                Text(scope.raw)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Text(scope.meaning)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(Array(scope.problems.enumerated()), id: \.offset) { _, problem in
                    Text(problem)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
                ForEach(Array(scope.notes.enumerated()), id: \.offset) { _, note in
                    Text(note)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            Button {
                model.removeScope(at: index)
            } label: {
                Image(systemName: "xmark.circle")
                    .foregroundStyle(theme.textTertiary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(scope.raw)")
        }
        .padding(.vertical, 8)
    }

    // MARK: The builder

    private var builder: some View {
        VStack(alignment: .leading, spacing: 12) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(OAuthCheckerScopes.BuilderKind.allCases) { kind in
                        Button {
                            form.kind = kind
                        } label: {
                            Chip(kind.label, style: kind == form.kind ? .accent : .neutral)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(kind == form.kind ? .isSelected : [])
                    }
                }
                .padding(.vertical, 2)
            }
            Text(form.kind.hint)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            fields

            builderPreview
        }
    }

    @ViewBuilder
    private var fields: some View {
        switch form.kind {
        case .repo:
            ScopeField(
                label: "Collection",
                text: $form.collection,
                placeholder: "app.example.post",
                hint: "An NSID, several separated by spaces, or * for every collection."
            )
            VStack(alignment: .leading, spacing: 6) {
                Text("Actions")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                HStack(spacing: 6) {
                    ForEach(OAuthCheckerScopes.repoActions, id: \.self) { action in
                        let on = form.actions.contains(action)
                        Button {
                            form.toggle(action)
                        } label: {
                            Chip(action.rawValue.capitalized, systemImage: on ? "checkmark" : nil, style: on ? .accent : .neutral)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }
        case .rpc:
            ScopeField(
                label: "Method",
                text: $form.lxm,
                placeholder: "app.bsky.actor.getProfile",
                hint: "The NSID of an API method, or * for every method on one service."
            )
            ScopeField(
                label: "Service",
                text: $form.aud,
                placeholder: "did:web:api.bsky.app#bsky_appview",
                hint: "A DID and its service fragment, or * for any service."
            )
        case .blob:
            ScopeField(
                label: "Accepts",
                text: $form.accept,
                placeholder: "*/*",
                hint: "MIME types or patterns such as image/* or video/mp4."
            )
        case .account:
            Picker("Attribute", selection: $form.accountAttr) {
                Text("Email address").tag(OAuthCheckerScopes.AccountAttr.email)
                Text("Repository import").tag(OAuthCheckerScopes.AccountAttr.repo)
            }
            .pickerStyle(.segmented)
            Picker("Access", selection: $form.accountAction) {
                Text("Read").tag(OAuthCheckerScopes.AccountAction.read)
                Text("Manage").tag(OAuthCheckerScopes.AccountAction.manage)
            }
            .pickerStyle(.segmented)
        case .identity:
            Picker("Attribute", selection: $form.identityAttr) {
                Text("Handle").tag(OAuthCheckerScopes.IdentityAttr.handle)
                Text("Handle and DID document").tag(OAuthCheckerScopes.IdentityAttr.all)
            }
            .pickerStyle(.segmented)
        case .include:
            ScopeField(
                label: "Permission set",
                text: $form.nsid,
                placeholder: "com.example.authBasicFeatures",
                hint: "The NSID of a permission-set lexicon."
            )
            ScopeField(
                label: "Service (optional)",
                text: $form.includeAud,
                placeholder: "did:web:api.example.com#svc_appview",
                hint: "Passed down to the API calls in the set that inherit their audience."
            )
        case .transition:
            Picker("Scope", selection: $form.transition) {
                Text("generic").tag("generic")
                Text("chat.bsky").tag("chat.bsky")
                Text("email").tag("email")
            }
            .pickerStyle(.segmented)
        }
    }

    private var builderPreview: some View {
        let parsed = form.parsed
        return VStack(alignment: .leading, spacing: 8) {
            if let parsed {
                Text(parsed.raw)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                Text(parsed.status == .invalid ? (parsed.problems.first ?? parsed.meaning) : parsed.meaning)
                    .font(AturiFont.footnote)
                    .foregroundStyle(parsed.status == .invalid ? theme.danger : theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text("Fill in the fields above to see the scope.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
            }
            Button {
                if let parsed {
                    model.addScope(parsed.raw)
                }
            } label: {
                Label("Add scope", systemImage: "plus")
            }
            .buttonStyle(.aturiSecondary)
            .disabled(parsed == nil || parsed?.status == .invalid)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surfaceSubtle, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
    }
}

/// One labelled text field of the scope builder, with its hint.
private struct ScopeField: View {
    let label: String
    @Binding var text: String
    let placeholder: String
    let hint: String

    @Environment(\.aturiTheme) private var theme

    init(label: String, text: Binding<String>, placeholder: String, hint: String) {
        self.label = label
        _text = text
        self.placeholder = placeholder
        self.hint = hint
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
            TextField(placeholder, text: $text)
                .font(AturiFont.monoSmall)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(.horizontal, 10)
                .frame(minHeight: 40)
                .background(theme.bgSecondary, in: shape)
                .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: 1))
                .accessibilityLabel(label)
            Text(hint)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}
