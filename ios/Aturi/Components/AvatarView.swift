import SwiftUI

/// An avatar loaded from a URL string, with a placeholder while it loads
/// and when there is none. Round everywhere but the signed-in account's
/// chip, which the web squares off (1d9c62b). Decorative: the name next to
/// it carries the accessibility label.
struct AvatarView: View {
    let url: String?
    var size: CGFloat = 40
    /// A rounded square with this corner radius instead of a circle.
    var squareCornerRadius: CGFloat? = nil

    @Environment(\.aturiTheme) private var theme

    init(url: String?, size: CGFloat = 40, squareCornerRadius: CGFloat? = nil) {
        self.url = url
        self.size = size
        self.squareCornerRadius = squareCornerRadius
    }

    private var imageURL: URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL(string: url)
    }

    /// A circle is the rounded rectangle at half the side with circular
    /// corners; the chip's square keeps continuous ones.
    private var shape: RoundedRectangle {
        RoundedRectangle(
            cornerRadius: squareCornerRadius ?? size / 2,
            style: squareCornerRadius == nil ? .circular : .continuous
        )
    }

    var body: some View {
        AsyncImage(url: imageURL) { phase in
            switch phase {
            case .success(let image):
                image
                    .resizable()
                    .scaledToFill()
            default:
                placeholder
            }
        }
        .frame(width: size, height: size)
        .clipShape(shape)
        .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: 1))
        .accessibilityHidden(true)
    }

    /// The square chip's placeholder is the web's soft accent tile; the
    /// round one stays the quiet tertiary disc.
    private var placeholder: some View {
        ZStack {
            squareCornerRadius == nil ? theme.bgTertiary : theme.accentSoft
            Image(systemName: "person.fill")
                .resizable()
                .scaledToFit()
                .padding(size * 0.25)
                .foregroundStyle(squareCornerRadius == nil ? theme.textTertiary : theme.accentSoftFg)
        }
    }
}
