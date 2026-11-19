import SwiftUI
import AturiCore

/// `/tools/car`, port of `src/components/tools/CarInspector.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct CarToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "car", shareQuery: query) {
            ToolPlaceholder(slug: "car", query: query)
        }
    }
}
