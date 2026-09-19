import SwiftUI
import AturiCore

/// A placeholder editor for the owner's own record: the value as JSON in
/// a text editor, written back through the session store's `putRecord`.
/// The web's form editor (`RecordEditor.tsx`, with lexicon templates and
/// delete) is a later pass; this keeps the affordance real in the meantime.
struct RecordEditorSheet: View {
    let record: AtRecord
    var onSaved: ((JSONValue) -> Void)? = nil

    @State private var text: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    @Environment(\.sessionStore) private var session
    @Environment(\.dismiss) private var dismiss
    @Environment(\.aturiTheme) private var theme

    init(record: AtRecord, onSaved: ((JSONValue) -> Void)? = nil) {
        self.record = record
        self.onSaved = onSaved
        _text = State(initialValue: record.value.prettyPrinted())
    }

    /// The collection and rkey the record lives at, read off its URI.
    private var target: (collection: String, rkey: String)? {
        guard let uri = AtUri(parsing: record.uri),
              let collection = uri.collection, !collection.isEmpty,
              let rkey = uri.rkey, !rkey.isEmpty
        else { return nil }
        return (collection, rkey)
    }

    private var parsed: JSONValue? {
        try? JSONValue.parse(Data(text.utf8))
    }

    private var canSave: Bool {
        session.writeAccess && target != nil && parsed != nil && !isSaving
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 10) {
                TextEditor(text: $text)
                    .font(AturiFont.monoSmall)
                    .autocorrectionDisabled()
                    .textInputAutocapitalization(.never)
                    .scrollContentBackground(.hidden)
                    .padding(8)
                    .cardBackground()
                    .accessibilityLabel("Record JSON")
                if parsed == nil {
                    Text("Not valid JSON")
                        .font(.caption)
                        .foregroundStyle(theme.danger)
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
                }
            }
            .padding(16)
            .background(theme.bgPrimary)
            .navigationTitle(RecordModel.editLabel)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                    .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving\u{2026}" : "Save") {
                        save()
                    }
                    .disabled(!canSave)
                }
            }
            .interactiveDismissDisabled(isSaving)
        }
    }

    private func save() {
        guard let target, let value = parsed else { return }
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
}
