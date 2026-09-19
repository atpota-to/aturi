import SwiftUI
import AturiCore

/// Port of `GeneralTab.tsx`'s appearance card plus the picker-layout switch
/// from `WaypointsTab.tsx`. The colour scheme and the layout are synced
/// preferences; dark or light is per device, as it is per browser on the
/// web, and lives in the app group suite so the share extension follows.
struct GeneralSettingsView: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.aturiTheme) private var theme
    @AppStorage(Appearance.storageKey, store: Appearance.defaults) private var appearanceRaw = Appearance.system.rawValue

    private var appearance: Binding<Appearance> {
        Binding(
            get: { Appearance(rawValue: appearanceRaw) ?? .system },
            set: { appearanceRaw = $0.rawValue }
        )
    }

    var body: some View {
        List {
            SettingsSection(
                "Color scheme",
                footer: "The palette the whole app is painted in. Every scheme has a dark and a light variant; the switch below picks which one you see. Saved with the rest of your settings, so it follows you to other devices when you are signed in."
            ) {
                ForEach(AturiColorScheme.allCases, id: \.self) { scheme in
                    SettingsChoiceRow(
                        scheme.label,
                        detail: scheme.hint,
                        isSelected: preferences.prefs.colorScheme == scheme
                    ) {
                        guard preferences.prefs.colorScheme != scheme else { return }
                        preferences.update { $0.colorScheme = scheme }
                    } leading: {
                        SchemeSwatch(scheme: scheme)
                    }
                }
            }

            SettingsSection(
                "Dark or light",
                footer: "Which variant of the scheme to show. Saved on this device, so you can run light here and dark on another."
            ) {
                Picker("Appearance", selection: appearance) {
                    ForEach(Appearance.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.vertical, 4)
            }

            SettingsSection(
                "Picker layout",
                footer: "How the universal-link picker draws your waypoints. The same switch sits above the picker itself, so you can change it while looking at the result."
            ) {
                ForEach(WaypointLayout.allCases, id: \.self) { layout in
                    SettingsChoiceRow(
                        Self.layoutLabel(layout),
                        detail: Self.layoutHint(layout),
                        isSelected: preferences.prefs.waypointLayout == layout
                    ) {
                        guard preferences.prefs.waypointLayout != layout else { return }
                        preferences.update { $0.setWaypointLayout(layout) }
                    } leading: {
                        Image(systemName: Self.layoutSymbol(layout))
                            .font(.body)
                            .foregroundStyle(theme.textSecondary)
                            .frame(width: 24)
                            .accessibilityHidden(true)
                    }
                }
            }
        }
        .settingsList()
        .navigationTitle("General")
    }

    private static func layoutLabel(_ layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "Compact"
        case .grid: return "Grid"
        case .classic: return "Cards"
        }
    }

    private static func layoutHint(_ layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "One line per waypoint: mark, name and the host it opens."
        case .grid: return "Icon tiles, names only."
        case .classic: return "Full-width cards with descriptions and collapsible group headers."
        }
    }

    private static func layoutSymbol(_ layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "list.bullet"
        case .grid: return "square.grid.3x3"
        case .classic: return "rectangle.grid.1x2"
        }
    }
}

/// The web's two-tone chip: the dark variant on the left, the light one on
/// the right, each showing its background with a dot of its accent, so
/// both are visible whichever one is active.
private struct SchemeSwatch: View {
    let scheme: AturiColorScheme

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        HStack(spacing: 0) {
            half(scheme.darkPalette)
            half(scheme.lightPalette)
        }
        .frame(width: 48, height: 30)
        .clipShape(shape)
        .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        .accessibilityHidden(true)
    }

    private func half(_ palette: Palette) -> some View {
        ZStack {
            Color(hex: palette.bgPrimary)
            Circle()
                .fill(Color(hex: palette.accentMoss))
                .frame(width: 10, height: 10)
        }
    }
}
