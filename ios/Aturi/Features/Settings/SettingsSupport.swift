import SwiftUI
import AturiCore

/// Themed grouped list: the system's inset grouped style on the app's own
/// window background. Every settings screen is a `List`, so the look is
/// set once here.
struct SettingsListStyle: ViewModifier {
    @Environment(\.aturiTheme) private var theme

    func body(content: Content) -> some View {
        content
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(theme.bgPrimary)
            .navigationBarTitleDisplayMode(.inline)
    }
}

extension View {
    /// Apply to the `List` at the root of a settings screen.
    func settingsList() -> some View {
        modifier(SettingsListStyle())
    }
}

/// A list section with the web's card copy: an optional uppercase title and
/// a footnote beneath, rows painted on the secondary background.
struct SettingsSection<Content: View>: View {
    let title: String?
    let footer: String?
    let content: Content

    @Environment(\.aturiTheme) private var theme

    init(_ title: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.footer = footer
        self.content = content()
    }

    var body: some View {
        Section {
            content
                .listRowBackground(theme.bgSecondary)
        } header: {
            if let title, !title.isEmpty {
                Text(title)
                    .foregroundStyle(theme.textTertiary)
            }
        } footer: {
            if let footer, !footer.isEmpty {
                Text(footer)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
            }
        }
    }
}

/// Title over a line of detail, the label of a row that navigates.
struct SettingsRowLabel: View {
    let title: String
    var detail: String? = nil
    var systemImage: String? = nil

    @Environment(\.aturiTheme) private var theme

    init(_ title: String, detail: String? = nil, systemImage: String? = nil) {
        self.title = title
        self.detail = detail
        self.systemImage = systemImage
    }

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.body)
                    .foregroundStyle(theme.textAccent)
                    .frame(width: 24)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(AturiFont.body)
                    .foregroundStyle(theme.textPrimary)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(2)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// The web's `Toggle` row: label, optional sub-line, switch on the right.
struct SettingsToggleRow: View {
    let title: String
    var detail: String? = nil
    @Binding var isOn: Bool

    @Environment(\.aturiTheme) private var theme

    init(_ title: String, detail: String? = nil, isOn: Binding<Bool>) {
        self.title = title
        self.detail = detail
        self._isOn = isOn
    }

    var body: some View {
        Toggle(isOn: $isOn) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .foregroundStyle(theme.textPrimary)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(.vertical, 2)
    }
}

/// One option of a single-choice list (colour scheme, picker layout): an
/// optional leading view, the title and hint, and a check when chosen.
struct SettingsChoiceRow<Leading: View>: View {
    let title: String
    let detail: String?
    let isSelected: Bool
    let action: () -> Void
    let leading: Leading

    @Environment(\.aturiTheme) private var theme

    init(
        _ title: String,
        detail: String? = nil,
        isSelected: Bool,
        action: @escaping () -> Void,
        @ViewBuilder leading: () -> Leading
    ) {
        self.title = title
        self.detail = detail
        self.isSelected = isSelected
        self.action = action
        self.leading = leading()
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 12) {
                leading
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(AturiFont.body)
                        .foregroundStyle(theme.textPrimary)
                    if let detail, !detail.isEmpty {
                        Text(detail)
                            .font(.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "checkmark")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(theme.textAccent)
                    .opacity(isSelected ? 1 : 0)
                    .accessibilityHidden(true)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? AccessibilityTraits.isSelected : AccessibilityTraits())
    }
}

extension SettingsChoiceRow where Leading == EmptyView {
    init(_ title: String, detail: String? = nil, isSelected: Bool, action: @escaping () -> Void) {
        self.init(title, detail: detail, isSelected: isSelected, action: action) {
            EmptyView()
        }
    }
}

/// A selectable capsule for multi-choice sets (record types, compat
/// families): filled with the accent when on.
struct SettingsChipToggle: View {
    let title: String
    let isOn: Bool
    let action: () -> Void

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    init(_ title: String, isOn: Bool, action: @escaping () -> Void) {
        self.title = title
        self.isOn = isOn
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.footnote.weight(.medium))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .foregroundStyle(isOn ? theme.textOnAccent : theme.textSecondary)
                .background(isOn ? theme.accent : theme.bgTertiary, in: Capsule())
                .overlay(Capsule().strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? AccessibilityTraits.isSelected : AccessibilityTraits())
    }
}

/// Lays chips out left to right, wrapping to a new line when the row is
/// full, like the web's flex-wrap rows. Written against the `Layout`
/// protocol so it needs no measuring pass of its own.
struct SettingsWrapLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let frames = arrange(subviews: subviews, width: width)
        let height = frames.map { $0.maxY }.max() ?? 0
        let usedWidth = frames.map { $0.maxX }.max() ?? 0
        return CGSize(width: proposal.width ?? usedWidth, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrange(subviews: subviews, width: bounds.width)
        for (subview, frame) in zip(subviews, frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    /// Frames relative to the layout's origin. A chip wider than the row
    /// gets a row of its own rather than being clipped.
    private func arrange(subviews: Subviews, width: CGFloat) -> [CGRect] {
        var frames: [CGRect] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
        return frames
    }
}

extension PreferencesStore {
    /// A binding into one preference. Writes go through `update`, so the
    /// `updatedAt` stamp, the storage write and the debounced PDS sync
    /// apply to every edit a control makes; an unchanged value is dropped
    /// so a control settling on its own value does not stamp the record.
    func settingsBinding<Value: Equatable>(
        _ read: @escaping (Preferences) -> Value,
        _ write: @escaping (inout Preferences, Value) -> Void
    ) -> Binding<Value> {
        Binding(
            get: { read(self.prefs) },
            set: { value in
                guard value != read(self.prefs) else { return }
                self.update { prefs in
                    write(&prefs, value)
                }
            }
        )
    }
}
