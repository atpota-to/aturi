import SwiftUI
import UIKit

/// A labelled value with a copy button. The web's copy rows flash a
/// check for a moment; here the icon and its accessibility label switch
/// to "Copied" for the same beat.
struct CopyRow: View {
    let label: String
    let value: String
    var mono: Bool = true

    @Environment(\.aturiTheme) private var theme
    @State private var copied = false

    init(label: String, value: String, mono: Bool = true) {
        self.label = label
        self.value = value
        self.mono = mono
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
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
            }
            Spacer(minLength: 0)
            Button(action: copy) {
                HStack(spacing: 4) {
                    if copied {
                        Text("Copied")
                            .font(.caption)
                    }
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                }
                .foregroundStyle(copied ? theme.textAccent : theme.textSecondary)
                .padding(.vertical, 6)
                .padding(.horizontal, 8)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(copied ? "Copied" : "Copy \(label)")
        }
        .padding(.vertical, 6)
    }

    private func copy() {
        UIPasteboard.general.string = value
        withAnimation(.easeInOut(duration: 0.15)) {
            copied = true
        }
        Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            withAnimation(.easeInOut(duration: 0.15)) {
                copied = false
            }
        }
    }
}
