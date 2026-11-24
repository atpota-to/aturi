import SwiftUI
import AturiCore

/// "12m ago" style text that ticks once a minute, with the full timestamp
/// for VoiceOver. Under a minute old it reads "just now": the shared
/// formatter counts seconds, which a once-a-minute tick would leave
/// standing at "5s ago" for most of that minute.
struct RelativeDateText: View {
    let date: Date

    init(date: Date) {
        self.date = date
    }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let age = context.date.timeIntervalSince(date)
            if age >= 0, age < 60 {
                Text("just now")
            } else {
                Text(Formatting.relative(date, now: context.date))
            }
        }
        .accessibilityLabel(Text(date, format: .dateTime))
    }
}
