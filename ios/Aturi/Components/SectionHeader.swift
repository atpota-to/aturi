import SwiftUI

/// Uppercase tracked heading with an optional line of detail beneath.
struct SectionHeader: View {
    let title: String
    var detail: String? = nil

    @Environment(\.aturiTheme) private var theme

    init(_ title: String, detail: String? = nil) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
