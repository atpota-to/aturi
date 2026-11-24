import SwiftUI
import AturiCore

/// Port of `AccountTab.tsx`. Signed out, the screen is the sign-in flow
/// (handle, then the granular scopes) so the rest of Settings stays
/// reachable without an account; signed in, it is the identity card, the
/// granted scopes, the sync status and sign-out. Everything goes through
/// the shell's `SessionStoring`, which owns the keychain and the browser
/// session.
struct AccountSettingsView: View {
    @Environment(\.sessionStore) private var sessionStore

    var body: some View {
        if let account = sessionStore.state.session {
            AccountSignedInView(account: account)
        } else {
            AccountSignInView()
        }
    }
}

private struct AccountSignedInView: View {
    let account: OAuthSession

    @Environment(\.sessionStore) private var sessionStore
    @Environment(PreferencesStore.self) private var preferences
    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    @State private var profile: Loadable<BskyProfile?> = .idle
    @State private var confirmSignOut = false
    @State private var signingOut = false

    private var loadedProfile: BskyProfile? {
        if case .loaded(let value) = profile {
            return value
        }
        return nil
    }

    /// The handle the AppView reports wins over the one the authorization
    /// server sent at sign-in, which can be stale after a handle change.
    private var handle: String? {
        if let handle = loadedProfile?.handle, !handle.isEmpty {
            return handle
        }
        if let handle = account.handle, !handle.isEmpty {
            return handle
        }
        return nil
    }

    private var displayName: String {
        if let name = loadedProfile?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        if let handle {
            return "@\(handle)"
        }
        return shortDid(account.did)
    }

    private var showsHandleLine: Bool {
        guard let handle else { return false }
        return displayName != "@\(handle)"
    }

    private var grantedScopes: [GranularScope] {
        let granted = account.grantedScopeIds
        return Scopes.granular.filter { granted.contains($0.id) }
    }

    /// Whether the session store mirrors preferences to the PDS at all;
    /// the placeholder store does not, and then the status is "local".
    private var syncsToPDS: Bool {
        sessionStore is PreferencesSync
    }

    var body: some View {
        List {
            SettingsSection(
                "Signed in",
                footer: "Your account identity. Sign out clears the session from this device."
            ) {
                HStack(alignment: .center, spacing: 12) {
                    AvatarView(url: loadedProfile?.avatar, size: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(displayName)
                            .font(AturiFont.subtitle)
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(1)
                        if showsHandleLine, let handle {
                            Text("@\(handle)")
                                .font(AturiFont.monoSmall)
                                .foregroundStyle(theme.textSecondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        if profile.isLoading || profile.isIdle {
                            Text("Loading profile")
                                .font(AturiFont.caption)
                                .foregroundStyle(theme.textTertiary)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 4)
                .accessibilityElement(children: .combine)

                CopyRow(label: "DID", value: account.did)
                CopyRow(label: "PDS", value: account.pds.host(percentEncoded: false) ?? account.pds.absoluteString)

                Button {
                    router.open(.repo(account.did), in: .explore)
                } label: {
                    Label("My repo", systemImage: "binoculars")
                }
                .accessibilityHint("Opens your repository in the explorer")
            }

            SettingsSection(
                "Permissions",
                footer: grantedScopes.isEmpty
                    ? "This sign-in can read your repo but not change it. Sign out and back in to grant write actions."
                    : "What your PDS granted, read off the token rather than what was asked for. Reading records is always allowed: your repo is public."
            ) {
                if grantedScopes.isEmpty {
                    Chip("Read only", systemImage: "eye")
                } else {
                    SettingsWrapLayout(spacing: 8) {
                        ForEach(grantedScopes) { scope in
                            Chip(scope.label, systemImage: "checkmark", style: .accent)
                                .accessibilityLabel("\(scope.label): \(scope.hint)")
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            SettingsSection("Sync") {
                syncStatus
            }

            SettingsSection {
                Button(role: .destructive) {
                    confirmSignOut = true
                } label: {
                    HStack(spacing: 8) {
                        if signingOut {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                    }
                }
                .disabled(signingOut)
            }
        }
        .settingsList()
        .navigationTitle("Account")
        .task(id: account.did) {
            await loadProfile()
        }
        .confirmationDialog(
            "Sign out of \(displayName)?",
            isPresented: $confirmSignOut,
            titleVisibility: .visible
        ) {
            Button("Sign out", role: .destructive) {
                signOut()
            }
        } message: {
            Text("Your preferences stay on this device and keep working without an account.")
        }
    }

    @ViewBuilder
    private var syncStatus: some View {
        if !syncsToPDS {
            statusRow(
                systemImage: "iphone",
                text: "Preferences are saved on this device.",
                color: theme.textSecondary
            )
        } else if preferences.hasPendingSync {
            HStack(spacing: 8) {
                ProgressView()
                    .controlSize(.small)
                Text("Syncing preferences to your PDS")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
            }
            .padding(.vertical, 2)
        } else {
            /* The debounce window above is only the wait before a write; the
               write itself, and whether the last one failed, are the session
               store's to report. */
            SessionSyncStatusLabel()
                .padding(.vertical, 2)
        }
    }

    private func statusRow(systemImage: String, text: String, color: Color) -> some View {
        Label {
            Text(text)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(color)
        }
        .padding(.vertical, 2)
    }

    private func loadProfile() async {
        profile = .loading
        let result = await AppViewClient().getProfile(account.did)
        profile = .loaded(result)
    }

    private func signOut() {
        signingOut = true
        Task { @MainActor in
            await sessionStore.signOut()
            signingOut = false
        }
    }
}

/// The signed-out body: the web's two steps (handle, then scopes) on one
/// screen, since the scope rows are short enough to sit under the field.
private struct AccountSignInView: View {
    @Environment(\.sessionStore) private var sessionStore
    @Environment(\.aturiTheme) private var theme

    @State private var handle = ""
    @State private var selected: Set<ScopeId> = Scopes.defaultScopeIds
    @State private var busy = false
    @State private var errorMessage: String?

    private var trimmedHandle: String {
        handle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSubmit: Bool {
        !trimmedHandle.isEmpty && !busy
    }

    /// Finer progress copy when the store reports it, as in the sheet.
    private var progressLabel: String {
        (sessionStore as? SessionStore)?.phase.label ?? "Signing in"
    }

    var body: some View {
        List {
            /* A plain section rather than SettingsSection: the shared field
               draws its own rounded background and suggestion card, so the
               row gives up its cell chrome instead of nesting one rounded
               box inside another. */
            Section {
                HandleTypeaheadField(text: $handle, disabled: busy, onSubmit: submit)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
            } header: {
                Text("Sign in to sync")
                    .foregroundStyle(theme.textTertiary)
            } footer: {
                Text("Sign in to edit your own records and keep your settings on your PDS so they follow you across devices. Aturi works without an account; preferences then stay on this device.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
            }

            SettingsSection(
                "Permissions",
                footer: "Reading records is always allowed: your repo is public. Untick an action to grant a narrower scope; your PDS only asks about what you request here."
            ) {
                ForEach(Scopes.granular) { scope in
                    Toggle(isOn: scopeBinding(scope.id)) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(scope.label)
                                .foregroundStyle(theme.textPrimary)
                            Text(scope.hint)
                                .font(AturiFont.footnote)
                                .foregroundStyle(theme.textSecondary)
                        }
                    }
                    .disabled(busy)
                }
            }

            /* The button lives in a footer, not a row: inset grouped rows clip
               their content to the section's rounded corners, which are far
               larger than the button's, and cut its corners off. */
            Section {
            } footer: {
                VStack(alignment: .leading, spacing: 12) {
                    Button(action: submit) {
                        HStack(spacing: 8) {
                            if busy {
                                ProgressView()
                                    .controlSize(.small)
                                    .tint(theme.textOnAccent)
                            }
                            Text(busy ? progressLabel : "Sign in")
                        }
                    }
                    .buttonStyle(.aturiPrimary)
                    .disabled(!canSubmit)

                    if let errorMessage {
                        Text(errorMessage)
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.danger)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel("Error: \(errorMessage)")
                    }

                    Text("You will be sent to your PDS to authorize Aturi and brought back here.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                }
                .textCase(nil)
            }
        }
        .settingsList()
        .navigationTitle("Account")
        .onChange(of: handle) { _, _ in
            /* An error names the handle that failed; once the field says
               something else it no longer describes anything on screen. */
            errorMessage = nil
        }
    }

    private func scopeBinding(_ id: ScopeId) -> Binding<Bool> {
        Binding(
            get: { selected.contains(id) },
            set: { on in
                /* The keyboard would otherwise stay up over the rest of the
                   form; the field's focus is its own, so it is dropped
                   through the responder chain. */
                dismissKeyboard()
                if on {
                    selected.insert(id)
                } else {
                    selected.remove(id)
                }
            }
        )
    }

    private func dismissKeyboard() {
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    /// A dismissed browser is the person changing their mind, so it clears
    /// the busy state without an error, as the sheet does.
    private func submit() {
        guard canSubmit else { return }
        let account = trimmedHandle
        let scope = selected
        dismissKeyboard()
        busy = true
        errorMessage = nil
        Task { @MainActor in
            do {
                try await sessionStore.signIn(handle: account, scope: scope)
            } catch {
                if !SignInErrorText.isCancellation(error) {
                    errorMessage = SignInErrorText.describe(error)
                }
            }
            busy = false
        }
    }
}
