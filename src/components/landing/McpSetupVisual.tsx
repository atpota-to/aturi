'use client';

/**
 * The three shapes of "add this server", side by side: a settings path for
 * Claude's UI, a CLI command, and the JSON block editors want. Nothing here
 * is aturi-specific except the URL, which is the point.
 */

type Setup = { client: string; kind: 'path' | 'command' | 'json'; body: string };

export default function McpSetupVisual({ endpoint }: { endpoint: string }) {
  const setups: Setup[] = [
    {
      client: 'Claude',
      kind: 'path',
      body: `Settings › Connectors › Add custom connector\n${endpoint}`,
    },
    {
      client: 'Claude Code',
      kind: 'command',
      body: `claude mcp add --transport http aturi ${endpoint}`,
    },
    {
      client: 'Cursor, VS Code',
      kind: 'json',
      body: `{ "aturi": { "url": "${endpoint}" } }`,
    },
  ];

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {setups.map((setup) => (
        <div
          key={setup.client}
          style={{
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              padding: '0.45rem 0.75rem',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              fontSize: '0.7rem',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-serif)',
              color: 'var(--text-tertiary)',
              lineHeight: 1,
            }}
          >
            {setup.client}
          </div>
          <pre
            style={{
              margin: 0,
              padding: '0.625rem 0.75rem',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.68rem',
              lineHeight: 1.55,
              color: setup.kind === 'path' ? 'var(--text-secondary)' : 'var(--text-accent)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {setup.body}
          </pre>
        </div>
      ))}
    </div>
  );
}
