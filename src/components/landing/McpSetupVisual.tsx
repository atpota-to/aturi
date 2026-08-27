'use client';

import CopyButton from '@/components/explore/CopyButton';

/**
 * The shapes of "add this server", one per client: a settings path for
 * Claude's UI, a CLI command for the terminal agents, and the JSON fragment
 * editors want under their own servers key. Nothing here is aturi-specific
 * except the URL, which is the point.
 */

type Setup = {
  client: string;
  kind: 'path' | 'command' | 'json';
  body: string;
  /**
   * What the button puts on the clipboard, where that differs from what is
   * shown. Copying a menu path helps nobody; the URL it ends with does.
   */
  copy: string;
};

export default function McpSetupVisual({ endpoint }: { endpoint: string }) {
  const setups: Setup[] = [
    {
      client: 'Claude',
      kind: 'path',
      body: `Settings › Connectors › Add custom connector\n${endpoint}`,
      copy: endpoint,
    },
    {
      client: 'Claude Code',
      kind: 'command',
      body: `claude mcp add --transport http atmosphere ${endpoint}`,
      copy: `claude mcp add --transport http atmosphere ${endpoint}`,
    },
    {
      client: 'Cursor, VS Code',
      kind: 'json',
      body: `{ "atmosphere": { "url": "${endpoint}" } }`,
      copy: `{ "atmosphere": { "url": "${endpoint}" } }`,
    },
    {
      client: 'Codex',
      kind: 'command',
      body: `codex mcp add atmosphere --url ${endpoint}`,
      copy: `codex mcp add atmosphere --url ${endpoint}`,
    },
    {
      // opencode keys its servers under `mcp`, and a remote one has to say so
      // — without `"type": "remote"` it is read as a local stdio command.
      client: 'opencode',
      kind: 'json',
      body: `{ "atmosphere": { "type": "remote", "url": "${endpoint}" } }`,
      copy: `{ "atmosphere": { "type": "remote", "url": "${endpoint}" } }`,
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
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '0.5rem',
              padding: '0.35rem 0.35rem 0.35rem 0.75rem',
              borderBottom: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
            }}
          >
            <span
              style={{
                fontSize: '0.7rem',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontFamily: 'var(--font-serif)',
                color: 'var(--text-tertiary)',
                lineHeight: 1,
              }}
            >
              {setup.client}
            </span>
            <CopyButton
              value={setup.copy}
              label={setup.kind === 'path' ? 'Copy URL' : 'Copy'}
              compact
              variant="subtle"
            />
          </div>
          <pre
            style={{
              // globals.css gives every <pre> a border and its own tertiary
              // background. Inside this card both are redundant, and the
              // border read as a second, thicker edge around the row.
              margin: 0,
              border: 'none',
              background: 'transparent',
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
