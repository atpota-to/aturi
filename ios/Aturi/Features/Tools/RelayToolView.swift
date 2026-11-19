import SwiftUI
import AturiCore

/// `/tools/relay`, port of `src/components/tools/RelayCheck.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct RelayToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "relay", shareQuery: query) {
            ToolPlaceholder(slug: "relay", query: query)
        }
    }
}
