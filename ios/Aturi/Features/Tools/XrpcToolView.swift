import SwiftUI
import AturiCore

/// `/tools/xrpc`, port of `src/components/tools/XrpcConsole.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct XrpcToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "xrpc", shareQuery: query) {
            ToolPlaceholder(slug: "xrpc", query: query)
        }
    }
}
