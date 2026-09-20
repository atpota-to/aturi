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
                                .font(.caption)
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
                    .font(.footnote)
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
                .font(.footnote)
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
    @FocusState private var handleFocused: Bool

    private var trimmedHandle: String {
        handle.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSubmit: Bool {
        !trimmedHandle.isEmpty && !busy
    }

    var body: some View {
        List {
            SettingsSection(
                "Sign in to sync",
                footer: "You can use Aturi without signing in: preferences stay on this device. Sign in and they sync to your PDS, so the same setup follows you across devices."
            ) {
                TextField("handle.bsky.social or did:plc:...", text: $handle)
                    .font(AturiFont.mono)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .textContentType(.username)
                    .submitLabel(.go)
                    .focused($handleFocused)
                    .onSubmit(submit)
                    .disabled(busy)
                    .accessibilityLabel("Handle or DID")
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
                                .font(.footnote)
                                .foregroundStyle(theme.textSecondary)
                        }
                    }
                    .disabled(busy)
                }
            }

            Section {
                Button(action: submit) {
                    HStack(spacing: 8) {
                        if busy {
                            ProgressView()
                                .controlSize(.small)
                                .tint(theme.textOnAccent)
                        }
                        Text(busy ? "Waiting for your PDS" : "Sign in")
                    }
                }
                .buttonStyle(.aturiPrimary)
                .disabled(!canSubmit)
                .listRowBackground(Color.clear)
                .listRowInsets(EdgeInsets())

                if let errorMessage {
                    Text(errorMessage)
                        .font(.footnote)
                        .foregroundStyle(theme.danger)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .listRowBackground(Color.clear)
                        .listRowInsets(EdgeInsets())
                }
            } footer: {
                Text("You will be sent to your PDS to authorize Aturi and brought back here. Reads always work because your repo is public.")
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
            }
        }
        .settingsList()
        .navigationTitle("Account")
    }

    private func scopeBinding(_ id: ScopeId) -> Binding<Bool> {
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

    private func submit() {
        guard canSubmit else { return }
        let account = trimmedHandle
        let scope = selected
        handleFocused = false
        busy = true
        errorMessage = nil
        Task { @MainActor in
            do {
                try await sessionStore.signIn(handle: account, scope: scope)
            } catch {
                errorMessage = Self.describe(error)
            }
            busy = false
        }
    }

    /// The store's own wording when it has some; the bare case name of an
    /// enum error otherwise, which is still more useful than the generic
    /// "operation could not be completed".
    private static func describe(_ error: Error) -> String {
        if let localized = error as? LocalizedError, let description = localized.errorDescription, !description.isEmpty {
            return description
        }
        if error is CancellationError {
            return "Sign-in was cancelled."
        }
        return String(describing: error)
    }
}
