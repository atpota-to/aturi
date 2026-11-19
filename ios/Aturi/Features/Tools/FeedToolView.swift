import SwiftUI
import AturiCore

/// `/tools/feed`, port of `src/components/tools/FeedInspector.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct FeedToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "feed", shareQuery: query) {
            ToolPlaceholder(slug: "feed", query: query)
        }
    }
}
