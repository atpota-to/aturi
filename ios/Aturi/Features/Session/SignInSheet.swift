import SwiftUI
import AturiCore

/// The sign-in flow as a sheet: a handle, then the permissions to grant,
/// then the system browser. Port of the web's two-step `useSignInFlow`
/// with the copy of `SignInPanel.tsx` and `ScopeSelector.tsx`. Talks to
/// the session only through `SessionStoring`, so any screen can present it.
struct SignInSheet: View {
    private enum Step {
        case handle
        case scopes
    }

    @Environment(\.sessionStore) private var session
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.dismiss) private var dismiss
    @Environment(\.aturiTheme) private var theme

    @State private var step: Step = .handle
    @State private var input: String
    @State private var pendingAccount = ""
    @State private var selected: Set<ScopeId> = Scopes.defaultScopeIds
    @State private var busy = false
    @State private var errorMessage: String?

    /// - Parameter defaultInput: a handle to start the field with, such as
    ///   the repo the person was just looking at.
    init(defaultInput: String = "") {
        _input = State(initialValue: defaultInput)
    }

    private var trimmedInput: String {
        input.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Finer progress copy when the store reports it; the sheet works
    /// against any `SessionStoring` and falls back to one line otherwise.
    private var progressLabel: String {
        (session as? SessionStore)?.phase.label ?? "Signing in"
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    switch step {
                    case .handle:
                        handleStep
                    case .scopes:
                        scopesStep
                    }
                }
                .padding(16)
            }
            .background(theme.bgPrimary.ignoresSafeArea())
            .navigationTitle(step == .handle ? "Sign in" : "Permissions")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(busy)
                }
            }
        }
        .interactiveDismissDisabled(busy)
        .onAppear {
            (session as? SessionStore)?.attach(preferences: preferences)
        }
    }

    // MARK: Step 1: handle

    private var handleStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Sign in with your handle to edit your own records, and to keep your settings on your PDS so they carry across devices.")
                .font(.body)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HandleTypeaheadField(text: $input, onSubmit: proceedToScopes)
            Button("Sign in", action: proceedToScopes)
                .buttonStyle(.aturiPrimary)
                .disabled(trimmedInput.isEmpty)
            Text("You will be sent to your own server to approve the sign in. This app never sees your password.")
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
            if let errorMessage {
                errorText(errorMessage)
            }
        }
    }

    // MARK: Step 2: permissions

    private var scopesStep: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 10) {
                Button(action: backToHandle) {
                    Image(systemName: "chevron.left")
                }
                .buttonStyle(.aturiSecondary)
                .disabled(busy)
                .accessibilityLabel("Back")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Select permissions")
                        .font(AturiFont.subtitle)
                        .foregroundStyle(theme.textPrimary)
                    Text("for \(pendingAccount)")
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                }
            }
            ScopePicker(selected: $selected, disabled: busy)
            Button(action: submitScopes) {
                HStack(spacing: 8) {
                    if busy {
                        ProgressView()
                            .tint(theme.textOnAccent)
                    }
                    Text(busy ? progressLabel : "Continue")
                }
            }
            .buttonStyle(.aturiPrimary)
            .disabled(busy)
            Text("Reading records is always allowed: your repo is public.")
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
            if let errorMessage {
                errorText(errorMessage)
            }
        }
    }

    private func errorText(_ message: String) -> some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(theme.danger)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityLabel("Error: \(message)")
    }

    // MARK: Actions

    /// handle -> scopes: keep the trimmed account and advance. A blank
    /// field is a no-op, as on the web.
    private func proceedToScopes() {
        let account = trimmedInput
        guard !account.isEmpty else { return }
        errorMessage = nil
        pendingAccount = account
        step = .scopes
    }

    private func backToHandle() {
        step = .handle
        errorMessage = nil
    }

    /// The final step hands the account and the picked scopes to the
    /// store, which resolves, discovers, opens the browser and syncs.
    /// A dismissed browser is not an error worth showing.
    private func submitScopes() {
        guard !busy else { return }
        busy = true
        errorMessage = nil
        let account = pendingAccount
        let scope = selected
        Task {
            do {
                try await session.signIn(handle: account, scope: scope)
                busy = false
                dismiss()
            } catch {
                busy = false
                if !SignInErrorText.isCancellation(error) {
                    errorMessage = SignInErrorText.describe(error)
                }
            }
        }
    }
}

/// The permissions step: one row per granular scope, ticked by default.
/// The atproto consent screen at the person's PDS then shows only the
/// subset actually requested.
struct ScopePicker: View {
    @Binding var selected: Set<ScopeId>
    var disabled: Bool = false

    @Environment(\.aturiTheme) private var theme

    init(selected: Binding<Set<ScopeId>>, disabled: Bool = false) {
        _selected = selected
        self.disabled = disabled
    }

    var body: some View {
        VStack(spacing: 8) {
            ForEach(Scopes.granular) { scope in
                Toggle(isOn: binding(for: scope.id)) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(scope.label)
                            .font(.body)
                            .foregroundStyle(theme.textPrimary)
                        Text(scope.hint)
                            .font(.footnote)
                            .foregroundStyle(theme.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .disabled(disabled)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .cardBackground()
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Permissions")
    }

    private func binding(for id: ScopeId) -> Binding<Bool> {
        Binding(
            get: { selected.contains(id) },
            set: { on in
                if on {
                    selected.insert(id)
                } else {
                    selected.remove(id)
                }
            }
        )
    }
}

/// The handle field with AppView typeahead, port of `HandleTypeaheadInput`.
///
/// Suggestions are strictly additive. The AppView only knows accounts it
/// indexes, so a handle on a self-hosted PDS never appears in the list:
/// nothing here stands between a typed handle and the submit, and an
/// empty lookup is not an error. Picking a suggestion fills the field and
/// stops there; the next step opens an OAuth provider, and a tap that
/// meant "use this name" should not also mean "send me there".
struct HandleTypeaheadField: View {
    @Binding var text: String
    var disabled: Bool = false
    var onSubmit: () -> Void = {}

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale
    @State private var suggestions: [ActorTypeaheadResult] = []
    @State private var open = false
    /// The handle a suggestion just filled in, so the change it causes does
    /// not reopen the list under the person's finger.
    @State private var picked: String?
    @FocusState private var focused: Bool

    /// Longer than the explorer's search debounce: this field asks a third
    /// party which account is about to authenticate, so it waits for a
    /// real pause in typing.
    private static let debounce: Duration = .milliseconds(250)
    private static let limit = 6

    init(text: Binding<String>, disabled: Bool = false, onSubmit: @escaping () -> Void = {}) {
        _text = text
        self.disabled = disabled
        self.onSubmit = onSubmit
    }

    /// Derived rather than cleared from the lookup: editing back below the
    /// minimum length has to hide the list at once.
    private var visible: [ActorTypeaheadResult] {
        open && AppViewClient.shouldQueryHandleTypeahead(text) ? suggestions : []
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            TextField("handle or DID", text: $text)
                .font(AturiFont.mono)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .textContentType(.username)
                .submitLabel(.go)
                .focused($focused)
                .disabled(disabled)
                .onSubmit(onSubmit)
                .padding(12)
                .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale))
                )
                .accessibilityLabel("Handle or DID")
                .onChange(of: text) { _, newValue in
                    open = newValue != picked
                }
                .task(id: text) {
                    await lookup()
                }
            if !visible.isEmpty {
                suggestionList
            }
        }
    }

    private var suggestionList: some View {
        VStack(spacing: 0) {
            ForEach(visible, id: \.did) { actor in
                Button {
                    pick(actor)
                } label: {
                    HStack(spacing: 10) {
                        AvatarView(url: actor.avatar, size: 24)
                        VStack(alignment: .leading, spacing: 1) {
                            if let name = actor.displayName?.trimmingCharacters(in: .whitespaces), !name.isEmpty {
                                Text(name)
                                    .font(AturiFont.subtitle)
                                    .foregroundStyle(theme.textPrimary)
                                    .lineLimit(1)
                            }
                            Text(actor.handle)
                                .font(AturiFont.monoSmall)
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(accessibilityName(for: actor))
                if actor.did != visible.last?.did {
                    Divider()
                        .overlay(theme.borderSubtle)
                }
            }
        }
        .cardBackground()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Matching accounts")
    }

    private func accessibilityName(for actor: ActorTypeaheadResult) -> String {
        if let name = actor.displayName?.trimmingCharacters(in: .whitespaces), !name.isEmpty {
            return "\(name), \(actor.handle)"
        }
        return actor.handle
    }

    /// Debounced lookup; `.task(id:)` cancels the previous one on every
    /// keystroke, so only the newest value can land in state.
    private func lookup() async {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard AppViewClient.shouldQueryHandleTypeahead(query) else { return }
        try? await Task.sleep(for: Self.debounce)
        guard !Task.isCancelled else { return }
        let results = await AppViewClient().searchActorsTypeahead(query, limit: Self.limit)
        guard !Task.isCancelled else { return }
        suggestions = results
    }

    private func pick(_ actor: ActorTypeaheadResult) {
        picked = actor.handle
        text = actor.handle
        open = false
        focused = true
    }
}

/// Human text for sign-in failures. Port of `describeSignInError` from
/// `src/lib/oauth/signInError.ts`, plus the mapping of the native client's
/// own error cases, which the web never had to name because its library
/// produced strings already.
enum SignInErrorText {
    private static let undeclaredPrefix = "Scope \""
    private static let undeclaredSuffix = "\" is not declared in the client metadata"

    /// A dismissed browser sheet is the person changing their mind, not a
    /// failure to report.
    static func isCancellation(_ error: Error) -> Bool {
        if let sessionError = error as? SessionError, sessionError == .cancelled {
            return true
        }
        return error is CancellationError
    }

    static func describe(_ error: Error) -> String {
        if let sessionError = error as? SessionError {
            return sessionError.errorDescription ?? "Could not sign in."
        }
        if let oauth = error as? OAuthError {
            return describe(oauth)
        }
        return ExploreErrorText.describe(error)
    }

    private static func describe(_ error: OAuthError) -> String {
        switch error {
        case .server(let status, let name, let description):
            return rewriteUndeclaredScope(description ?? name ?? "HTTP \(status)")
        case .authorizationDenied(let name, let description):
            if let description, !description.isEmpty {
                return rewriteUndeclaredScope(description)
            }
            return name == "access_denied"
                ? "Your server did not authorize this app."
                : "Your server refused the sign in (\(name))."
        case .issuerMismatch:
            return "The sign in came back from a different server than it started on."
        case .stateMismatch, .invalidCallback:
            return "The sign in did not complete. Try again."
        case .invalidMetadata(let detail), .missingEndpoint(let detail):
            return "Your server does not support the sign in this app needs (\(detail))."
        case .invalidTokenResponse(let detail):
            return "Your server sent a token this app could not use (\(detail))."
        case .subjectMismatch:
            return "The token was issued for a different account than the one you entered."
        case .missingRefreshToken:
            return "Your server did not issue a refresh token. Sign in again."
        }
    }

    /// The one OAuth failure this app can reliably explain.
    ///
    /// An authorization server checks every requested scope against the
    /// client metadata document it fetched from the site, with a plain
    /// string membership test, and refuses the whole request naming the
    /// first token that is not in it. The reference PDS holds that
    /// document for ten minutes, so for a few minutes after the site
    /// declares a new permission, a server holding the previous document
    /// rejects the very token the current one declares.
    ///
    /// That is transient with two remedies, and the raw message names
    /// neither: it reads as a permanent misconfiguration. So it is
    /// rewritten to say which permission was refused, that waiting fixes
    /// it, and that unticking it signs you in now. Anything else is passed
    /// through untouched; a message that cannot be placed is more useful
    /// verbatim than paraphrased.
    static func rewriteUndeclaredScope(_ raw: String) -> String {
        guard let start = raw.range(of: undeclaredPrefix),
              let end = raw.range(of: undeclaredSuffix, range: start.upperBound..<raw.endIndex)
        else { return raw }
        let token = String(raw[start.upperBound..<end.lowerBound])
        guard !token.isEmpty, !token.contains("\"") else { return raw }
        let label = Scopes.granular.first { $0.scope == token }?.label
        let named = label.map { "\u{201C}\($0)\u{201D}" } ?? "that permission"
        return "Your server refused \(named): it is holding an older copy of this app's permission list, which it caches for up to about ten minutes. Wait a few minutes and sign in again, or untick \(named) to sign in without it now."
    }
}
