import SwiftUI
import AturiCore

/// The repo page's ID tab, port of `IdentityTab.tsx`: the PLC document's
/// aliases, services and keys, with the raw document behind a disclosure.
/// Takes the `IdentityModel` the owner drives so the Log tab can share
/// the same fetch.
struct IdentitySection: View {
    private struct FieldRow: Identifiable {
        let id: String
        let value: String
    }

    let model: IdentityModel

    @Environment(\.aturiTheme) private var theme

    init(model: IdentityModel) {
        self.model = model
    }

    var body: some View {
        if !model.isPlc {
            EmptyState(
                title: "Not a did:plc",
                detail: IdentityModel.identityNotPlcMessage(for: model.did),
                systemImage: "person.text.rectangle"
            )
        } else {
            LoadableView(state: model.document, retry: { model.reload() }, skeletonRows: 5) { _ in
                VStack(alignment: .leading, spacing: 20) {
                    section("Also known as") {
                        if model.alsoKnownAs.isEmpty {
                            dash
                        } else {
                            ForEach(model.alsoKnownAs, id: \.self) { alias in
                                IdentifierText(alias, lineLimit: 2, font: AturiFont.monoSmall)
                                    .foregroundStyle(theme.textPrimary)
                            }
                        }
                    }
                    section("Services") {
                        if model.services.isEmpty {
                            dash
                        } else {
                            ForEach(model.services, id: \.id) { service in
                                entryCard(id: service.id, rows: [
                                    FieldRow(id: "type", value: service.type),
                                    FieldRow(id: "endpoint", value: service.serviceEndpoint),
                                ])
                            }
                        }
                    }
                    section("Verification methods") {
                        if model.verificationMethods.isEmpty {
                            dash
                        } else {
                            ForEach(model.verificationMethods, id: \.id) { method in
                                entryCard(
                                    id: method.id,
                                    rows: [FieldRow(id: "type", value: method.type)]
                                        + (method.publicKeyMultibase.map { [FieldRow(id: "key", value: $0)] } ?? [])
                                )
                            }
                        }
                    }
                    if let raw = model.rawDocumentJSON {
                        DisclosureGroup("Raw DID document") {
                            Text(raw)
                                .font(AturiFont.monoSmall)
                                .foregroundStyle(theme.textSecondary)
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.top, 6)
                        }
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                    }
                }
            }
        }
    }

    private var dash: some View {
        Text("\u{2014}")
            .font(AturiFont.monoSmall)
            .foregroundStyle(theme.textTertiary)
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title)
            content()
        }
    }

    private func entryCard(id: String, rows: [FieldRow]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            IdentifierText(id, lineLimit: 2, font: AturiFont.monoSmall)
                .foregroundStyle(theme.textPrimary)
            ForEach(rows) { row in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.id)
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                        .frame(width: 70, alignment: .leading)
                    Text(row.value)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textSecondary)
                        .textSelection(.enabled)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}
