import SwiftUI
import AturiCore

/// `/tools/memberships`, port of `src/components/tools/Memberships.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct MembershipsToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "memberships", shareQuery: query) {
            ToolPlaceholder(slug: "memberships", query: query)
        }
    }
}
