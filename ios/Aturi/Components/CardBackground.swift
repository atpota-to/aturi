import SwiftUI

/// The web's card: secondary background, hairline border, no shadow.
struct CardBackground: ViewModifier {
    var cornerRadius: CGFloat = 12

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .background(theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}

extension View {
    func cardBackground(cornerRadius: CGFloat = 12) -> some View {
        modifier(CardBackground(cornerRadius: cornerRadius))
    }
}
