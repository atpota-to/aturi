import SwiftUI
import AturiCore

/// The owner's editor for one of their records, port of `RecordEditor.tsx`
/// for an existing record: a form built from the collection's lexicon
/// template when there is one (text, long text, timestamps with a "Now"
/// button, tags, numbers, booleans and raw JSON fields), the raw record
/// JSON behind a Form / JSON switch, Save through `putRecord`, and Delete
/// behind a confirmation. A collection with no template edits as JSON only.
///
/// Saving applies the template's `autoOnEdit` fields (`updatedAt`) and
/// drops optional fields left blank, as the web's `buildRecordPayload`
/// does, so a form save writes the same record the site would.
struct RecordEditorSheet: View {
    private enum Mode: String, CaseIterable, Identifiable {
        case form
        case json

        var id: String { rawValue }

        var label: String {
            switch self {
            case .form: return "Form"
            case .json: return "JSON"
            }
        }
    }

    let record: AtRecord
    var onSaved: ((JSONValue) -> Void)? = nil
    var onDeleted: (() -> Void)? = nil

    private let lexicon: Lexicon?
    /// The collection and rkey the record lives at, read off its URI.
    private let target: (collection: String, rkey: String)?

    @State private var mode: Mode
    /// The form's working copy of the record object.
    @State private var fields: [String: JSONValue]
    @State private var rawText: String
    @State private var isSaving = false
    @State private var isDeleting = false
    @State private var confirmingDelete = false
    @State private var errorMessage: String?

    @Environment(\.sessionStore) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.aturiTheme) private var theme

    init(record: AtRecord, onSaved: ((JSONValue) -> Void)? = nil, onDeleted: (() -> Void)? = nil) {
        self.record = record
        self.onSaved = onSaved
        self.onDeleted = onDeleted
        let target = Self.target(of: record)
        self.target = target
        let lexicon = LexiconTemplates.lexiconFor(target?.collection)
        self.lexicon = lexicon
        /* No registered lexicon means there is no form to switch to: the
           editor opens in JSON mode and the switch stays hidden. */
        _mode = State(initialValue: lexicon == nil ? .json : .form)
        _fields = State(initialValue: record.value.objectValue ?? [:])
        _rawText = State(initialValue: record.value.prettyPrinted())
    }

    private static func target(of record: AtRecord) -> (collection: String, rkey: String)? {
        guard let uri = AtUri(parsing: record.uri),
              let collection = uri.collection, !collection.isEmpty,
              let rkey = uri.rkey, !rkey.isEmpty
        else { return nil }
        return (collection, rkey)
    }

    private var parsedRaw: JSONValue? {
        try? JSONValue.parse(Data(rawText.utf8))
    }

    private var busy: Bool {
        isSaving || isDeleting
    }

    private var canSave: Bool {
        guard session.writeAccess, target != nil, !busy else { return false }
        return mode == .form || parsedRaw?.objectValue != nil
    }

    /// The web's `canDelete`: hidden for a grant that cannot delete rather
    /// than offering a button whose call would be refused.
    private var canDelete: Bool {
        session.deleteAccess && target != nil
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if mode == .form, let lexicon {
                        FormEditor(lexicon: lexicon, fields: $fields)
                    } else {
                        rawEditor
                    }
                    if !session.writeAccess {
                        Text("Sign in with a scope that allows writes to save changes.")
                            .font(.caption)
                            .foregroundStyle(theme.textTertiary)
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundStyle(theme.danger)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityLabel("Error: \(errorMessage)")
                    }
                    if canDelete {
                        deleteButton
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(theme.bgPrimary.ignoresSafeArea())
            .navigationTitle(RecordModel.editLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(busy)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving\u{2026}" : "Save") {
                        save()
                    }
                    .disabled(!canSave)
                }
            }
            .confirmationDialog(
                deleteQuestion,
                isPresented: $confirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Confirm delete", role: .destructive) {
                    delete()
                }
            } message: {
                Text("This cannot be undone.")
            }
            .interactiveDismissDisabled(busy)
        }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            if lexicon != nil {
                Picker("Editor mode", selection: modeSelection) {
                    ForEach(Mode.allCases) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 200)
                .disabled(busy)
            } else {
                Text("Edit JSON")
                    .aturiLabel()
                    .foregroundStyle(theme.textTertiary)
            }
            Spacer(minLength: 0)
            if let lexicon {
                Text(lexicon.label)
                    .font(.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
            }
        }
    }

    /// The segmented control drives the same switch as the web's toggle:
    /// leaving the form serialises it, leaving JSON parses it, and JSON
    /// that will not parse keeps the editor where it is.
    private var modeSelection: Binding<Mode> {
        Binding(
            get: { mode },
            set: { next in
                guard next != mode else { return }
                switch next {
                case .json:
                    rawText = formPayload().prettyPrinted()
                    errorMessage = nil
                    mode = .json
                case .form:
                    guard let object = parsedRaw?.objectValue else {
                        errorMessage = "The JSON does not parse as a record object, so the form cannot show it."
                        return
                    }
                    fields = object
                    errorMessage = nil
                    mode = .form
                }
            }
        )
    }

    // MARK: Raw JSON

    private var rawEditor: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Raw record JSON")
                .aturiLabel()
                .foregroundStyle(theme.textSecondary)
            TextEditor(text: $rawText)
                .font(AturiFont.monoSmall)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 280)
                .padding(8)
                .cardBackground()
                .accessibilityLabel("Record JSON")
            if parsedRaw == nil {
                Text("JSON error: the text does not parse.")
                    .font(.caption)
                    .foregroundStyle(theme.danger)
            } else if parsedRaw?.objectValue == nil {
                Text("JSON error: a record must be an object.")
                    .font(.caption)
                    .foregroundStyle(theme.danger)
            }
        }
    }

    // MARK: Delete

    private var deleteQuestion: String {
        guard let target else { return "Delete this record?" }
        return "Delete \(target.collection)/\(target.rkey)?"
    }

    private var deleteButton: some View {
        Button(role: .destructive) {
            confirmingDelete = true
        } label: {
            HStack(spacing: 8) {
                if isDeleting {
                    ProgressView()
                        .controlSize(.small)
                }
                Label(isDeleting ? "Deleting\u{2026}" : "Delete record", systemImage: "trash")
                    .foregroundStyle(theme.danger)
            }
        }
        .buttonStyle(.aturiSecondary)
        .disabled(busy)
    }

    // MARK: Payload

    /// `buildRecordPayload` for the form: the `$type` the template names,
    /// the auto-on-edit timestamps refreshed, and optional blanks dropped
    /// so the record does not fill up with empty strings.
    private func formPayload(now: Date = Date()) -> JSONValue {
        var next = fields
        guard let lexicon else { return .object(next) }
        if let type = lexicon.typeFieldValue {
            next["$type"] = .string(type)
        }
        for field in lexicon.fields where field.autoOnEdit {
            next[field.key] = .string(Formatting.isoTimestamp(now))
        }
        for field in lexicon.fields where !field.required {
            guard let value = next[field.key] else { continue }
            let blank: Bool
            switch value {
            case .null:
                blank = true
            case .string(let text):
                blank = text.isEmpty
            case .array(let items):
                blank = field.type == .tags && items.isEmpty
            default:
                blank = false
            }
            if blank {
                next.removeValue(forKey: field.key)
            }
        }
        return .object(next)
    }

    /// The record to write, for whichever mode is showing.
    private func payload() -> JSONValue? {
        switch mode {
        case .form:
            return formPayload()
        case .json:
            guard var object = parsedRaw?.objectValue else { return nil }
            if let type = lexicon?.typeFieldValue, object["$type"] == nil {
                object["$type"] = .string(type)
            }
            return .object(object)
        }
    }

    // MARK: Actions

    private func save() {
        guard let target, let value = payload() else { return }
        isSaving = true
        errorMessage = nil
        Task { @MainActor in
            do {
                try await session.putRecord(collection: target.collection, rkey: target.rkey, value: value)
                isSaving = false
                onSaved?(value)
                dismiss()
            } catch {
                errorMessage = ExploreErrorText.describe(error)
                isSaving = false
            }
        }
    }

    private func delete() {
        guard let target else { return }
        isDeleting = true
        errorMessage = nil
        Task { @MainActor in
            do {
                try await session.deleteRecord(collection: target.collection, rkey: target.rkey)
                isDeleting = false
                onDeleted?()
                dismiss()
            } catch {
                errorMessage = ExploreErrorText.describe(error)
                isDeleting = false
            }
        }
    }
}

// MARK: - Form

/// One control per template field, in the template's order.
private struct FormEditor: View {
    let lexicon: Lexicon
    @Binding var fields: [String: JSONValue]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(lexicon.fields, id: \.key) { field in
                FieldView(field: field, value: binding(for: field.key))
            }
        }
    }

    /// A field absent from the record reads as nil; writing nil removes it,
    /// so a cleared optional does not linger as `null` in the payload.
    private func binding(for key: String) -> Binding<JSONValue?> {
        Binding(
            get: { fields[key] },
            set: { next in
                if let next {
                    fields[key] = next
                } else {
                    fields.removeValue(forKey: key)
                }
            }
        )
    }
}

/// The web's `Field` + `FieldShell`: the small-caps label with its
/// required mark, the control, and the hint and character count beneath.
private struct FieldView: View {
    let field: LexiconField
    @Binding var value: JSONValue?

    @Environment(\.aturiTheme) private var theme

    private var charCount: String? {
        guard let max = field.maxLength, case .string(let text)? = value else { return nil }
        return "\(text.count) / \(max)"
    }

    private var footnote: String? {
        switch (field.hint, charCount) {
        case (let hint?, let count?): return "\(hint) \u{00B7} \(count)"
        case (let hint?, nil): return hint
        case (nil, let count?): return count
        case (nil, nil): return nil
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if field.type != .boolean {
                label
            }
            control
            if let footnote {
                Text(footnote)
                    .font(.caption)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var label: some View {
        HStack(spacing: 2) {
            Text(field.label)
                .aturiLabel()
                .foregroundStyle(theme.textSecondary)
            if field.required {
                Text("*")
                    .font(AturiFont.label)
                    .foregroundStyle(theme.danger)
                    .accessibilityLabel("required")
            }
        }
    }

    @ViewBuilder
    private var control: some View {
        switch field.type {
        case .text:
            TextField(field.placeholder ?? "", text: stringBinding)
                .font(AturiFont.body)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .cardBackground(cornerRadius: 8)
                .accessibilityLabel(field.label)
        case .textarea, .markdown:
            TextEditor(text: stringBinding)
                .font(field.type == .markdown ? AturiFont.monoSmall : AturiFont.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: field.type == .markdown ? 240 : 100)
                .padding(6)
                .cardBackground(cornerRadius: 8)
                .accessibilityLabel(field.label)
        case .datetime:
            DatetimeField(label: field.label, value: stringBinding)
        case .tags:
            TagsField(label: field.label, value: $value)
        case .number:
            NumberField(label: field.label, value: $value)
        case .boolean:
            Toggle(field.label, isOn: boolBinding)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .cardBackground(cornerRadius: 8)
        case .json:
            JSONField(label: field.label, value: $value)
        }
    }

    private var stringBinding: Binding<String> {
        Binding(
            get: { value?.stringValue ?? "" },
            set: { value = .string($0) }
        )
    }

    private var boolBinding: Binding<Bool> {
        Binding(
            get: { value?.boolValue ?? false },
            set: { value = .bool($0) }
        )
    }
}

/// A timestamp field: the wheel for the date, "Now" for the current time,
/// and the ISO string that will be written. The record keeps the web's
/// `toISOString()` spelling, so the picker's date round-trips through
/// `Formatting.isoTimestamp`.
private struct DatetimeField: View {
    let label: String
    @Binding var value: String

    @Environment(\.aturiTheme) private var theme

    private var date: Binding<Date> {
        Binding(
            get: { Formatting.isoDate(value) ?? Date() },
            set: { value = Formatting.isoTimestamp($0) }
        )
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                DatePicker(label, selection: date, displayedComponents: [.date, .hourAndMinute])
                    .labelsHidden()
                Spacer(minLength: 0)
                Button("Now") {
                    value = Formatting.isoTimestamp(Date())
                }
                .font(.footnote.weight(.medium))
                .buttonStyle(.plain)
                .foregroundStyle(theme.textAccent)
                .accessibilityLabel("Set \(label) to now")
            }
            if !value.isEmpty {
                Text(value)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
            }
        }
        .padding(10)
        .cardBackground(cornerRadius: 8)
    }
}

/// Comma-separated tags. The text is kept locally so a trailing comma
/// or space is not normalised away under the person's thumb; the array
/// is written on every change.
private struct TagsField: View {
    let label: String
    @Binding var value: JSONValue?

    @State private var text: String

    init(label: String, value: Binding<JSONValue?>) {
        self.label = label
        _value = value
        let items = value.wrappedValue?.arrayValue?.compactMap(\.stringValue) ?? []
        _text = State(initialValue: items.joined(separator: ", "))
    }

    var body: some View {
        TextField("comma, separated", text: $text)
            .font(AturiFont.body)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .padding(10)
            .cardBackground(cornerRadius: 8)
            .accessibilityLabel(label)
            .onChange(of: text) { _, next in
                let parts = next.split(separator: ",")
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                value = .array(parts.map { .string($0) })
            }
    }
}

/// A numeric field; blank clears the value rather than writing zero.
private struct NumberField: View {
    let label: String
    @Binding var value: JSONValue?

    @State private var text: String

    init(label: String, value: Binding<JSONValue?>) {
        self.label = label
        _value = value
        /* Integral numbers print without a trailing ".0", as the web's
           number input shows them. */
        let initial: String
        if let whole = value.wrappedValue?.intValue {
            initial = String(whole)
        } else if let number = value.wrappedValue?.doubleValue {
            initial = String(number)
        } else {
            initial = ""
        }
        _text = State(initialValue: initial)
    }

    var body: some View {
        TextField("", text: $text)
            .font(AturiFont.mono)
            .keyboardType(.numbersAndPunctuation)
            .autocorrectionDisabled()
            .padding(10)
            .cardBackground(cornerRadius: 8)
            .accessibilityLabel(label)
            .onChange(of: text) { _, next in
                let trimmed = next.trimmingCharacters(in: .whitespaces)
                if trimmed.isEmpty {
                    value = nil
                } else if let number = Double(trimmed) {
                    value = .number(number)
                }
            }
    }
}

/// A raw JSON field for the shapes the form does not model (a like's
/// `subject`). The text is local so a half-typed value is not lost; the
/// parsed value is written whenever the text parses, blank clears it.
private struct JSONField: View {
    let label: String
    @Binding var value: JSONValue?

    @State private var text: String
    @State private var parseError = false

    @Environment(\.aturiTheme) private var theme

    init(label: String, value: Binding<JSONValue?>) {
        self.label = label
        _value = value
        _text = State(initialValue: value.wrappedValue.map { $0.prettyPrinted() } ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextEditor(text: $text)
                .font(AturiFont.monoSmall)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 120)
                .padding(6)
                .cardBackground(cornerRadius: 8)
                .accessibilityLabel(label)
                .onChange(of: text) { _, next in
                    let trimmed = next.trimmingCharacters(in: .whitespacesAndNewlines)
                    if trimmed.isEmpty {
                        value = nil
                        parseError = false
                    } else if let parsed = try? JSONValue.parse(Data(trimmed.utf8)) {
                        value = parsed
                        parseError = false
                    } else {
                        parseError = true
                    }
                }
            if parseError {
                Text("JSON error: the text does not parse.")
                    .font(.caption)
                    .foregroundStyle(theme.danger)
            }
        }
    }
}
