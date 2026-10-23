import Foundation

// Port of src/lib/colorScheme.ts plus the token blocks of src/app/globals.css.
// The scheme is the hue family the whole app is painted in; whether the dark
// or the light variant shows is the separate system appearance. The palette
// values below are lifted verbatim from the `[data-theme][data-scheme]` blocks
// in globals.css: `moss` is the base `:root` / `[data-theme='light']` pair, and
// every other scheme is a pure override on top of it, so a token a scheme's
// block does not name keeps the moss value for that theme (`--danger` and, for
// every scheme but trans, `--text-on-accent`). The six Field Notes tokens
// (`--surface-subtle`, `--text-faint`, `--status-live` and the three
// `--accent-soft*`) are hand-picked for moss and computed for every other
// scheme; see `Palette.mix`.

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

/// A CSS border colour split into its components. Most schemes spell their
/// `--border-*` tokens as `rgba(r, g, b, a)` and the app draws them with
/// alpha over whatever is beneath; moss spells them as opaque hex since
/// the Field Notes redesign, which is stored here with an alpha of 1.
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

    /// The CSS spelling, e.g. "rgba(240, 240, 238, 0.12)", or "#2a2c26"
    /// for an opaque value, matching how globals.css writes each.
    public var cssValue: String {
        if alpha >= 1 {
            return String(format: "#%02x%02x%02x", red, green, blue)
        }
        return "rgba(\(red), \(green), \(blue), \(Palette.trimmedDecimal(alpha)))"
    }
}

/// The colour tokens the app draws with, as `#rrggbb` hex strings (plus the
/// three border tokens). The field names follow the CSS custom properties
/// they come from.
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
    /// `--border-subtle`: dividers inside a card.
    public let borderSubtle: RGBAComponents
    /// `--border-medium`: the hairline around cards and controls.
    public let borderMedium: RGBAComponents
    /// `--border-strong`: pressed and hovered outlines.
    public let borderStrong: RGBAComponents
    public let danger: String
    public let textOnAccent: String
    /// `--surface-subtle`: the off-white strip for inset metadata rows and
    /// table heads.
    public let surfaceSubtle: String
    /// `--text-faint`: the quietest text, below tertiary.
    public let textFaint: String
    /// `--status-live`: the "live" dot.
    public let statusLive: String
    /// `--accent-soft`: the pale pill behind a selected row or chip.
    public let accentSoft: String
    /// `--accent-soft-fg`: text on `accentSoft`.
    public let accentSoftFg: String
    /// `--accent-soft-border`: the outline of an `accentSoft` pill.
    public let accentSoftBorder: String

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
        borderMedium: RGBAComponents,
        borderStrong: RGBAComponents,
        danger: String,
        textOnAccent: String,
        surfaceSubtle: String,
        textFaint: String,
        statusLive: String,
        accentSoft: String,
        accentSoftFg: String,
        accentSoftBorder: String
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
        self.borderMedium = borderMedium
        self.borderStrong = borderStrong
        self.danger = danger
        self.textOnAccent = textOnAccent
        self.surfaceSubtle = surfaceSubtle
        self.textFaint = textFaint
        self.statusLive = statusLive
        self.accentSoft = accentSoft
        self.accentSoftFg = accentSoftFg
        self.accentSoftBorder = accentSoftBorder
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
            "--surface-subtle": surfaceSubtle,
            "--text-faint": textFaint,
            "--status-live": statusLive,
            "--accent-soft": accentSoft,
            "--accent-soft-fg": accentSoftFg,
            "--accent-soft-border": accentSoftBorder,
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

    /// `color-mix(in srgb, <color> <percent>, <base>)` for two opaque hex
    /// colours, rounded to the nearest 8-bit channel (halves away from
    /// zero). globals.css derives every non-moss scheme's Field Notes
    /// tokens this way in its `[data-scheme]:not([data-scheme='moss'])`
    /// block; the tables below hold the precomputed results and the drift
    /// test recomputes them from the CSS with this.
    public static func mix(_ color: String, _ fraction: Double, over base: String) -> String? {
        guard let top = rgb(fromHex: color), let bottom = rgb(fromHex: base) else { return nil }
        func channel(_ a: Int, _ b: Int) -> Int {
            Int((Double(a) * fraction + Double(b) * (1 - fraction)).rounded())
        }
        return String(
            format: "#%02x%02x%02x",
            channel(top.red, bottom.red),
            channel(top.green, bottom.green),
            channel(top.blue, bottom.blue)
        )
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
    private static let mossTextOnAccent = "#ffffff"

    /* The six Field Notes tokens are hand-picked for moss in `:root` and
       `[data-theme='light']`. Every other scheme takes them from the
       `[data-scheme]:not([data-scheme='moss'])` block of globals.css, each
       a mix of the scheme's own colours over its card colour (see `mix`):
         --accent-soft         text-accent 14% over bg-secondary
         --accent-soft-fg      text-accent
         --accent-soft-border  text-accent 28% over bg-secondary
         --surface-subtle      bg-tertiary 50% over bg-secondary
         --text-faint          text-tertiary 65% over bg-secondary
         --status-live         text-accent */

    /// The `:root` block and each `[data-theme='dark'][data-scheme='...']`
    /// block of globals.css.
    public static let dark: [ColorScheme: Palette] = [
        .moss: Palette(
            bgPrimary: "#141512", bgSecondary: "#1c1d19", bgTertiary: "#24261f", bgElevated: "#22241e",
            accentMoss: "#3f5e2e", accentForest: "#4f7139",
            textPrimary: "#edeee8", textSecondary: "#bfc1b8", textTertiary: "#959789", textAccent: "#a9c48f",
            borderSubtle: RGBAComponents(42, 44, 38, 1),
            borderMedium: RGBAComponents(51, 53, 46, 1),
            borderStrong: RGBAComponents(67, 70, 61, 1),
            danger: darkDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#20221d", textFaint: "#6f7168", statusLive: "#7fae66",
            accentSoft: "#26301f", accentSoftFg: "#c5dbb2", accentSoftBorder: "#34422a"
        ),
        .ember: Palette(
            bgPrimary: "#0c0908", bgSecondary: "#171110", bgTertiary: "#1d1614", bgElevated: "#241b18",
            accentMoss: "#8a5236", accentForest: "#4a2a1c",
            textPrimary: "#f4efe9", textSecondary: "#cdc3b8", textTertiary: "#a2968a", textAccent: "#e0a06a",
            borderSubtle: RGBAComponents(244, 239, 233, 0.12),
            borderMedium: RGBAComponents(244, 239, 233, 0.18),
            borderStrong: RGBAComponents(244, 239, 233, 0.24),
            danger: darkDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#1a1412", textFaint: "#71675f", statusLive: "#e0a06a",
            accentSoft: "#33251d", accentSoftFg: "#e0a06a", accentSoftBorder: "#4f3929"
        ),
        .tide: Palette(
            bgPrimary: "#070a0d", bgSecondary: "#101619", bgTertiary: "#151d22", bgElevated: "#1c262c",
            accentMoss: "#33697d", accentForest: "#1e3a45",
            textPrimary: "#eaf2f5", textSecondary: "#bcc9d0", textTertiary: "#91a2ab", textAccent: "#86c8da",
            borderSubtle: RGBAComponents(234, 242, 245, 0.12),
            borderMedium: RGBAComponents(234, 242, 245, 0.18),
            borderStrong: RGBAComponents(234, 242, 245, 0.24),
            danger: darkDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#131a1e", textFaint: "#647178", statusLive: "#86c8da",
            accentSoft: "#212f34", accentSoftFg: "#86c8da", accentSoftBorder: "#31484f"
        ),
        .dusk: Palette(
            bgPrimary: "#09080d", bgSecondary: "#15121c", bgTertiary: "#1b1724", bgElevated: "#221d2c",
            accentMoss: "#5d4b7e", accentForest: "#382c50",
            textPrimary: "#f1eef7", textSecondary: "#c6bed4", textTertiary: "#9c94aa", textAccent: "#b9a7e0",
            borderSubtle: RGBAComponents(241, 238, 247, 0.12),
            borderMedium: RGBAComponents(241, 238, 247, 0.18),
            borderStrong: RGBAComponents(241, 238, 247, 0.24),
            danger: darkDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#181520", textFaint: "#6d6778", statusLive: "#b9a7e0",
            accentSoft: "#2c2737", accentSoftFg: "#b9a7e0", accentSoftBorder: "#433c53"
        ),
        .sol: Palette(
            bgPrimary: "#0b0a06", bgSecondary: "#16140d", bgTertiary: "#1c1911", bgElevated: "#232016",
            accentMoss: "#7d6524", accentForest: "#453a15",
            textPrimary: "#f6f2e6", textSecondary: "#cfc8b2", textTertiary: "#a39c86", textAccent: "#e6c25c",
            borderSubtle: RGBAComponents(246, 242, 230, 0.12),
            borderMedium: RGBAComponents(246, 242, 230, 0.18),
            borderStrong: RGBAComponents(246, 242, 230, 0.24),
            danger: darkDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#19170f", textFaint: "#726c5c", statusLive: "#e6c25c",
            accentSoft: "#332c18", accentSoftFg: "#e6c25c", accentSoftBorder: "#504523"
        ),
        .bloom: Palette(
            bgPrimary: "#0c0709", bgSecondary: "#170f13", bgTertiary: "#1d1418", bgElevated: "#24191e",
            accentMoss: "#8e3550", accentForest: "#4c1c2c",
            textPrimary: "#f8edf1", textSecondary: "#d3c2c9", textTertiary: "#a8959d", textAccent: "#f08fb8",
            borderSubtle: RGBAComponents(248, 237, 241, 0.12),
            borderMedium: RGBAComponents(248, 237, 241, 0.18),
            borderStrong: RGBAComponents(248, 237, 241, 0.24),
            danger: darkDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#1a1216", textFaint: "#75666d", statusLive: "#f08fb8",
            accentSoft: "#35212a", accentSoftFg: "#f08fb8", accentSoftBorder: "#543341"
        ),
        .trans: Palette(
            bgPrimary: "#07080c", bgSecondary: "#14111a", bgTertiary: "#1a1621", bgElevated: "#211c29",
            accentMoss: "#f5a9b8", accentForest: "#8ad7fb",
            textPrimary: "#f6f3f7", textSecondary: "#cbc3d0", textTertiary: "#a197a8", textAccent: "#5bcefa",
            borderSubtle: RGBAComponents(245, 196, 210, 0.14),
            borderMedium: RGBAComponents(245, 196, 210, 0.22),
            borderStrong: RGBAComponents(245, 196, 210, 0.3),
            danger: darkDanger, textOnAccent: "#0f1119",
            surfaceSubtle: "#17141e", textFaint: "#706876", statusLive: "#5bcefa",
            accentSoft: "#1e2b39", accentSoftFg: "#5bcefa", accentSoftBorder: "#284659"
        ),
        .noir: Palette(
            bgPrimary: "#000000", bgSecondary: "#101010", bgTertiary: "#171717", bgElevated: "#1f1f1f",
            accentMoss: "#4e4e4e", accentForest: "#303030",
            textPrimary: "#e9e9e9", textSecondary: "#b4b4b4", textTertiary: "#8c8c8c", textAccent: "#ffffff",
            borderSubtle: RGBAComponents(255, 255, 255, 0.14),
            borderMedium: RGBAComponents(255, 255, 255, 0.22),
            borderStrong: RGBAComponents(255, 255, 255, 0.3),
            danger: darkDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#141414", textFaint: "#616161", statusLive: "#ffffff",
            accentSoft: "#313131", accentSoftFg: "#ffffff", accentSoftBorder: "#535353"
        ),
    ]

    /// The `[data-theme='light']` block and each
    /// `[data-theme='light'][data-scheme='...']` block of globals.css.
    public static let light: [ColorScheme: Palette] = [
        .moss: Palette(
            bgPrimary: "#f6f4ee", bgSecondary: "#ffffff", bgTertiary: "#f1eee6", bgElevated: "#ffffff",
            accentMoss: "#3f5e2e", accentForest: "#2b4320",
            textPrimary: "#1c1e19", textSecondary: "#4a4c44", textTertiary: "#6b6d64", textAccent: "#3f5e2e",
            borderSubtle: RGBAComponents(237, 234, 226, 1),
            borderMedium: RGBAComponents(226, 222, 211, 1),
            borderStrong: RGBAComponents(217, 212, 199, 1),
            danger: lightDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#faf9f5", textFaint: "#a3a59c", statusLive: "#5e8c4a",
            accentSoft: "#e5ecdc", accentSoftFg: "#2b4320", accentSoftBorder: "#d9e4cc"
        ),
        .ember: Palette(
            bgPrimary: "#fbf4ea", bgSecondary: "#f3e7d8", bgTertiary: "#ead9c4", bgElevated: "#fffdf9",
            accentMoss: "#9a5a33", accentForest: "#6b3a22",
            textPrimary: "#211711", textSecondary: "#443329", textTertiary: "#64513f", textAccent: "#8f4718",
            borderSubtle: RGBAComponents(33, 23, 17, 0.14),
            borderMedium: RGBAComponents(33, 23, 17, 0.22),
            borderStrong: RGBAComponents(33, 23, 17, 0.32),
            danger: lightDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#efe0ce", textFaint: "#968675", statusLive: "#8f4718",
            accentSoft: "#e5d1bd", accentSoftFg: "#8f4718", accentSoftBorder: "#d7baa2"
        ),
        .tide: Palette(
            bgPrimary: "#f4f8fa", bgSecondary: "#e7eef2", bgTertiary: "#d9e4ea", bgElevated: "#ffffff",
            accentMoss: "#3a7185", accentForest: "#27505f",
            textPrimary: "#101a1f", textSecondary: "#32424a", textTertiary: "#4e5f68", textAccent: "#1a5e76",
            borderSubtle: RGBAComponents(16, 26, 31, 0.14),
            borderMedium: RGBAComponents(16, 26, 31, 0.22),
            borderStrong: RGBAComponents(16, 26, 31, 0.32),
            danger: lightDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#e0e9ee", textFaint: "#849198", statusLive: "#1a5e76",
            accentSoft: "#cadae1", accentSoftFg: "#1a5e76", accentSoftBorder: "#aec6cf"
        ),
        .dusk: Palette(
            bgPrimary: "#f8f5fb", bgSecondary: "#efe9f6", bgTertiary: "#e3dbef", bgElevated: "#ffffff",
            accentMoss: "#6a5893", accentForest: "#483b68",
            textPrimary: "#1b1622", textSecondary: "#3b3446", textTertiary: "#575067", textAccent: "#5b3f9c",
            borderSubtle: RGBAComponents(27, 22, 34, 0.14),
            borderMedium: RGBAComponents(27, 22, 34, 0.22),
            borderStrong: RGBAComponents(27, 22, 34, 0.32),
            danger: lightDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#e9e2f3", textFaint: "#8c8699", statusLive: "#5b3f9c",
            accentSoft: "#dad1e9", accentSoftFg: "#5b3f9c", accentSoftBorder: "#c6b9dd"
        ),
        .sol: Palette(
            bgPrimary: "#fdf8e9", bgSecondary: "#f5edd6", bgTertiary: "#ece0bf", bgElevated: "#fffef9",
            accentMoss: "#7d6320", accentForest: "#55450f",
            textPrimary: "#201d10", textSecondary: "#423c26", textTertiary: "#5d5637", textAccent: "#705405",
            borderSubtle: RGBAComponents(32, 29, 16, 0.14),
            borderMedium: RGBAComponents(32, 29, 16, 0.22),
            borderStrong: RGBAComponents(32, 29, 16, 0.32),
            danger: lightDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#f1e7cb", textFaint: "#928b6f", statusLive: "#705405",
            accentSoft: "#e2d8b9", accentSoftFg: "#705405", accentSoftBorder: "#d0c29b"
        ),
        .bloom: Palette(
            bgPrimary: "#fdf5f8", bgSecondary: "#f7e7ee", bgTertiary: "#efd7e1", bgElevated: "#fffdfe",
            accentMoss: "#9c2f56", accentForest: "#6f1f3c",
            textPrimary: "#22151b", textSecondary: "#453038", textTertiary: "#634d56", textAccent: "#961f56",
            borderSubtle: RGBAComponents(34, 21, 27, 0.14),
            borderMedium: RGBAComponents(34, 21, 27, 0.22),
            borderStrong: RGBAComponents(34, 21, 27, 0.32),
            danger: lightDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#f3dfe8", textFaint: "#97838b", statusLive: "#961f56",
            accentSoft: "#e9cbd9", accentSoftFg: "#961f56", accentSoftBorder: "#dcafc3"
        ),
        .trans: Palette(
            bgPrimary: "#f4fafe", bgSecondary: "#fdf1f5", bgTertiary: "#f8e3ea", bgElevated: "#ffffff",
            accentMoss: "#f5a9b8", accentForest: "#86d3f7",
            textPrimary: "#16121a", textSecondary: "#3b3440", textTertiary: "#59505f", textAccent: "#0a5f88",
            borderSubtle: RGBAComponents(92, 40, 58, 0.16),
            borderMedium: RGBAComponents(92, 40, 58, 0.26),
            borderStrong: RGBAComponents(92, 40, 58, 0.36),
            danger: lightDanger, textOnAccent: "#16121a",
            surfaceSubtle: "#fbeaf0", textFaint: "#928894", statusLive: "#0a5f88",
            accentSoft: "#dbdde6", accentSoftFg: "#0a5f88", accentSoftBorder: "#b9c8d6"
        ),
        .noir: Palette(
            bgPrimary: "#ffffff", bgSecondary: "#f2f2f2", bgTertiary: "#e6e6e6", bgElevated: "#ffffff",
            accentMoss: "#4a4a4a", accentForest: "#2b2b2b",
            textPrimary: "#171717", textSecondary: "#3d3d3d", textTertiary: "#5e5e5e", textAccent: "#000000",
            borderSubtle: RGBAComponents(0, 0, 0, 0.16),
            borderMedium: RGBAComponents(0, 0, 0, 0.24),
            borderStrong: RGBAComponents(0, 0, 0, 0.34),
            danger: lightDanger, textOnAccent: mossTextOnAccent,
            surfaceSubtle: "#ececec", textFaint: "#929292", statusLive: "#000000",
            accentSoft: "#d0d0d0", accentSoftFg: "#000000", accentSoftBorder: "#aeaeae"
        ),
    ]
}
