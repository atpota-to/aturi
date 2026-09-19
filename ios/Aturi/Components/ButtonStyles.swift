import SwiftUI

/// Filled accent button for the one main action on a screen.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.aturiTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.body.weight(.medium))
            .foregroundStyle(theme.textOnAccent)
            .padding(.vertical, 12)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity)
            .background(
                configuration.isPressed ? theme.accentDeep : theme.accent,
                in: RoundedRectangle(cornerRadius: 10, style: .continuous)
            )
            .opacity(isEnabled ? 1 : 0.5)
    }
}

/// Quiet bordered button for everything else.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.aturiTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.displayScale) private var displayScale

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        return configuration.label
            .font(.body.weight(.medium))
            .foregroundStyle(theme.textPrimary)
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(configuration.isPressed ? theme.bgElevated : theme.bgTertiary, in: shape)
            .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
            .opacity(isEnabled ? 1 : 0.5)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var aturiPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var aturiSecondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}
