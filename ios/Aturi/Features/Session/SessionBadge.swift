import SwiftUI
import AturiCore

/// The account in a toolbar: avatar and handle as a chip when signed in,
/// with sign out behind it; a sign-in button otherwise. Reads the session
/// through `SessionStoring` only, so it works with the placeholder too.
struct SessionBadge: View {
    @Environment(\.sessionStore) private var sessionStore
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale
    @State private var avatar: String?
    @State private var showSignIn = false

    var body: some View {
        Group {
            if let account = sessionStore.state.session {
                signedIn(account)
            } else {
                Button("Sign in") {
                    showSignIn = true
                }
                .font(.subheadline.weight(.medium))
            }
        }
        .sheet(isPresented: $showSignIn) {
            SignInSheet()
        }
        .onAppear {
            (sessionStore as? SessionStore)?.attach(preferences: preferences)
        }
    }

    private func signedIn(_ account: OAuthSession) -> some View {
        let name = account.handle ?? shortDid(account.did)
        return Menu {
            Button("Sign out", role: .destructive) {
                Task { await sessionStore.signOut() }
            }
        } label: {
            HStack(spacing: 6) {
                AvatarView(url: avatar, size: 22)
                Text(name)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.leading, 3)
            .padding(.trailing, 10)
            .padding(.vertical, 3)
            .background(theme.bgTertiary, in: Capsule())
            .overlay(Capsule().strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        }
        .accessibilityLabel("Signed in as \(name)")
        .task(id: account.did) {
            /* The session carries no avatar; the AppView's profile does.
               A miss (an account it has not indexed) just leaves the
               placeholder. */
            avatar = await AppViewClient().getProfile(account.did)?.avatar
        }
    }
}

/// One line on the preferences mirror, for the account screen: synced,
/// syncing, or the failure text. Draws nothing when signed out, or when
/// the session store is not the one that mirrors preferences.
struct SessionSyncStatusLabel: View {
    @Environment(\.sessionStore) private var sessionStore
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        if let store = sessionStore as? SessionStore, store.state.isSignedIn {
            switch store.syncStatus {
            case .idle:
                Label("Settings are synced to your PDS", systemImage: "checkmark.icloud")
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
            case .syncing:
                Label("Syncing settings", systemImage: "arrow.triangle.2.circlepath")
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
            case .failed(let message):
                VStack(alignment: .leading, spacing: 4) {
                    Label("Settings could not sync", systemImage: "exclamationmark.icloud")
                        .font(.footnote)
                        .foregroundStyle(theme.danger)
                    Text(message)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textSecondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
