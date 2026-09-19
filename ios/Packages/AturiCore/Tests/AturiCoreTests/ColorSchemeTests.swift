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
                XCTAssertEqual(palette.hexTokens.count, 12)
                for (token, hex) in palette.hexTokens {
                    XCTAssertNotNil(Palette.rgb(fromHex: hex), "\(scheme) \(token) = \(hex) does not parse")
                }
                let border = palette.borderSubtle
                for channel in [border.red, border.green, border.blue] {
                    XCTAssertTrue((0...255).contains(channel))
                }
                XCTAssertTrue(border.alpha > 0 && border.alpha < 1)
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
        XCTAssertEqual(ColorScheme.moss.darkPalette.bgPrimary, "#0a0a0a")
        XCTAssertEqual(ColorScheme.moss.lightPalette.bgPrimary, "#faf8f3")
        // --danger is defined once per theme and never per scheme.
        for scheme in ColorScheme.allCases {
            XCTAssertEqual(scheme.darkPalette.danger, "#d97070")
            XCTAssertEqual(scheme.lightPalette.danger, "#a83c35")
        }
        // --text-on-accent is inherited from :root everywhere except trans.
        for scheme in ColorScheme.allCases where scheme != .trans {
            XCTAssertEqual(scheme.darkPalette.textOnAccent, "#f0f0ee")
            XCTAssertEqual(scheme.lightPalette.textOnAccent, "#f0f0ee")
        }
        XCTAssertEqual(ColorScheme.trans.darkPalette.textOnAccent, "#0f1119")
        XCTAssertEqual(ColorScheme.trans.lightPalette.textOnAccent, "#16121a")
        XCTAssertEqual(ColorScheme.noir.lightPalette.borderSubtle, RGBAComponents(0, 0, 0, 0.16))
        XCTAssertEqual(ColorScheme.moss.darkPalette.borderSubtle.cssValue, "rgba(240, 240, 238, 0.12)")
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

    private func rgba(_ value: String) -> RGBAComponents? {
        guard value.hasPrefix("rgba("), value.hasSuffix(")") else { return nil }
        let parts = value.dropFirst(5).dropLast().split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }
        guard parts.count == 4, let r = Int(parts[0]), let g = Int(parts[1]), let b = Int(parts[2]), let a = Double(parts[3]) else { return nil }
        return RGBAComponents(r, g, b, a)
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
                        "--text-primary", "--text-secondary", "--text-tertiary", "--text-accent", "--danger", "--text-on-accent"]
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
                func resolve(_ name: String) -> String? {
                    chain.lazy.compactMap { $0[name] }.first
                }
                let palette = scheme.palette(dark: dark)
                for name in hexNames {
                    XCTAssertEqual(palette.hexTokens[name], resolve(name), "\(scheme) \(dark ? "dark" : "light") \(name)")
                }
                XCTAssertEqual(palette.borderSubtle, resolve("--border-subtle").flatMap(rgba), "\(scheme) \(dark ? "dark" : "light") --border-subtle")
            }
        }
    }
}
