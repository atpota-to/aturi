import Foundation

// Port of src/lib/colorScheme.ts plus the token blocks of src/app/globals.css.
// The scheme is the hue family the whole app is painted in; whether the dark
// or the light variant shows is the separate system appearance. The palette
// values below are lifted verbatim from the `[data-theme][data-scheme]` blocks
// in globals.css: `moss` is the base `:root` / `[data-theme='light']` pair, and
// every other scheme is a pure override on top of it, so a token a scheme's
// block does not name keeps the moss value for that theme (`--danger` and, for
// every scheme but trans, `--text-on-accent`).

/// The eight colour schemes, in the order the settings picker lists them.
/// Raw values are the strings the synced preferences record stores.
public enum ColorScheme: String, Codable, CaseIterable, Sendable, Hashable {
    case moss
    case ember
    case tide
    case dusk
    case sol
    case bloom
    case trans
    case noir

    /// The scheme a fresh install and any unrecognised stored value get.
    public static let `default`: ColorScheme = .moss

    /// Name shown in the settings picker.
    public var label: String {
        switch self {
        case .moss: return "Moss"
        case .ember: return "Ember"
        case .tide: return "Tide"
        case .dusk: return "Dusk"
        case .sol: return "Sol"
        case .bloom: return "Bloom"
        case .trans: return "Trans"
        case .noir: return "Noir"
        }
    }

    /// One-line flavour shown under the name in the settings picker.
    public var hint: String {
        switch self {
        case .moss: return "Forest green, charcoal & paper"
        case .ember: return "Rust and amber on warm black"
        case .tide: return "Deep water blues, misted light"
        case .dusk: return "Violet twilight over ink"
        case .sol: return "Brass and gold over deep umber"
        case .bloom: return "Wild rose on plum, blush paper"
        case .trans: return "Sky blue, pink and white"
        case .noir: return "Black and white, no hue at all"
        }
    }

    /// `isColorScheme`: the stored string when it names a scheme, else nil.
    public init?(stored value: String?) {
        guard let value, let scheme = ColorScheme(rawValue: value) else { return nil }
        self = scheme
    }

    /// The dark or light palette of this scheme.
    public func palette(dark: Bool) -> Palette {
        dark ? Palette.dark[self]! : Palette.light[self]!
    }

    public var darkPalette: Palette { palette(dark: true) }
    public var lightPalette: Palette { palette(dark: false) }
}

/// An `rgba(r, g, b, a)` CSS value split into its components, for the one
/// token (`--border-subtle`) the app draws with alpha over whatever is
/// beneath it.
public struct RGBAComponents: Hashable, Sendable, Codable {
    public let red: Int
    public let green: Int
    public let blue: Int
    public let alpha: Double

    public init(_ red: Int, _ green: Int, _ blue: Int, _ alpha: Double) {
        self.red = red
        self.green = green
        self.blue = blue
        self.alpha = alpha
    }

    /// The CSS spelling, e.g. "rgba(240, 240, 238, 0.12)".
    public var cssValue: String {
        "rgba(\(red), \(green), \(blue), \(Palette.trimmedDecimal(alpha)))"
    }
}

/// The colour tokens the app draws with, as `#rrggbb` hex strings (plus one
/// rgba). The field names follow the CSS custom properties they come from.
public struct Palette: Hashable, Sendable, Codable {
    public let bgPrimary: String
    public let bgSecondary: String
    public let bgTertiary: String
    public let bgElevated: String
    public let accentMoss: String
    public let accentForest: String
    public let textPrimary: String
    public let textSecondary: String
    public let textTertiary: String
    public let textAccent: String
    public let borderSubtle: RGBAComponents
    public let danger: String
    public let textOnAccent: String

    public init(
        bgPrimary: String,
        bgSecondary: String,
        bgTertiary: String,
        bgElevated: String,
        accentMoss: String,
        accentForest: String,
        textPrimary: String,
        textSecondary: String,
        textTertiary: String,
        textAccent: String,
        borderSubtle: RGBAComponents,
        danger: String,
        textOnAccent: String
    ) {
        self.bgPrimary = bgPrimary
        self.bgSecondary = bgSecondary
        self.bgTertiary = bgTertiary
        self.bgElevated = bgElevated
        self.accentMoss = accentMoss
        self.accentForest = accentForest
        self.textPrimary = textPrimary
        self.textSecondary = textSecondary
        self.textTertiary = textTertiary
        self.textAccent = textAccent
        self.borderSubtle = borderSubtle
        self.danger = danger
        self.textOnAccent = textOnAccent
    }

    /// Every hex token keyed by its CSS custom property name, for the drift
    /// test against globals.css and for any UI that wants to iterate.
    public var hexTokens: [String: String] {
        [
            "--bg-primary": bgPrimary,
            "--bg-secondary": bgSecondary,
            "--bg-tertiary": bgTertiary,
            "--bg-elevated": bgElevated,
            "--accent-moss": accentMoss,
            "--accent-forest": accentForest,
            "--text-primary": textPrimary,
            "--text-secondary": textSecondary,
            "--text-tertiary": textTertiary,
            "--text-accent": textAccent,
            "--danger": danger,
            "--text-on-accent": textOnAccent,
        ]
    }

    /// Parses "#rrggbb" (case-insensitive) into 0...255 channels; nil for any
    /// other spelling, so a typo in the tables above fails a test rather than
    /// painting black at runtime.
    public static func rgb(fromHex hex: String) -> (red: Int, green: Int, blue: Int)? {
        guard hex.hasPrefix("#"), hex.count == 7 else { return nil }
        let digits = Array(hex.dropFirst())
        func channel(_ offset: Int) -> Int? {
            Int(String(digits[offset..<offset + 2]), radix: 16)
        }
        guard let r = channel(0), let g = channel(2), let b = channel(4) else { return nil }
        return (r, g, b)
    }

    /// "0.12" rather than "0.120000", matching the CSS source spelling.
    static func trimmedDecimal(_ value: Double) -> String {
        var s = String(format: "%.4f", value)
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }

    // MARK: Tables

    /// `--danger` is scheme-independent in globals.css: one value per theme.
    private static let darkDanger = "#d97070"
    private static let lightDanger = "#a83c35"

    /// `--text-on-accent` is defined once in `:root` and inherited by every
    /// light and dark block except trans, whose pale accent fills need ink.
    private static let mossTextOnAccent = "#f0f0ee"

    /// The `:root` block and each `[data-theme='dark'][data-scheme='...']`
    /// block of globals.css.
    public static let dark: [ColorScheme: Palette] = [
        .moss: Palette(
            bgPrimary: "#0a0a0a", bgSecondary: "#151515", bgTertiary: "#1a1a1a", bgElevated: "#202020",
            accentMoss: "#4a5a3f", accentForest: "#2d3a28",
            textPrimary: "#f0f0ee", textSecondary: "#c4c4c0", textTertiary: "#9a9a96", textAccent: "#a8b89c",
            borderSubtle: RGBAComponents(240, 240, 238, 0.12),
            danger: darkDanger, textOnAccent: mossTextOnAccent
        ),
        .ember: Palette(
            bgPrimary: "#0c0908", bgSecondary: "#171110", bgTertiary: "#1d1614", bgElevated: "#241b18",
            accentMoss: "#8a5236", accentForest: "#4a2a1c",
            textPrimary: "#f4efe9", textSecondary: "#cdc3b8", textTertiary: "#a2968a", textAccent: "#e0a06a",
            borderSubtle: RGBAComponents(244, 239, 233, 0.12),
            danger: darkDanger, textOnAccent: mossTextOnAccent
        ),
        .tide: Palette(
            bgPrimary: "#070a0d", bgSecondary: "#101619", bgTertiary: "#151d22", bgElevated: "#1c262c",
            accentMoss: "#33697d", accentForest: "#1e3a45",
            textPrimary: "#eaf2f5", textSecondary: "#bcc9d0", textTertiary: "#91a2ab", textAccent: "#86c8da",
            borderSubtle: RGBAComponents(234, 242, 245, 0.12),
            danger: darkDanger, textOnAccent: mossTextOnAccent
        ),
        .dusk: Palette(
            bgPrimary: "#09080d", bgSecondary: "#15121c", bgTertiary: "#1b1724", bgElevated: "#221d2c",
            accentMoss: "#5d4b7e", accentForest: "#382c50",
            textPrimary: "#f1eef7", textSecondary: "#c6bed4", textTertiary: "#9c94aa", textAccent: "#b9a7e0",
            borderSubtle: RGBAComponents(241, 238, 247, 0.12),
            danger: darkDanger, textOnAccent: mossTextOnAccent
        ),
        .sol: Palette(
            bgPrimary: "#0b0a06", bgSecondary: "#16140d", bgTertiary: "#1c1911", bgElevated: "#232016",
            accentMoss: "#7d6524", accentForest: "#453a15",
            textPrimary: "#f6f2e6", textSecondary: "#cfc8b2", textTertiary: "#a39c86", textAccent: "#e6c25c",
            borderSubtle: RGBAComponents(246, 242, 230, 0.12),
            danger: darkDanger, textOnAccent: mossTextOnAccent
        ),
        .bloom: Palette(
            bgPrimary: "#0c0709", bgSecondary: "#170f13", bgTertiary: "#1d1418", bgElevated: "#24191e",
            accentMoss: "#8e3550", accentForest: "#4c1c2c",
            textPrimary: "#f8edf1", textSecondary: "#d3c2c9", textTertiary: "#a8959d", textAccent: "#f08fb8",
            borderSubtle: RGBAComponents(248, 237, 241, 0.12),
            danger: darkDanger, textOnAccent: mossTextOnAccent
        ),
        .trans: Palette(
            bgPrimary: "#07080c", bgSecondary: "#14111a", bgTertiary: "#1a1621", bgElevated: "#211c29",
            accentMoss: "#f5a9b8", accentForest: "#8ad7fb",
            textPrimary: "#f6f3f7", textSecondary: "#cbc3d0", textTertiary: "#a197a8", textAccent: "#5bcefa",
            borderSubtle: RGBAComponents(245, 196, 210, 0.14),
            danger: darkDanger, textOnAccent: "#0f1119"
        ),
        .noir: Palette(
            bgPrimary: "#000000", bgSecondary: "#101010", bgTertiary: "#171717", bgElevated: "#1f1f1f",
            accentMoss: "#4e4e4e", accentForest: "#303030",
            textPrimary: "#e9e9e9", textSecondary: "#b4b4b4", textTertiary: "#8c8c8c", textAccent: "#ffffff",
            borderSubtle: RGBAComponents(255, 255, 255, 0.14),
            danger: darkDanger, textOnAccent: mossTextOnAccent
        ),
    ]

    /// The `[data-theme='light']` block and each
    /// `[data-theme='light'][data-scheme='...']` block of globals.css.
    public static let light: [ColorScheme: Palette] = [
        .moss: Palette(
            bgPrimary: "#faf8f3", bgSecondary: "#f1ede4", bgTertiary: "#e8e2d4", bgElevated: "#ffffff",
            accentMoss: "#5d6b51", accentForest: "#4d5a48",
            textPrimary: "#1a1c18", textSecondary: "#3e3f3a", textTertiary: "#5c5d56", textAccent: "#4d5e3f",
            borderSubtle: RGBAComponents(26, 28, 24, 0.14),
            danger: lightDanger, textOnAccent: mossTextOnAccent
        ),
        .ember: Palette(
            bgPrimary: "#fbf4ea", bgSecondary: "#f3e7d8", bgTertiary: "#ead9c4", bgElevated: "#fffdf9",
            accentMoss: "#9a5a33", accentForest: "#6b3a22",
            textPrimary: "#211711", textSecondary: "#443329", textTertiary: "#64513f", textAccent: "#8f4718",
            borderSubtle: RGBAComponents(33, 23, 17, 0.14),
            danger: lightDanger, textOnAccent: mossTextOnAccent
        ),
        .tide: Palette(
            bgPrimary: "#f4f8fa", bgSecondary: "#e7eef2", bgTertiary: "#d9e4ea", bgElevated: "#ffffff",
            accentMoss: "#3a7185", accentForest: "#27505f",
            textPrimary: "#101a1f", textSecondary: "#32424a", textTertiary: "#4e5f68", textAccent: "#1a5e76",
            borderSubtle: RGBAComponents(16, 26, 31, 0.14),
            danger: lightDanger, textOnAccent: mossTextOnAccent
        ),
        .dusk: Palette(
            bgPrimary: "#f8f5fb", bgSecondary: "#efe9f6", bgTertiary: "#e3dbef", bgElevated: "#ffffff",
            accentMoss: "#6a5893", accentForest: "#483b68",
            textPrimary: "#1b1622", textSecondary: "#3b3446", textTertiary: "#575067", textAccent: "#5b3f9c",
            borderSubtle: RGBAComponents(27, 22, 34, 0.14),
            danger: lightDanger, textOnAccent: mossTextOnAccent
        ),
        .sol: Palette(
            bgPrimary: "#fdf8e9", bgSecondary: "#f5edd6", bgTertiary: "#ece0bf", bgElevated: "#fffef9",
            accentMoss: "#7d6320", accentForest: "#55450f",
            textPrimary: "#201d10", textSecondary: "#423c26", textTertiary: "#5d5637", textAccent: "#705405",
            borderSubtle: RGBAComponents(32, 29, 16, 0.14),
            danger: lightDanger, textOnAccent: mossTextOnAccent
        ),
        .bloom: Palette(
            bgPrimary: "#fdf5f8", bgSecondary: "#f7e7ee", bgTertiary: "#efd7e1", bgElevated: "#fffdfe",
            accentMoss: "#9c2f56", accentForest: "#6f1f3c",
            textPrimary: "#22151b", textSecondary: "#453038", textTertiary: "#634d56", textAccent: "#961f56",
            borderSubtle: RGBAComponents(34, 21, 27, 0.14),
            danger: lightDanger, textOnAccent: mossTextOnAccent
        ),
        .trans: Palette(
            bgPrimary: "#f4fafe", bgSecondary: "#fdf1f5", bgTertiary: "#f8e3ea", bgElevated: "#ffffff",
            accentMoss: "#f5a9b8", accentForest: "#86d3f7",
            textPrimary: "#16121a", textSecondary: "#3b3440", textTertiary: "#59505f", textAccent: "#0a5f88",
            borderSubtle: RGBAComponents(92, 40, 58, 0.16),
            danger: lightDanger, textOnAccent: "#16121a"
        ),
        .noir: Palette(
            bgPrimary: "#ffffff", bgSecondary: "#f2f2f2", bgTertiary: "#e6e6e6", bgElevated: "#ffffff",
            accentMoss: "#4a4a4a", accentForest: "#2b2b2b",
            textPrimary: "#171717", textSecondary: "#3d3d3d", textTertiary: "#5e5e5e", textAccent: "#000000",
            borderSubtle: RGBAComponents(0, 0, 0, 0.16),
            danger: lightDanger, textOnAccent: mossTextOnAccent
        ),
    ]
}
