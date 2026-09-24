import SwiftUI
import AturiCore

/// "12m ago" style text that ticks once a minute, with the full timestamp
/// for VoiceOver.
struct RelativeDateText: View {
    let date: Date

    init(date: Date) {
        self.date = date
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Text(Formatting.relative(date, now: context.date))
        }
        .accessibilityLabel(Text(date, format: .dateTime))
    }
}
