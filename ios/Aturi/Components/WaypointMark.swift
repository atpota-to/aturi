import SwiftUI
import UIKit

/// A waypoint's brand mark from the `Waypoints` asset folder. Most marks
/// are single-colour templates and tint like text; a few (Lea, Leaflet,
/// pckt) are drawn in full with light and dark variants, so the asset
/// catalog's own render mode decides rather than forcing a template, which
/// would flood those into solid shapes. Custom waypoints (`custom:` ids) and any built-in whose mark is
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
