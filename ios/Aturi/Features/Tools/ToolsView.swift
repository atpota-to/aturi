import SwiftUI
import AturiCore

/// The Tools tab's root (`/tools`), port of `ToolsLanding.tsx`: every tool
/// in `ToolCatalog`, by group. Each row pushes the tool's page; a tool's
/// input travels in its route's query, as it does in the web's address.
struct ToolsView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    private static let pageURL = Endpoints.aturiBase.appending(path: "tools")
    /// The padded content's id, scrolled to when the router asks for the
    /// top (the tab reselected at its root, or a `/tools` link). It sits
    /// outside the padding so the header comes back with its margin.
    static let topID = "tools-top"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    ForEach(ToolCatalog.byGroup(), id: \.group.id) { entry in
                        groupSection(entry.group, tools: entry.tools)
                    }
                }
                .padding(16)
                .id(Self.topID)
            }
            .onChange(of: router.scrollToTopRequest[.tools, default: 0]) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) {
                    proxy.scrollTo(Self.topID, anchor: .top)
                }
            }
        }
        .background(theme.bgPrimary)
        .navigationTitle("Tools")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: Self.pageURL) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share")
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Tools", systemImage: "wrench.and.screwdriver")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Text("Small tools for the Atmosphere")
                .font(AturiFont.display)
                .tracking(AturiFont.displayTracking)
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func groupSection(_ group: ToolGroup, tools: [ToolEntry]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(group.title)
                .font(AturiFont.sans(.headline, weight: .bold))
                .foregroundStyle(theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) {
                ForEach(Array(tools.enumerated()), id: \.element.id) { index, tool in
                    if index > 0 {
                        Divider()
                    }
                    toolRow(tool)
                }
            }
            .cardBackground()
        }
    }

    private func toolRow(_ tool: ToolEntry) -> some View {
        NavigationLink(value: Route.tool(slug: tool.slug)) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: ToolIcon.systemImage(for: tool.slug))
                    .font(AturiFont.sans(.body, weight: .medium))
                    .foregroundStyle(theme.textAccent)
                    .frame(width: 32, height: 32)
                    .background(theme.accentSoft, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 3) {
                    Text(tool.title)
                        .font(AturiFont.sans(.body, weight: .semibold))
                        .foregroundStyle(theme.textPrimary)
                    Text(tool.desc)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(AturiFont.caption2)
                    .foregroundStyle(theme.textFaint)
                    .padding(.top, 8)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
    }
}
