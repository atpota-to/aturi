import SwiftUI
import AturiCore

/// `/tools/handle`, port of `src/components/tools/HandleDebugger.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct HandleToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "handle", shareQuery: query) {
            ToolPlaceholder(slug: "handle", query: query)
        }
    }
}
