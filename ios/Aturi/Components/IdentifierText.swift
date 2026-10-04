import SwiftUI

/// A DID, handle, NSID or AT URI: monospaced, truncated in the middle so
/// both the method prefix and the distinctive tail stay visible.
struct IdentifierText: View {
    let text: String
    var lineLimit: Int = 1
    var font: Font = AturiFont.mono

    init(_ text: String, lineLimit: Int = 1, font: Font = AturiFont.mono) {
        self.text = text
        self.lineLimit = lineLimit
        self.font = font
    }

    var body: some View {
        Text(text)
            .font(font)
            .lineLimit(lineLimit)
            .truncationMode(.middle)
            .textSelection(.enabled)
    }
}
