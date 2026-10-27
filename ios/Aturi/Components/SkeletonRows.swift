import SwiftUI

/// Placeholder rows while a screen loads: two bars per row, pulsing
/// gently. Widths vary so the block reads as rows rather than a grid.
struct SkeletonRows: View {
    var count: Int = 3

    @Environment(\.aturiTheme) private var theme
    @State private var pulsing = false

    init(count: Int = 3) {
        self.count = count
    }

    private static let widths: [CGFloat] = [180, 240, 140, 210, 160]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(0..<max(count, 1), id: \.self) { index in
                VStack(alignment: .leading, spacing: 6) {
                    bar(width: Self.widths[index % Self.widths.count], height: 14)
                    bar(width: Self.widths[(index + 2) % Self.widths.count] * 0.7, height: 10)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(pulsing ? 0.45 : 0.9)
        .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: pulsing)
        .onAppear { pulsing = true }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }

    private func bar(width: CGFloat, height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 4, style: .continuous)
            .fill(theme.bgTertiary)
            .frame(maxWidth: width)
            .frame(height: height)
    }
}
