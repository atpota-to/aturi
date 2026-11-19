import SwiftUI
import AturiCore

/// `/tools/resolve`, port of `src/components/tools/BulkResolver.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct ResolveToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "resolve", shareQuery: query) {
            ToolPlaceholder(slug: "resolve", query: query)
        }
    }
}
