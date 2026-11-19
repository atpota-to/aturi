import SwiftUI
import AturiCore

/// `/tools/share`, port of `src/components/tools/ShareBuilder.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct ShareToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "share", shareQuery: query) {
            ToolPlaceholder(slug: "share", query: query)
        }
    }
}
