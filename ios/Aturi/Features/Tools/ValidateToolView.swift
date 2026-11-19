import SwiftUI
import AturiCore

/// `/tools/validate`, port of `src/components/tools/RecordValidator.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct ValidateToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "validate", shareQuery: query) {
            ToolPlaceholder(slug: "validate", query: query)
        }
    }
}
