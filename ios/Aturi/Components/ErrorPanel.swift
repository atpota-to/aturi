import SwiftUI

/// The failure state of a network screen: the message the model produced,
/// selectable so it can be reported, and a retry when the caller has one.
struct ErrorPanel: View {
    let message: String
    var retry: (() -> Void)? = nil

    @Environment(\.aturiTheme) private var theme

    init(message: String, retry: (() -> Void)? = nil) {
        self.message = message
        self.retry = retry
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Could not load", systemImage: "exclamationmark.triangle")
                .font(AturiFont.subtitle)
                .foregroundStyle(theme.danger)
            Text(message)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if let retry {
                Button("Retry", action: retry)
                    .buttonStyle(.aturiSecondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}
