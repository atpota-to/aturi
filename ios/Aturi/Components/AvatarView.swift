import SwiftUI

/// A round avatar loaded from a URL string, with a placeholder while it
/// loads and when there is none. Decorative: the name next to it carries
/// the accessibility label.
struct AvatarView: View {
    let url: String?
    var size: CGFloat = 40

    @Environment(\.aturiTheme) private var theme

    init(url: String?, size: CGFloat = 40) {
        self.url = url
        self.size = size
    }

    private var imageURL: URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL(string: url)
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
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(theme.borderSubtle, lineWidth: 1))
        .accessibilityHidden(true)
    }

    private var placeholder: some View {
        ZStack {
            theme.bgTertiary
            Image(systemName: "person.fill")
                .resizable()
                .scaledToFit()
                .padding(size * 0.25)
                .foregroundStyle(theme.textTertiary)
        }
    }
}
