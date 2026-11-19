import SwiftUI
import AturiCore

/// `/tools/shadowban`, port of `src/components/tools/ShadowbanChecker.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct ShadowbanToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "shadowban", shareQuery: query) {
            ToolPlaceholder(slug: "shadowban", query: query)
        }
    }
}
