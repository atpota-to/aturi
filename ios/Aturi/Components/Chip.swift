import SwiftUI

/// A small capsule tag: a collection count, a status, a family name.
struct Chip: View {
    enum Style {
        case neutral
        case accent
        case danger
    }

    let text: String
    var systemImage: String? = nil
    var style: Style = .neutral

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    init(_ text: String, systemImage: String? = nil, style: Style = .neutral) {
        self.text = text
        self.systemImage = systemImage
        self.style = style
    }

    private var foreground: Color {
        switch style {
        case .neutral: return theme.textSecondary
        case .accent: return theme.textAccent
        case .danger: return theme.danger
        }
    }

    private var background: Color {
        switch style {
        case .neutral: return theme.bgTertiary
        case .accent: return theme.accent.opacity(0.18)
        case .danger: return theme.danger.opacity(0.14)
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.caption2)
            }
            Text(text)
                .font(.caption.weight(.medium))
                .lineLimit(1)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(background, in: Capsule())
        .overlay(Capsule().strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}
