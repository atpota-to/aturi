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
    <div className="fl-mock fl-setup" data-size="l">
      {setups.map((setup) => (
        <div key={setup.client} className="fl-setup-row">
          <div className="fl-setup-head">
            <span className="fl-setup-client">{setup.client}</span>
            <CopyButton
              value={setup.copy}
              label={setup.kind === 'path' ? 'Copy URL' : 'Copy'}
              compact
              variant="subtle"
            />
          </div>
          {/* globals.css gives every <pre> a border and background; the
              .fl-setup-code rule clears both inside this card. */}
          <pre className="fl-setup-code" data-kind={setup.kind}>
            {setup.body}
          </pre>
        </div>
      ))}
    </div>
  );
}
