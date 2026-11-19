import SwiftUI

/// A small capsule tag: a collection count, a status, a family name. The
/// accent style is the web's Field Notes soft pill, which wears the firmer
/// `--accent-soft-ring` and a semibold label (fd3c9c9); the neutral one is
/// the web's plain pill, the card colour with a medium hairline.
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
        case .accent: return theme.accentSoftFg
        case .danger: return theme.danger
        }
    }

    private var border: Color {
        switch style {
        case .neutral: return theme.borderMedium
        case .accent: return theme.accentSoftRing
        case .danger: return theme.danger.opacity(0.3)
        }
    }

    private var background: Color {
        switch style {
        case .neutral: return theme.bgSecondary
        case .accent: return theme.accentSoft
        case .danger: return theme.danger.opacity(0.14)
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(AturiFont.caption2)
            }
            Text(text)
                .font(AturiFont.sans(.caption, weight: style == .accent ? .semibold : .medium))
                .lineLimit(1)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(background, in: Capsule())
        .overlay(Capsule().strokeBorder(border, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}
