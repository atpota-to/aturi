import SwiftUI
import AturiCore

/// `/tools/mutuals`, port of `src/components/tools/MutualBlocks.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct MutualsToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "mutuals", shareQuery: query) {
            ToolPlaceholder(slug: "mutuals", query: query)
        }
    }
}
