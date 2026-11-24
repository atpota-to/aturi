import SwiftUI
import UIKit

/// A labelled value with a copy button. The web's copy rows flash a
/// check for a moment; here the icon and its accessibility label switch
/// to "Copied" for the same beat. Only the icon changes, in a fixed frame,
/// so the value beside it keeps its width and does not reflow on a tap.
struct CopyRow: View {
    let label: String
    let value: String
    var mono: Bool = true
    /// Lines the value may take before its middle is cut. One suits a long
    /// URI, where a second line would only split it mid-identifier.
    var lineLimit: Int = 2

    @Environment(\.aturiTheme) private var theme
    @State private var copied = false
    /// The pending "back to Copy" reset; a second tap restarts the beat
    /// rather than being cut short by the first tap's timer.
    @State private var resetTask: Task<Void, Never>?

    init(label: String, value: String, mono: Bool = true, lineLimit: Int = 2) {
        self.label = label
        self.value = value
        self.mono = mono
        self.lineLimit = lineLimit
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(label)
                    .aturiLabel()
                    .foregroundStyle(theme.textTertiary)
                Text(value)
                    .font(mono ? AturiFont.monoSmall : AturiFont.body)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(lineLimit)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 0)
            Button(action: copy) {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 20, height: 20)
                    .foregroundStyle(copied ? theme.textAccent : theme.textSecondary)
                    .padding(.vertical, 6)
                    .padding(.horizontal, 8)
            }
            .buttonStyle(.plain)
            .sensoryFeedback(.success, trigger: copied) { _, now in now }
            .accessibilityLabel(copied ? "Copied" : "Copy \(label)")
        }
        .padding(.vertical, 6)
    }

    private func copy() {
        UIPasteboard.general.string = value
        withAnimation(.easeInOut(duration: 0.15)) {
            copied = true
        }
        resetTask?.cancel()
        resetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.15)) {
                copied = false
            }
        }
    }
}
