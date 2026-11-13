import Foundation
import XCTest
@testable import AturiCore

/// The palette tables are a hand transcription of globals.css, so besides
/// the shape checks there is a drift test that parses the CSS from the repo
/// checkout and compares every token, inheritance rules included. Outside
/// the repo it skips.
final class ColorSchemeTests: XCTestCase {
    func testEveryCaseHasLabelHintAndBothPalettes() {
        XCTAssertEqual(ColorScheme.allCases.count, 8)
        XCTAssertEqual(ColorScheme.allCases.map(\.rawValue), ["moss", "ember", "tide", "dusk", "sol", "bloom", "trans", "noir"])
        for scheme in ColorScheme.allCases {
            XCTAssertFalse(scheme.label.isEmpty)
            XCTAssertFalse(scheme.hint.isEmpty)
            XCTAssertNotNil(Palette.dark[scheme], "no dark palette for \(scheme)")
            XCTAssertNotNil(Palette.light[scheme], "no light palette for \(scheme)")
            XCTAssertEqual(scheme.palette(dark: true), scheme.darkPalette)
            XCTAssertEqual(scheme.palette(dark: false), scheme.lightPalette)
            XCTAssertNotEqual(scheme.darkPalette, scheme.lightPalette)
        }
    }

    func testLabelsAndHintsMatchColorSchemeTs() {
        let expected: [(ColorScheme, String, String)] = [
            (.moss, "Moss", "Forest green, charcoal & paper"),
            (.ember, "Ember", "Rust and amber on warm black"),
            (.tide, "Tide", "Deep water blues, misted light"),
            (.dusk, "Dusk", "Violet twilight over ink"),
            (.sol, "Sol", "Brass and gold over deep umber"),
            (.bloom, "Bloom", "Wild rose on plum, blush paper"),
            (.trans, "Trans", "Sky blue, pink and white"),
            (.noir, "Noir", "Black and white, no hue at all"),
        ]
        for (scheme, label, hint) in expected {
            XCTAssertEqual(scheme.label, label)
            XCTAssertEqual(scheme.hint, hint)
        }
    }

    func testEveryHexParsesAndAlphaIsInRange() {
        for scheme in ColorScheme.allCases {
            for palette in [scheme.darkPalette, scheme.lightPalette] {
                XCTAssertEqual(palette.hexTokens.count, 18)
                for (token, hex) in palette.hexTokens {
                    XCTAssertNotNil(Palette.rgb(fromHex: hex), "\(scheme) \(token) = \(hex) does not parse")
                }
                for border in [palette.borderSubtle, palette.borderMedium, palette.borderStrong] {
                    for channel in [border.red, border.green, border.blue] {
                        XCTAssertTrue((0...255).contains(channel))
                    }
                    XCTAssertTrue(border.alpha > 0 && border.alpha <= 1)
                }
            }
        }
        XCTAssertEqual(Palette.rgb(fromHex: "#0a0a0a").map { [$0.red, $0.green, $0.blue] }, [10, 10, 10])
        XCTAssertEqual(Palette.rgb(fromHex: "#FFFFFF").map { [$0.red, $0.green, $0.blue] }, [255, 255, 255])
        XCTAssertNil(Palette.rgb(fromHex: "0a0a0a"))
        XCTAssertNil(Palette.rgb(fromHex: "#0a0"))
        XCTAssertNil(Palette.rgb(fromHex: "#0g0a0a"))
    }

    func testStoredValueParsing() {
        XCTAssertEqual(ColorScheme(stored: "ember"), .ember)
        XCTAssertNil(ColorScheme(stored: "bogus"))
        XCTAssertNil(ColorScheme(stored: "Moss"))
        XCTAssertNil(ColorScheme(stored: nil))
        XCTAssertEqual(ColorScheme.default, .moss)
    }

    func testInheritanceRules() {
        // moss is the base :root / [data-theme='light'] pair.
        XCTAssertEqual(ColorScheme.moss.darkPalette.bgPrimary, "#141512")
        XCTAssertEqual(ColorScheme.moss.lightPalette.bgPrimary, "#f6f4ee")
        XCTAssertEqual(ColorScheme.moss.lightPalette.bgSecondary, "#ffffff")
        XCTAssertEqual(ColorScheme.moss.lightPalette.accentMoss, "#3f5e2e")
        // --danger is defined once per theme and never per scheme.
        for scheme in ColorScheme.allCases {
            XCTAssertEqual(scheme.darkPalette.danger, "#d97070")
            XCTAssertEqual(scheme.lightPalette.danger, "#a83c35")
        }
        // --text-on-accent is inherited from :root everywhere except trans.
        for scheme in ColorScheme.allCases where scheme != .trans {
            XCTAssertEqual(scheme.darkPalette.textOnAccent, "#ffffff")
            XCTAssertEqual(scheme.lightPalette.textOnAccent, "#ffffff")
        }
        // The Field Notes tokens are hand-picked for moss...
        XCTAssertEqual(ColorScheme.moss.lightPalette.surfaceSubtle, "#faf9f5")
        XCTAssertEqual(ColorScheme.moss.darkPalette.surfaceSubtle, "#20221d")
        XCTAssertEqual(ColorScheme.moss.lightPalette.textFaint, "#a3a59c")
        XCTAssertEqual(ColorScheme.moss.lightPalette.statusLive, "#5e8c4a")
        XCTAssertEqual(ColorScheme.moss.lightPalette.accentSoft, "#e5ecdc")
        XCTAssertEqual(ColorScheme.moss.lightPalette.accentSoftFg, "#2b4320")
        XCTAssertEqual(ColorScheme.moss.lightPalette.accentSoftBorder, "#d9e4cc")
        XCTAssertEqual(ColorScheme.moss.darkPalette.accentSoft, "#26301f")
        // ...and mixed from each other scheme's own colours.
        for scheme in ColorScheme.allCases where scheme != .moss {
            for palette in [scheme.darkPalette, scheme.lightPalette] {
                XCTAssertEqual(palette.accentSoft, Palette.mix(palette.textAccent, 0.14, over: palette.bgSecondary), "\(scheme)")
                XCTAssertEqual(palette.accentSoftFg, palette.textAccent, "\(scheme)")
                XCTAssertEqual(palette.accentSoftBorder, Palette.mix(palette.textAccent, 0.28, over: palette.bgSecondary), "\(scheme)")
                XCTAssertEqual(palette.surfaceSubtle, Palette.mix(palette.bgTertiary, 0.5, over: palette.bgSecondary), "\(scheme)")
                XCTAssertEqual(palette.textFaint, Palette.mix(palette.textTertiary, 0.65, over: palette.bgSecondary), "\(scheme)")
                XCTAssertEqual(palette.statusLive, palette.textAccent, "\(scheme)")
            }
        }
        XCTAssertEqual(ColorScheme.trans.darkPalette.textOnAccent, "#0f1119")
        XCTAssertEqual(ColorScheme.trans.lightPalette.textOnAccent, "#16121a")
        XCTAssertEqual(ColorScheme.noir.lightPalette.borderSubtle, RGBAComponents(0, 0, 0, 0.16))
        XCTAssertEqual(ColorScheme.moss.darkPalette.borderSubtle, RGBAComponents(42, 44, 38, 1))
        XCTAssertEqual(ColorScheme.moss.darkPalette.borderSubtle.cssValue, "#2a2c26")
        XCTAssertEqual(ColorScheme.moss.lightPalette.borderMedium.cssValue, "#e2ded3")
        XCTAssertEqual(ColorScheme.ember.darkPalette.borderSubtle.cssValue, "rgba(244, 239, 233, 0.12)")
    }

    func testMixMatchesCssColorMix() {
        XCTAssertEqual(Palette.mix("#ffffff", 0.5, over: "#000000"), "#808080")
        XCTAssertEqual(Palette.mix("#e0a06a", 0.14, over: "#171110"), "#33251d")
        XCTAssertEqual(Palette.mix("#a9c48f", 0, over: "#1c1d19"), "#1c1d19")
        XCTAssertEqual(Palette.mix("#010101", 0.5, over: "#000000"), "#010101", "halves round away from zero")
        XCTAssertNil(Palette.mix("teal", 0.14, over: "#000000"))
    }

    // MARK: Drift against globals.css

    private var repoRoot: URL {
        if let override = ProcessInfo.processInfo.environment["ATURI_REPO_ROOT"] {
            return URL(fileURLWithPath: override)
        }
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // AturiCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // AturiCore
            .deletingLastPathComponent() // Packages
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repo root
    }

    /// The `--token: value;` pairs of the block whose selector line is
    /// exactly `selector {`.
    private func cssBlock(_ selector: String, in source: String) -> [String: String]? {
        guard let start = source.range(of: "\n" + selector + " {\n") else { return nil }
        guard let end = source.range(of: "\n}\n", range: start.upperBound..<source.endIndex) else { return nil }
        var tokens: [String: String] = [:]
        for line in source[start.upperBound..<end.lowerBound].split(separator: "\n") {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("--"), let colon = trimmed.firstIndex(of: ":"), let semicolon = trimmed.firstIndex(of: ";") else { continue }
            let name = String(trimmed[trimmed.startIndex..<colon])
            let value = trimmed[trimmed.index(after: colon)..<semicolon].trimmingCharacters(in: .whitespaces)
            tokens[name] = value
        }
        return tokens
    }

    /// `rgba(r, g, b, a)`, or an opaque `#rrggbb` as alpha 1 (moss's
    /// borders since the Field Notes redesign).
    private func rgba(_ value: String) -> RGBAComponents? {
        if let rgb = Palette.rgb(fromHex: value) {
            return RGBAComponents(rgb.red, rgb.green, rgb.blue, 1)
        }
        guard value.hasPrefix("rgba("), value.hasSuffix(")") else { return nil }
        let parts = value.dropFirst(5).dropLast().split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 4, let r = Int(parts[0]), let g = Int(parts[1]), let b = Int(parts[2]), let a = Double(parts[3]) else { return nil }
        return RGBAComponents(r, g, b, a)
    }

    /// `var(--x)` or `color-mix(in srgb, var(--a) N%, var(--b))`, the two
    /// spellings the derived scheme block uses, against `lookup`; nil for
    /// anything else so a new spelling fails the comparison loudly.
    private func evaluate(_ expression: String, _ lookup: (String) -> String?) -> String? {
        func variable(_ text: Substring) -> String? {
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("var("), trimmed.hasSuffix(")") else { return nil }
            return String(trimmed.dropFirst(4).dropLast())
        }
        if let name = variable(Substring(expression)) {
            return lookup(name)
        }
        let prefix = "color-mix(in srgb, "
        guard expression.hasPrefix(prefix), expression.hasSuffix(")") else { return nil }
        let parts = expression.dropFirst(prefix.count).dropLast().split(separator: ",")
        guard parts.count == 2 else { return nil }
        let first = parts[0].trimmingCharacters(in: .whitespaces)
        guard let space = first.lastIndex(of: " "), first.hasSuffix("%"),
              let percent = Double(first[first.index(after: space)...].dropLast()),
              let topName = variable(first[..<space]),
              let bottomName = variable(parts[1]),
              let top = lookup(topName), let bottom = lookup(bottomName)
        else { return nil }
        return Palette.mix(top, percent / 100, over: bottom)
    }

    func testPalettesMatchGlobalsCss() throws {
        let file = repoRoot.appendingPathComponent("src/app/globals.css")
        guard let css = try? String(contentsOf: file, encoding: .utf8) else {
            throw XCTSkip("globals.css not available at \(file.path)")
        }
        guard let root = cssBlock(":root", in: css), let lightBase = cssBlock("[data-theme='light']", in: css) else {
            return XCTFail("base theme blocks not found in globals.css")
        }
        let hexNames = ["--bg-primary", "--bg-secondary", "--bg-tertiary", "--bg-elevated", "--accent-moss", "--accent-forest",
                        "--text-primary", "--text-secondary", "--text-tertiary", "--text-accent", "--danger", "--text-on-accent",
                        "--surface-subtle", "--text-faint", "--status-live", "--accent-soft", "--accent-soft-fg", "--accent-soft-border"]
        // Every scheme but moss takes its Field Notes tokens from this block
        // of `color-mix(...)` / `var(...)` expressions, evaluated below
        // against the scheme's own resolved colours.
        guard let derived = cssBlock("[data-scheme]:not([data-scheme='moss'])", in: css) else {
            return XCTFail("[data-scheme]:not([data-scheme='moss']) block not found in globals.css")
        }
        XCTAssertNotNil(derived["--accent-soft"], "the derived block no longer sets --accent-soft")
        for scheme in ColorScheme.allCases {
            for dark in [true, false] {
                // A scheme block overrides the theme's base block, which for
                // light mode overrides :root in turn.
                var chain: [[String: String]] = dark ? [root] : [lightBase, root]
                if scheme != .moss {
                    let selector = "[data-theme='\(dark ? "dark" : "light")'][data-scheme='\(scheme.rawValue)']"
                    guard let block = cssBlock(selector, in: css) else {
                        XCTFail("\(selector) block not found in globals.css")
                        continue
                    }
                    chain.insert(block, at: 0)
                }
                func base(_ name: String) -> String? {
                    chain.lazy.compactMap { $0[name] }.first
                }
                func resolve(_ name: String) -> String? {
                    guard scheme != .moss, let expression = derived[name] else { return base(name) }
                    return evaluate(expression, base)
                }
                let palette = scheme.palette(dark: dark)
                for name in hexNames {
                    XCTAssertEqual(palette.hexTokens[name], resolve(name), "\(scheme) \(dark ? "dark" : "light") \(name)")
                }
                XCTAssertEqual(palette.borderSubtle, resolve("--border-subtle").flatMap(rgba), "\(scheme) \(dark ? "dark" : "light") --border-subtle")
                XCTAssertEqual(palette.borderMedium, resolve("--border-medium").flatMap(rgba), "\(scheme) \(dark ? "dark" : "light") --border-medium")
                XCTAssertEqual(palette.borderStrong, resolve("--border-strong").flatMap(rgba), "\(scheme) \(dark ? "dark" : "light") --border-strong")
            }
        }
    }
}
