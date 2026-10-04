import SwiftUI

/// A row that leaves the app: the system decides between Safari and an
/// installed client's universal links.
struct OutboundLinkRow: View {
    let title: String
    let url: String
    var detail: String? = nil
    var systemImage: String = "arrow.up.right"

    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL

    init(title: String, url: String, detail: String? = nil, systemImage: String = "arrow.up.right") {
        self.title = title
        self.url = url
        self.detail = detail
        self.systemImage = systemImage
    }

    private var destination: URL? {
        URL(string: url)
    }

    private var secondary: String {
        if let detail, !detail.isEmpty { return detail }
        return destination?.host ?? url
    }

    var body: some View {
        Button {
            if let destination {
                openURL(destination)
            }
        } label: {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(AturiFont.body)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                    Text(secondary)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                Spacer(minLength: 0)
                Image(systemName: systemImage)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(destination == nil)
        .accessibilityHint("Opens outside the app")
    }
}
