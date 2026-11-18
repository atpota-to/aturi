import SwiftUI

/// The app's type roles, after the web's Field Notes type: Figtree for the
/// interface (headings 700 with slight negative tracking, body 400/500) and
/// IBM Plex Mono for identifiers. Both are bundled in
/// `Resources/Fonts` and registered through `UIAppFonts`. Every font is
/// built with `Font.custom(_:size:relativeTo:)` on a text style so Dynamic
/// Type still scales it; a face that fails to register falls back to the
/// system font at the same size rather than to nothing.
enum AturiFont {
    // MARK: Faces

    /// PostScript names of the bundled static faces.
    private enum Face {
        static let regular = "Figtree-Regular"
        static let medium = "Figtree-Medium"
        static let semibold = "Figtree-SemiBold"
        static let bold = "Figtree-Bold"
        static let extraBold = "Figtree-ExtraBold"
        static let monoRegular = "IBMPlexMono-Regular"
        static let monoMedium = "IBMPlexMono-Medium"
    }

    /// The size each text style has at the default Dynamic Type setting
    /// (Large), which `relativeTo:` then scales from.
    private static func baseSize(_ style: Font.TextStyle) -> CGFloat {
        switch style {
        case .largeTitle: return 34
        case .title: return 28
        case .title2: return 22
        case .title3: return 20
        case .headline: return 17
        case .body: return 17
        case .callout: return 16
        case .subheadline: return 15
        case .footnote: return 13
        case .caption: return 12
        case .caption2: return 11
        @unknown default: return 17
        }
    }

    /// Figtree at a text style's size and one of the bundled weights. Light
    /// and thinner read as regular, heavy and black as extra bold, since
    /// those are the faces the web loads (400 to 800).
    static func sans(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        let face: String
        if weight == .black || weight == .heavy {
            face = Face.extraBold
        } else if weight == .bold {
            face = Face.bold
        } else if weight == .semibold {
            face = Face.semibold
        } else if weight == .medium {
            face = Face.medium
        } else {
            face = Face.regular
        }
        return .custom(face, size: baseSize(style), relativeTo: style)
    }

    /// IBM Plex Mono at a text style's size: regular, or medium for any
    /// weight from medium up (the web loads 400 and 500 only).
    static func monoFont(_ style: Font.TextStyle, weight: Font.Weight = .regular) -> Font {
        let heavier = weight == .medium || weight == .semibold || weight == .bold || weight == .heavy || weight == .black
        return .custom(heavier ? Face.monoMedium : Face.monoRegular, size: baseSize(style), relativeTo: style)
    }

    // MARK: Roles

    /// Page titles: the web's h1, Figtree 700 tracked in. Pair with
    /// `.tracking(AturiFont.displayTracking)`.
    static var display: Font { sans(.largeTitle, weight: .bold) }
    /// -0.025em at 34pt, the web's h1 letter-spacing.
    static let displayTracking: CGFloat = -0.8
    /// Section and card titles: the web's h2, Figtree 700. Pair with
    /// `.tracking(AturiFont.titleTracking)`.
    static var title: Font { sans(.title2, weight: .bold) }
    /// -0.015em at 22pt, the web's h2 letter-spacing.
    static let titleTracking: CGFloat = -0.3
    /// Row headlines within a card.
    static var subtitle: Font { sans(.headline, weight: .semibold) }
    static var body: Font { sans(.body) }
    static var callout: Font { sans(.callout) }
    static var subheadline: Font { sans(.subheadline) }
    static var footnote: Font { sans(.footnote) }
    static var caption: Font { sans(.caption) }
    static var caption2: Font { sans(.caption2) }
    /// DIDs, handles, NSIDs, rkeys and JSON.
    static var mono: Font { monoFont(.body) }
    static var monoSmall: Font { monoFont(.footnote) }
    /// Uppercase tracked captions above a section; pair with `aturiLabel()`.
    static var label: Font { sans(.caption, weight: .semibold) }
}

extension View {
    /// The web's `.label` treatment: caption size, uppercase, tracked out.
    func aturiLabel() -> some View {
        font(AturiFont.label)
            .textCase(.uppercase)
            .tracking(0.8)
    }
}
