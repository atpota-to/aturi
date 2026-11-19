import SwiftUI
import AturiCore

/// `/tools/activity`, port of `src/components/tools/ActivityCalendar.tsx`. Not ported yet:
/// the page offers the web tool with the same input.
struct ActivityToolView: View {
    let query: [String: String]

    var body: some View {
        ToolFrame(slug: "activity", shareQuery: query) {
            ToolPlaceholder(slug: "activity", query: query)
        }
    }
}
