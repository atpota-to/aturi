import SwiftUI
import AturiCore

/// Port of `CustomWaypointForm.tsx`, presented as a sheet: name, display
/// domain and description, the record types the waypoint handles, one URL
/// template per type with a live example, and the compat families that
/// make it a redirect destination. Templates carry `{handle}`, `{did}`,
/// `{actor}` (DID with handle fallback), `{collection}` and `{rkey}`.
struct CustomWaypointForm: View {
    let initial: CustomWaypoint?
    let onSave: (CustomWaypoint) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.aturiTheme) private var theme

    @State private var name: String
    @State private var domain: String
    @State private var descriptionText: String
    @State private var types: Set<WaypointType>
    @State private var templates: [WaypointType: String]
    @State private var families: Set<RedirectCompatFamily>
    @State private var errorMessage: String?

    init(initial: CustomWaypoint? = nil, onSave: @escaping (CustomWaypoint) -> Void) {
        self.initial = initial
        self.onSave = onSave
        _name = State(initialValue: initial?.name ?? "")
        _domain = State(initialValue: initial?.domain ?? "")
        _descriptionText = State(initialValue: initial?.description ?? "")
        _types = State(initialValue: Set(initial?.supportedTypes ?? [.profile, .post]))
        _templates = State(initialValue: initial?.templates ?? [:])
        _families = State(initialValue: Set(initial?.redirectCompat ?? []))
    }

    private struct TypeOption {
        let type: WaypointType
        let label: String
        let hint: String
        let placeholder: String
    }

    /// The web's `TYPE_OPTIONS` and `EXAMPLE_TEMPLATES`, in picker order.
    private static let typeOptions: [TypeOption] = [
        TypeOption(
            type: .profile,
            label: "Profile",
            hint: "Opens the user's profile page",
            placeholder: "https://example.com/{handle}"
        ),
        TypeOption(
            type: .post,
            label: "Post",
            hint: "Opens an app.bsky.feed.post record",
            placeholder: "https://example.com/{handle}/post/{rkey}"
        ),
        TypeOption(
            type: .list,
            label: "List",
            hint: "Opens an app.bsky.graph.list record",
            placeholder: "https://example.com/{handle}/lists/{rkey}"
        ),
        TypeOption(
            type: .record,
            label: "Any record",
            hint: "Opens any AT URI record (fallback)",
            placeholder: "https://example.com/{actor}/{collection}/{rkey}"
        ),
    ]

    private var isEditing: Bool {
        initial != nil
    }

    private var trimmedName: String {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var enabledOptions: [TypeOption] {
        Self.typeOptions.filter { types.contains($0.type) }
    }

    /// Mirrors the web's `canSubmit`: a name, at least one type, and at
    /// least one template filled for an enabled type.
    private var canSubmit: Bool {
        guard !trimmedName.isEmpty, !types.isEmpty else { return false }
        return enabledOptions.contains { option in
            !(templates[option.type] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    var body: some View {
        NavigationStack {
            List {
                SettingsSection("Name") {
                    FormField("Name", hint: nil) {
                        TextField("My Atmosphere App", text: $name)
                            .textInputAutocapitalization(.words)
                            .accessibilityLabel("Name")
                    }
                    FormField("Domain", hint: "Display only") {
                        TextField("example.com", text: $domain)
                            .font(AturiFont.mono)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .accessibilityLabel("Domain")
                    }
                    FormField("Description", hint: "Shown under the name") {
                        TextField("View on example.com", text: $descriptionText)
                            .accessibilityLabel("Description")
                    }
                }

                SettingsSection("Handles", footer: "Which kinds of links this waypoint understands.") {
                    SettingsWrapLayout(spacing: 8) {
                        ForEach(Self.typeOptions, id: \.type) { option in
                            SettingsChipToggle(option.label, isOn: types.contains(option.type)) {
                                toggle(option.type)
                            }
                            .accessibilityHint(option.hint)
                        }
                    }
                    .padding(.vertical, 4)
                }

                ForEach(enabledOptions, id: \.type) { option in
                    templateSection(option)
                }

                SettingsSection(
                    "Auto-redirect families",
                    footer: "Optional, and empty is the usual choice for a personal bookmark. Ticking a family lets this waypoint be picked as a redirect destination under Redirects."
                ) {
                    SettingsWrapLayout(spacing: 8) {
                        ForEach(WaypointCatalog.compatFamilyOrder, id: \.self) { family in
                            SettingsChipToggle(Self.familyName(family), isOn: families.contains(family)) {
                                toggle(family)
                            }
                            .accessibilityHint(WaypointCatalog.compatFamilies[family]?.description ?? "")
                        }
                    }
                    .padding(.vertical, 4)
                }

                if let errorMessage {
                    SettingsSection {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(theme.danger)
                    }
                }
            }
            .settingsList()
            .navigationTitle(isEditing ? "Edit waypoint" : "New custom waypoint")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isEditing ? "Save" : "Add") {
                        save()
                    }
                    .disabled(!canSubmit)
                }
            }
        }
    }

    private func templateSection(_ option: TypeOption) -> some View {
        SettingsSection(
            "URL template: \(option.label)",
            footer: "Placeholders: {handle}, {did}, {actor}, {collection}, {rkey}"
        ) {
            TextField(option.placeholder, text: template(for: option.type))
                .font(AturiFont.monoSmall)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .accessibilityLabel("URL template for \(option.label)")
            if let example = example(for: option.type) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Example")
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                    Text(example.text)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(example.ok ? theme.textSecondary : theme.danger)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 2)
            }
        }
    }

    // MARK: State

    private func template(for type: WaypointType) -> Binding<String> {
        Binding(
            get: { templates[type] ?? "" },
            set: { templates[type] = $0 }
        )
    }

    private func toggle(_ type: WaypointType) {
        if types.contains(type) {
            types.remove(type)
        } else {
            types.insert(type)
        }
    }

    private func toggle(_ family: RedirectCompatFamily) {
        if families.contains(family) {
            families.remove(family)
        } else {
            families.insert(family)
        }
    }

    private static func familyName(_ family: RedirectCompatFamily) -> String {
        WaypointCatalog.compatFamilies[family]?.name ?? family.rawValue
    }

    /// The sample inputs a template is expanded against for the preview.
    /// A profile has no collection or rkey, which is exactly what makes a
    /// `{rkey}` in a profile template fail here rather than in the picker.
    private static func exampleContext(for type: WaypointType) -> CustomWaypointContext {
        let handle = "alice.example.com"
        let did = "did:plc:abcdefghijklmnopqrstuvwx"
        switch type {
        case .post:
            return CustomWaypointContext(handle: handle, did: did, collection: "app.bsky.feed.post", rkey: "3k2aexample")
        case .list:
            return CustomWaypointContext(handle: handle, did: did, collection: "app.bsky.graph.list", rkey: "3k2aexample")
        case .record:
            return CustomWaypointContext(handle: handle, did: did, collection: "com.example.record", rkey: "3k2aexample")
        case .profile, .unknown:
            return CustomWaypointContext(handle: handle, did: did)
        }
    }

    private func example(for type: WaypointType) -> (text: String, ok: Bool)? {
        let template = (templates[type] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !template.isEmpty else { return nil }
        if let url = expandTemplate(template, context: Self.exampleContext(for: type)) {
            return (url, true)
        }
        return ("A placeholder in this template has no value for this type. Profiles carry no {collection} or {rkey}.", false)
    }

    // MARK: Save

    private func save() {
        errorMessage = nil
        guard !trimmedName.isEmpty else {
            errorMessage = "Give the waypoint a name."
            return
        }
        let enabledTypes = enabledOptions.map(\.type)
        guard !enabledTypes.isEmpty else {
            errorMessage = "Pick at least one type of content this waypoint handles."
            return
        }
        var filled: [WaypointType: String] = [:]
        for type in enabledTypes {
            let template = (templates[type] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !template.isEmpty {
                filled[type] = template
            }
        }
        guard !filled.isEmpty else {
            errorMessage = "Fill in at least one URL template."
            return
        }

        let trimmedDomain = domain.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDescription = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        let familyList = WaypointCatalog.compatFamilyOrder.filter { families.contains($0) }

        let waypoint = CustomWaypoint(
            id: initial?.id ?? CustomWaypoint.newId(),
            name: trimmedName,
            domain: trimmedDomain.isEmpty ? nil : trimmedDomain,
            description: trimmedDescription.isEmpty ? nil : trimmedDescription,
            supportedTypes: enabledTypes,
            templates: filled,
            redirectCompat: familyList.isEmpty ? nil : familyList
        )
        onSave(waypoint)
        dismiss()
    }
}

/// A labelled field: small-caps label above the control, hint beneath.
private struct FormField<Content: View>: View {
    let label: String
    let hint: String?
    let content: Content

    @Environment(\.aturiTheme) private var theme

    init(_ label: String, hint: String?, @ViewBuilder content: () -> Content) {
        self.label = label
        self.hint = hint
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            content
            if let hint, !hint.isEmpty {
                Text(hint)
                    .font(.caption)
                    .foregroundStyle(theme.textTertiary)
            }
        }
        .padding(.vertical, 2)
    }
}
