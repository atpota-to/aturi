import SwiftUI
import AturiCore

/// `/tools/stream`, port of `src/components/tools/StreamMonitor.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct StreamToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "stream", shareQuery: query) {
            ToolPlaceholder(slug: "stream", query: query)
        }
    }
}
