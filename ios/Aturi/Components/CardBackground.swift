import SwiftUI

/// The web's Field Notes card: the card colour (white in light mode), a
/// 1px `--border-medium` hairline, 12pt corners, no shadow.
struct CardBackground: ViewModifier {
    var cornerRadius: CGFloat = AturiTheme.cardRadius

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(theme.borderMedium, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}

extension View {
    func cardBackground(cornerRadius: CGFloat = AturiTheme.cardRadius) -> some View {
        modifier(CardBackground(cornerRadius: cornerRadius))
    }
}
