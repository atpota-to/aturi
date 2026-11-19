import SwiftUI
import AturiCore

/// The account in a toolbar: avatar and handle as a chip when signed in,
/// with sign out behind it; a sign-in button otherwise. Reads the session
/// through `SessionStoring` only, so it works with the placeholder too.
struct SessionBadge: View {
    @Environment(\.sessionStore) private var sessionStore
    @Environment(PreferencesStore.self) private var preferences
    @Environment(AppRouter.self) private var router: AppRouter?
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
                .font(AturiFont.sans(.subheadline, weight: .medium))
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
            /* The web's session menu (SessionMenu.tsx): the account's own
               repo, Settings, then Sign out. */
            if let router {
                Button {
                    router.open(.repo(account.did), in: .explore)
                } label: {
                    Label("My repo in Explorer", systemImage: "binoculars")
                }
                Button {
                    router.popToRoot(.settings)
                    router.select(.settings)
                } label: {
                    Label("Settings", systemImage: "gearshape")
                }
                Divider()
            }
            Button(role: .destructive) {
                Task { await sessionStore.signOut() }
            } label: {
                Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
            }
        } label: {
            /* The web's account chip (1d9c62b): a squared-off avatar in a
               control-radius chip with the strong edge, the handle in the
               sans at 600. */
            HStack(spacing: 7) {
                AvatarView(url: avatar, size: 24, squareCornerRadius: 6)
                Text(name)
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.leading, 4)
            .padding(.trailing, 10)
            .padding(.vertical, 4)
            .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
                    .strokeBorder(theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale))
            )
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
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
            case .syncing:
                Label("Syncing settings", systemImage: "arrow.triangle.2.circlepath")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
            case .failed(let message):
                VStack(alignment: .leading, spacing: 4) {
                    Label("Settings could not sync", systemImage: "exclamationmark.icloud")
                        .font(AturiFont.footnote)
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
