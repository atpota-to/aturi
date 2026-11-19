import SwiftUI
import AturiCore

/// `/tools/post`, port of `src/components/tools/PostInspector.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct PostToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "post", shareQuery: query) {
            ToolPlaceholder(slug: "post", query: query)
        }
    }
}
