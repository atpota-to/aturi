'use client';

import { TOOL_GROUPS } from '@/lib/mcp/catalog';

/**
 * The tool catalog as a grid of groups. Rendered from src/lib/mcp/catalog.ts,
 * which a test pins to the tools the server actually registers, so this
 * visual cannot advertise a tool that does not exist or miss one that does.
 */
export default function McpToolCatalogVisual() {
  return (
    <div
      style={{
        width: '100%',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(8.5rem, 1fr))',
        gap: '0.5rem',
      }}
    >
      {TOOL_GROUPS.map((group) => (
        <div
          key={group.id}
          style={{
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            padding: '0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
            <span
              style={{
                fontSize: '0.78rem',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-serif)',
                letterSpacing: '0.02em',
              }}
            >
              {group.title}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.68rem',
                color: 'var(--text-accent)',
              }}
            >
              {group.tools.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
            {group.tools.slice(0, 3).map((tool) => (
              <code
                key={tool.name}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.65rem',
                  color: 'var(--text-tertiary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {tool.name}
              </code>
            ))}
            {group.tools.length > 3 && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--text-tertiary)', opacity: 0.7 }}>
                +{group.tools.length - 3} more
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
