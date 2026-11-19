import SwiftUI
import AturiCore

/// `/tools/decode`, port of `src/components/tools/IdentifierDecoder.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct DecodeToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "decode", shareQuery: query) {
            ToolPlaceholder(slug: "decode", query: query)
        }
    }
}
