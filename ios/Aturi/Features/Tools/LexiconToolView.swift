import SwiftUI
import AturiCore

/// `/tools/lexicon`, port of `src/components/tools/LexiconChecker.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct LexiconToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "lexicon", shareQuery: query) {
            ToolPlaceholder(slug: "lexicon", query: query)
        }
    }
}
