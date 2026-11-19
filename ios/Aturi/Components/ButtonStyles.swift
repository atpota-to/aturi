import SwiftUI

/// Filled accent button for the one main action on a screen: the web's
/// Field Notes primary, accent fill, white text, 8pt corners.
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.aturiTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(AturiFont.sans(.body, weight: .medium))
            .foregroundStyle(theme.textOnAccent)
            .padding(.vertical, 12)
            .padding(.horizontal, 16)
            .frame(maxWidth: .infinity)
            .background(
                configuration.isPressed ? theme.accentDeep : theme.accent,
                in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
            )
            .opacity(isEnabled ? 1 : 0.5)
            /* The web's press (motion.css): 120ms in, eased. */
            .animation(AturiMotion.animation(.easeOut(duration: AturiMotion.press), reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

/// Quiet bordered button for everything else: the card colour with the
/// `--border-strong` hairline the web's `fn-btn` rests on, going to the
/// subtle surface with a `--text-tertiary` edge while pressed.
struct SecondaryButtonStyle: ButtonStyle {
    @Environment(\.aturiTheme) private var theme
    @Environment(\.isEnabled) private var isEnabled
    @Environment(\.displayScale) private var displayScale
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
        return configuration.label
            .font(AturiFont.sans(.body, weight: .medium))
            .foregroundStyle(theme.textPrimary)
            .padding(.vertical, 10)
            .padding(.horizontal, 14)
            .background(configuration.isPressed ? theme.surfaceSubtle : theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(configuration.isPressed ? theme.textTertiary : theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
            .opacity(isEnabled ? 1 : 0.5)
            .animation(AturiMotion.animation(.easeOut(duration: AturiMotion.press), reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PrimaryButtonStyle {
    static var aturiPrimary: PrimaryButtonStyle { PrimaryButtonStyle() }
}

extension ButtonStyle where Self == SecondaryButtonStyle {
    static var aturiSecondary: SecondaryButtonStyle { SecondaryButtonStyle() }
}
