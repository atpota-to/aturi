'use client';

import { TOOL_GROUPS } from '@/lib/mcp/catalog';

/**
 * The tool catalog as a grid of groups. Rendered from src/lib/mcp/catalog.ts,
 * which a test pins to the tools the server actually registers, so this
 * visual cannot advertise a tool that does not exist or miss one that does.
 */
export default function McpToolCatalogVisual() {
  return (
    <div className="fl-tools">
      {TOOL_GROUPS.map((group) => (
        <div key={group.id} className="fl-card fl-tool-group">
          <div className="fl-tool-group-head">
            <span className="fl-tool-group-title">{group.title}</span>
            <span className="fl-count" data-soft="">
              {group.tools.length}
            </span>
          </div>
          <div className="fl-tool-group-list">
            {group.tools.slice(0, 3).map((tool) => (
              <code key={tool.name} className="fl-ellipsis">
                {tool.name}
              </code>
            ))}
            {group.tools.length > 3 && (
              <span className="fl-tool-more">+{group.tools.length - 3} more</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
