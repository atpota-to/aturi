import SwiftUI
import AturiCore

/// `AturiCore.ColorScheme` (the eight palettes) and `SwiftUI.ColorScheme`
/// (light or dark) share a name once both modules are imported; this alias
/// names the palette axis without qualification.
typealias AturiColorScheme = AturiCore.ColorScheme

/// Light-or-dark preference. The palette follows the account through the
/// synced preferences; this axis is per device, as it is per browser on
/// the web, and lives in the app group suite under `storageKey` so the
/// share extension paints the same way.
enum Appearance: String, CaseIterable, Identifiable {
    case system
    case dark
    case light

    static let storageKey = "aturi.appearance"

    /// The suite `@AppStorage(Appearance.storageKey, store:)` should read.
    static var defaults: UserDefaults {
        PreferencesStore.appGroupDefaults()
    }

    var id: String { rawValue }

    var label: String {
        switch self {
        case .system: return "Follow system"
        case .dark: return "Dark"
        case .light: return "Light"
        }
    }

    /// What to hand `.preferredColorScheme`; nil lets the system decide.
    var preferredColorScheme: SwiftUI.ColorScheme? {
        switch self {
        case .system: return nil
        case .dark: return .dark
        case .light: return .light
        }
    }

    func isDark(system: SwiftUI.ColorScheme) -> Bool {
        switch self {
        case .system: return system == .dark
        case .dark: return true
        case .light: return false
        }
    }
}

/// The resolved palette as SwiftUI colours. A value type so it can sit in
/// the environment and be compared; `ThemedRoot` rebuilds it when the
/// scheme or the appearance changes.
struct AturiTheme: Equatable {
    let scheme: AturiColorScheme
    let isDark: Bool
    let palette: Palette

    init(scheme: AturiColorScheme = .default, isDark: Bool = true) {
        self.scheme = scheme
        self.isDark = isDark
        self.palette = scheme.palette(dark: isDark)
    }

    var bgPrimary: Color { Color(hex: palette.bgPrimary) }
    var bgSecondary: Color { Color(hex: palette.bgSecondary) }
    var bgTertiary: Color { Color(hex: palette.bgTertiary) }
    var bgElevated: Color { Color(hex: palette.bgElevated) }
    /// `--accent-moss`: buttons, tint, links.
    var accent: Color { Color(hex: palette.accentMoss) }
    /// `--accent-forest`: pressed and filled states.
    var accentDeep: Color { Color(hex: palette.accentForest) }
    var textPrimary: Color { Color(hex: palette.textPrimary) }
    var textSecondary: Color { Color(hex: palette.textSecondary) }
    var textTertiary: Color { Color(hex: palette.textTertiary) }
    var textAccent: Color { Color(hex: palette.textAccent) }
    /// Drawn with alpha over whatever is beneath it, like the CSS token.
    var borderSubtle: Color { Color(rgba: palette.borderSubtle) }
    var danger: Color { Color(hex: palette.danger) }
    var textOnAccent: Color { Color(hex: palette.textOnAccent) }

    var colorScheme: SwiftUI.ColorScheme { isDark ? .dark : .light }

    /// One device pixel, for the hairline borders the web draws at 1px.
    static func hairline(displayScale: CGFloat) -> CGFloat {
        1 / max(displayScale, 1)
    }
}

extension Color {
    /// Parse the palette's spellings: `#rrggbb` (also `#rgb` and
    /// `#rrggbbaa`) and `rgba(r, g, b, a)` / `rgb(r, g, b)`. The palette is
    /// covered by a drift test, so an unparseable string only happens for
    /// hand-typed input; it paints a neutral grey rather than nothing.
    init(hex: String) {
        let channels = Color.channels(from: hex) ?? (0.5, 0.5, 0.5, 1)
        self.init(.sRGB, red: channels.0, green: channels.1, blue: channels.2, opacity: channels.3)
    }

    init(rgba: RGBAComponents) {
        self.init(
            .sRGB,
            red: Double(rgba.red) / 255,
            green: Double(rgba.green) / 255,
            blue: Double(rgba.blue) / 255,
            opacity: rgba.alpha
        )
    }

    private static func channels(from raw: String) -> (Double, Double, Double, Double)? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()

        if trimmed.hasPrefix("rgba(") || trimmed.hasPrefix("rgb(") {
            guard let open = trimmed.firstIndex(of: "("), let close = trimmed.lastIndex(of: ")"), open < close else { return nil }
            let parts = trimmed[trimmed.index(after: open)..<close]
                .split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespaces) }
            guard parts.count >= 3,
                  let red = Double(parts[0]), let green = Double(parts[1]), let blue = Double(parts[2])
            else { return nil }
            let alpha = parts.count > 3 ? (Double(parts[3]) ?? 1) : 1
            return (red / 255, green / 255, blue / 255, alpha)
        }

        var digits = trimmed
        if digits.hasPrefix("#") {
            digits.removeFirst()
        }
        if digits.count == 3 {
            digits = digits.map { "\($0)\($0)" }.joined()
        }
        guard digits.count == 6 || digits.count == 8, let value = UInt64(digits, radix: 16) else { return nil }
        if digits.count == 8 {
            return (
                Double((value >> 24) & 0xff) / 255,
                Double((value >> 16) & 0xff) / 255,
                Double((value >> 8) & 0xff) / 255,
                Double(value & 0xff) / 255
            )
        }
        return (
            Double((value >> 16) & 0xff) / 255,
            Double((value >> 8) & 0xff) / 255,
            Double(value & 0xff) / 255,
            1
        )
    }
}

private struct AturiThemeKey: EnvironmentKey {
    static let defaultValue = AturiTheme()
}

extension EnvironmentValues {
    /// The current palette, read as `@Environment(\.aturiTheme)`.
    var aturiTheme: AturiTheme {
        get { self[AturiThemeKey.self] }
        set { self[AturiThemeKey.self] = newValue }
    }
}

/// Resolves the theme at the root of the scene: the synced colour scheme
/// from `PreferencesStore`, the per-device appearance, and the system's
/// light or dark setting when the appearance follows it. Sets the
/// preferred colour scheme, the tint and the window background so every
/// screen below inherits them.
struct ThemedRoot: ViewModifier {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.colorScheme) private var systemColorScheme
    @AppStorage(Appearance.storageKey, store: Appearance.defaults) private var appearanceRaw = Appearance.system.rawValue

    private var appearance: Appearance {
        Appearance(rawValue: appearanceRaw) ?? .system
    }

    private var theme: AturiTheme {
        AturiTheme(scheme: preferences.prefs.colorScheme, isDark: appearance.isDark(system: systemColorScheme))
    }

    func body(content: Content) -> some View {
        let theme = theme
        return content
            .environment(\.aturiTheme, theme)
            .tint(theme.accent)
            .preferredColorScheme(appearance.preferredColorScheme)
            .background(theme.bgPrimary.ignoresSafeArea())
    }
}

extension View {
    /// Apply once, on the root view, inside the `PreferencesStore` environment.
    func themedRoot() -> some View {
        modifier(ThemedRoot())
    }
}
