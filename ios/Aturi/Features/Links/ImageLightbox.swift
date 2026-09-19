import SwiftUI
import AturiCore

/// Full-screen viewer for a post's images. A pager for multi-image embeds,
/// pinch and double-tap zoom, the alt text underneath, and a way out to
/// the full-size blob for saving in Safari. Present it with
/// `fullScreenCover`; it dismisses itself.
struct ImageLightbox: View {
    let images: [EmbedImage]

    @State private var index: Int
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    init(images: [EmbedImage], index: Int) {
        self.images = images
        _index = State(initialValue: min(max(index, 0), max(images.count - 1, 0)))
    }

    private var current: EmbedImage? {
        images.indices.contains(index) ? images[index] : nil
    }

    private var fullsizeURL: URL? {
        guard let current, let fullsize = current.fullsize, !fullsize.isEmpty else { return nil }
        return URL(string: fullsize)
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black
                .ignoresSafeArea()

            TabView(selection: $index) {
                ForEach(Array(images.enumerated()), id: \.offset) { offset, image in
                    LightboxPage(image: image, onDismiss: { dismiss() })
                        .tag(offset)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: images.count > 1 ? .always : .never))
            .indexViewStyle(.page(backgroundDisplayMode: .never))
            .ignoresSafeArea()

            topBar
        }
        .overlay(alignment: .bottom) {
            caption
        }
        .preferredColorScheme(.dark)
    }

    private var topBar: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.body.weight(.semibold))
                    .padding(10)
                    .background(Color.black.opacity(0.5), in: Circle())
            }
            .accessibilityLabel("Close")

            Spacer()

            if images.count > 1 {
                Text("\(index + 1) of \(images.count)")
                    .font(.footnote.weight(.medium))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(Color.black.opacity(0.5), in: Capsule())
            }

            Spacer()

            Button {
                if let fullsizeURL {
                    openURL(fullsizeURL)
                }
            } label: {
                Image(systemName: "arrow.up.right.square")
                    .font(.body.weight(.semibold))
                    .padding(10)
                    .background(Color.black.opacity(0.5), in: Circle())
            }
            .disabled(fullsizeURL == nil)
            .accessibilityLabel("Open full size image")
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.top, 8)
    }

    @ViewBuilder
    private var caption: some View {
        if let alt = current?.alt, !alt.isEmpty {
            Text(alt)
                .font(.footnote)
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(4)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(Color.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .padding(.horizontal, 16)
                .padding(.bottom, 40)
        }
    }
}

/// One page of the lightbox: the thumbnail as an instant stand-in while
/// the full-size blob loads, then the blob with zoom and pan on top.
private struct LightboxPage: View {
    let image: EmbedImage
    let onDismiss: () -> Void

    @State private var scale: CGFloat = 1
    @State private var steadyScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var steadyOffset: CGSize = .zero

    private static let minScale: CGFloat = 1
    private static let maxScale: CGFloat = 4
    /// Where a double tap lands: enough to read a screenshot of text.
    private static let doubleTapScale: CGFloat = 2.5
    /// A downward swipe this long, while not zoomed, dismisses.
    private static let dismissDistance: CGFloat = 120

    private var thumbURL: URL? {
        guard let thumb = image.thumb, !thumb.isEmpty else { return nil }
        return URL(string: thumb)
    }

    private var fullsizeURL: URL? {
        guard let fullsize = image.fullsize, !fullsize.isEmpty else { return nil }
        return URL(string: fullsize) ?? thumbURL
    }

    private var isZoomed: Bool {
        steadyScale > 1.01
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack {
                if let thumbURL {
                    AsyncImage(url: thumbURL) { phase in
                        if case .success(let thumb) = phase {
                            thumb
                                .resizable()
                                .scaledToFit()
                        }
                    }
                }
                AsyncImage(url: fullsizeURL) { phase in
                    switch phase {
                    case .success(let full):
                        full
                            .resizable()
                            .scaledToFit()
                    case .failure:
                        EmptyView()
                    default:
                        if thumbURL == nil {
                            ProgressView()
                                .tint(.white)
                        }
                    }
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .scaleEffect(scale)
            .offset(offset)
            .contentShape(Rectangle())
            .gesture(magnify)
            .gesture(pan, including: isZoomed ? .all : .subviews)
            .simultaneousGesture(dismissSwipe)
            .onTapGesture(count: 2) {
                toggleZoom()
            }
            .accessibilityLabel(accessibilityLabel)
            .accessibilityAddTraits(.isImage)
        }
    }

    private var accessibilityLabel: String {
        if let alt = image.alt, !alt.isEmpty {
            return alt
        }
        return "Image"
    }

    private var magnify: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                scale = min(max(steadyScale * value.magnification, Self.minScale * 0.8), Self.maxScale)
            }
            .onEnded { _ in
                settle()
            }
    }

    private var pan: some Gesture {
        DragGesture()
            .onChanged { value in
                offset = CGSize(
                    width: steadyOffset.width + value.translation.width,
                    height: steadyOffset.height + value.translation.height
                )
            }
            .onEnded { _ in
                steadyOffset = offset
            }
    }

    /* Vertical drags do not compete with the pager's horizontal paging, so
       a plain downward swipe on an unzoomed image reads as "put it away". */
    private var dismissSwipe: some Gesture {
        DragGesture(minimumDistance: 30)
            .onEnded { value in
                guard !isZoomed else { return }
                let translation = value.translation
                if translation.height > Self.dismissDistance, abs(translation.width) < translation.height {
                    onDismiss()
                }
            }
    }

    private func toggleZoom() {
        withAnimation(.easeInOut(duration: 0.2)) {
            if isZoomed {
                scale = 1
                steadyScale = 1
                offset = .zero
                steadyOffset = .zero
            } else {
                scale = Self.doubleTapScale
                steadyScale = Self.doubleTapScale
            }
        }
    }

    private func settle() {
        withAnimation(.easeOut(duration: 0.2)) {
            if scale <= Self.minScale {
                scale = Self.minScale
                offset = .zero
                steadyOffset = .zero
            } else if scale > Self.maxScale {
                scale = Self.maxScale
            }
            steadyScale = scale
        }
    }
}
