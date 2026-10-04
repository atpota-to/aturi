import SwiftUI

/// Nothing to show, said in a sentence.
struct EmptyState: View {
    let title: String
    var detail: String? = nil
    var systemImage: String = "circle.dashed"

    @Environment(\.aturiTheme) private var theme

    init(title: String, detail: String? = nil, systemImage: String = "circle.dashed") {
        self.title = title
        self.detail = detail
        self.systemImage = systemImage
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(title, systemImage: systemImage)
                .font(AturiFont.subtitle)
                .foregroundStyle(theme.textPrimary)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .combine)
    }
}
