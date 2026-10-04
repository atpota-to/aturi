import SwiftUI

/// The app's type roles. Every font is built on a text style so Dynamic
/// Type scales it; the serif display and title carry the web's editorial
/// feel, the monospaced roles are for identifiers.
enum AturiFont {
    /// Page titles: serif, light, the web's display heading.
    static var display: Font { .system(.largeTitle, design: .serif, weight: .light) }
    /// Section and card titles.
    static var title: Font { .system(.title2, design: .serif) }
    /// Row headlines within a card.
    static var subtitle: Font { .system(.headline, design: .serif, weight: .regular) }
    static var body: Font { .body }
    /// DIDs, handles, NSIDs, rkeys and JSON.
    static var mono: Font { .system(.body, design: .monospaced) }
    static var monoSmall: Font { .system(.footnote, design: .monospaced) }
    /// Uppercase tracked captions above a section; pair with `aturiLabel()`.
    static var label: Font { .system(.caption, design: .default, weight: .medium) }
}

extension View {
    /// The web's `.label` treatment: caption size, uppercase, tracked out.
    func aturiLabel() -> some View {
        font(AturiFont.label)
            .textCase(.uppercase)
            .tracking(0.8)
    }
}
