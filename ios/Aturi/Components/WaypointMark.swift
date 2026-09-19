import SwiftUI
import UIKit

/// A waypoint's brand mark from the `Waypoints` asset folder, tinted like
/// text. Custom waypoints (`custom:` ids) and any built-in whose mark is
/// missing fall back to a globe, checked through `UIImage(named:)` so a
/// missing asset never renders as an empty box.
struct WaypointMark: View {
    static let assetNamespace = "Waypoints"

    let id: String
    var size: CGFloat = 20

    init(id: String, size: CGFloat = 20) {
        self.id = id
        self.size = size
    }

    private var assetName: String {
        "\(Self.assetNamespace)/\(id)"
    }

    private var hasAsset: Bool {
        UIImage(named: assetName) != nil
    }

    var body: some View {
        Group {
            if hasAsset {
                Image(assetName)
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: "globe")
                    .resizable()
                    .scaledToFit()
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}
