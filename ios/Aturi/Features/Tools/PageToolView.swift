import SwiftUI
import AturiCore

/// `/tools/page`, port of `src/components/tools/PageChecker.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct PageToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "page", shareQuery: query) {
            ToolPlaceholder(slug: "page", query: query)
        }
    }
}
