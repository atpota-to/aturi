import SwiftUI
import AturiCore

/// The repo page's Log tab, port of `AuditTab.tsx`: PLC operations newest
/// first, each with the diff against the operation before it and the raw
/// operation behind a disclosure.
struct AuditSection: View {
    let model: IdentityModel

    @Environment(\.aturiTheme) private var theme

    init(model: IdentityModel) {
        self.model = model
    }

    var body: some View {
        if !model.isPlc {
            EmptyState(title: IdentityModel.auditNotPlcMessage, systemImage: "clock.arrow.circlepath")
        } else {
            LoadableView(state: model.auditLog, retry: { model.reload() }, skeletonRows: 4) { _ in
                if model.hasNoOperations {
                    EmptyState(title: IdentityModel.noOperationsMessage, systemImage: "clock.arrow.circlepath")
                } else {
                    VStack(spacing: 10) {
                        ForEach(model.auditEntries) { entry in
                            entryCard(entry)
                        }
                    }
                }
            }
        }
    }

    private func entryCard(_ entry: PlcAuditEntryView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(entry.type)
                    .aturiLabel()
                    .foregroundStyle(theme.textSecondary)
                if entry.isNullified {
                    Chip("nullified", style: .danger)
                }
                Spacer(minLength: 8)
                if let date = entry.timestamp {
                    Text(date, format: .dateTime.year().month(.abbreviated).day().hour().minute())
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                } else {
                    Text(entry.createdAt)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                }
            }
            if !entry.changes.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(entry.changes.enumerated()), id: \.offset) { _, change in
                        Text(change)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textSecondary)
                            .textSelection(.enabled)
                    }
                }
            }
            DisclosureGroup("Raw operation") {
                Text(entry.rawJSON)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textSecondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 6)
            }
            .font(.footnote)
            .foregroundStyle(theme.textTertiary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        /* The web marks each entry with an accent rule on its left edge. */
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(theme.accent)
                .frame(width: 3)
                .padding(.vertical, 10)
        }
    }
}
