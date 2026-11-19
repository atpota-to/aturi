import SwiftUI
import AturiCore

/// `/tools/oauth`, port of `src/components/tools/OAuthChecker.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct OAuthToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "oauth", shareQuery: query) {
            ToolPlaceholder(slug: "oauth", query: query)
        }
    }
}
