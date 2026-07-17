/**
 * Lexicon templates for the explorer's record editor. Anything not listed
 * here falls back to a raw JSON editor.
 *
 * These are intentionally lightweight — they cover the most-edited common
 * fields, and the JSON toggle inside the editor lets advanced users reach
 * anything that isn't modeled.
 */

export type LexiconFieldType =
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'datetime'
  | 'tags'
  | 'json'
  | 'boolean'
  | 'number';

export type LexiconField = {
  key: string;
  label: string;
  type: LexiconFieldType;
  required?: boolean;
  autoOnEdit?: boolean;
  default?: string | number | boolean | string[];
  placeholder?: string;
  maxLength?: number;
  hint?: string;
};

export type Lexicon = {
  label: string;
  summary?: string;
  /** 'tid' — auto-generated rkey on create. 'fixed' — caller picks the rkey. */
  rkeyMode: 'tid' | 'fixed';
  rkeyPlaceholder?: string;
  rkeyDefault?: string;
  typeFieldValue?: string;
  fields: LexiconField[];
};

const COMMON_TIMESTAMPS: LexiconField[] = [
  { key: 'createdAt', label: 'Created at', type: 'datetime', default: 'now', required: true },
  { key: 'updatedAt', label: 'Updated at', type: 'datetime', default: 'now', autoOnEdit: true },
];

export const LEXICONS: Record<string, Lexicon> = {
  'app.bsky.feed.post': {
    label: 'Bluesky post',
    summary: 'Plain text posts. Embeds are out of scope for the templated editor; use raw JSON.',
    rkeyMode: 'tid',
    typeFieldValue: 'app.bsky.feed.post',
    fields: [
      { key: 'text', label: 'Text', type: 'textarea', required: true, maxLength: 300 },
      { key: 'langs', label: 'Languages', type: 'tags', default: ['en'], hint: 'BCP-47 codes' },
      { key: 'createdAt', label: 'Created at', type: 'datetime', default: 'now', required: true },
    ],
  },

  'app.bsky.actor.profile': {
    label: 'Bluesky profile',
    summary: 'Display name, bio, links. Avatar/banner blob references not editable via the form.',
    rkeyMode: 'fixed',
    rkeyDefault: 'self',
    rkeyPlaceholder: 'self',
    typeFieldValue: 'app.bsky.actor.profile',
    fields: [
      { key: 'displayName', label: 'Display name', type: 'text', maxLength: 64 },
      { key: 'description', label: 'Description', type: 'textarea', maxLength: 256 },
      { key: 'pronouns', label: 'Pronouns', type: 'text' },
    ],
  },

  'app.bsky.feed.like': {
    label: 'Bluesky like',
    rkeyMode: 'tid',
    typeFieldValue: 'app.bsky.feed.like',
    fields: [
      { key: 'subject', label: 'Subject (raw JSON)', type: 'json', required: true, hint: '{ "uri": "at://...", "cid": "..." }' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  'app.bsky.feed.repost': {
    label: 'Bluesky repost',
    rkeyMode: 'tid',
    typeFieldValue: 'app.bsky.feed.repost',
    fields: [
      { key: 'subject', label: 'Subject (raw JSON)', type: 'json', required: true, hint: '{ "uri": "at://...", "cid": "..." }' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  'app.bsky.graph.follow': {
    label: 'Bluesky follow',
    rkeyMode: 'tid',
    typeFieldValue: 'app.bsky.graph.follow',
    fields: [
      { key: 'subject', label: 'Subject DID', type: 'text', required: true, placeholder: 'did:plc:…' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  'app.bsky.graph.block': {
    label: 'Bluesky block',
    rkeyMode: 'tid',
    typeFieldValue: 'app.bsky.graph.block',
    fields: [
      { key: 'subject', label: 'Subject DID', type: 'text', required: true, placeholder: 'did:plc:…' },
      ...COMMON_TIMESTAMPS,
    ],
  },

  'app.bsky.graph.list': {
    label: 'Bluesky list',
    rkeyMode: 'tid',
    typeFieldValue: 'app.bsky.graph.list',
    fields: [
      { key: 'name', label: 'Name', type: 'text', required: true, maxLength: 64 },
      { key: 'purpose', label: 'Purpose', type: 'text', placeholder: 'app.bsky.graph.defs#modlist or curatelist' },
      { key: 'description', label: 'Description', type: 'textarea', maxLength: 300 },
      ...COMMON_TIMESTAMPS,
    ],
  },
};

export function lexiconFor(collection: string | null | undefined): Lexicon | null {
  if (!collection) return null;
  return LEXICONS[collection] || null;
}

export function knownCollections(): string[] {
  return Object.keys(LEXICONS);
}

/**
 * Build a fresh form-shaped object for a new record using the lexicon's
 * field defaults. `$type` and any required default values are filled in.
 */
export function blankRecordFor(collection: string): Record<string, unknown> {
  const lex = lexiconFor(collection);
  const out: Record<string, unknown> = {};
  if (lex?.typeFieldValue) out.$type = lex.typeFieldValue;
  if (!lex) return out;
  const nowIso = new Date().toISOString();
  for (const f of lex.fields) {
    if (f.default === 'now') {
      out[f.key] = nowIso;
    } else if (f.default !== undefined) {
      out[f.key] = f.default;
    }
  }
  return out;
}
