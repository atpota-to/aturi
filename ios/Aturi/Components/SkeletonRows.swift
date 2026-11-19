import SwiftUI

/// Placeholder rows while a screen loads: two bars per row, pulsing
/// gently. Widths vary so the block reads as rows rather than a grid.
/// The web's `.fn-skel` (4b648a3): pill-shaped bars in `--skeleton-fill`,
/// which reads on paper where the tertiary background all but vanished,
/// pulsing 1 to 0.45 and back over 1.6s, and holding still under Reduce
/// Motion.
struct SkeletonRows: View {
    var count: Int = 3

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    init(count: Int = 3) {
        self.count = count
    }

    private static let widths: [CGFloat] = [180, 240, 140, 210, 160]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(0..<max(count, 1), id: \.self) { index in
                VStack(alignment: .leading, spacing: 7) {
                    SkeletonBar(width: Self.widths[index % Self.widths.count], height: 11)
                    SkeletonBar(width: Self.widths[(index + 2) % Self.widths.count] * 0.7, height: 10)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(pulsing ? 0.45 : 1)
        .animation(
            AturiMotion.animation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true), reduceMotion: reduceMotion),
            value: pulsing
        )
        .onAppear { pulsing = !reduceMotion }
        .onChange(of: reduceMotion) { _, reduce in
            pulsing = !reduce
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading")
    }
}

/// One placeholder bar: a pill for a line of text, or a rounded block, in
/// the skeleton fill. Static on its own; `SkeletonRows` pulses its block.
struct SkeletonBar: View {
    var width: CGFloat? = nil
    var height: CGFloat = 11
    var cornerRadius: CGFloat? = nil

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        Group {
            if let cornerRadius {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(theme.skeletonFill)
            } else {
                Capsule()
                    .fill(theme.skeletonFill)
            }
        }
        .frame(maxWidth: width)
        .frame(height: height)
    }
}
