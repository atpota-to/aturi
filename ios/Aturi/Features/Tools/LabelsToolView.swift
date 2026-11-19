import SwiftUI
import AturiCore

/// `/tools/labels`, port of `src/components/tools/LabelChecker.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct LabelsToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "labels", shareQuery: query) {
            ToolPlaceholder(slug: "labels", query: query)
        }
    }
}
