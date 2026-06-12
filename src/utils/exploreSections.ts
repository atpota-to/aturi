/**
 * Registry + pure helpers for the user-configurable sections that make up
 * the two explorer page types (record pages and repo/profile pages).
 *
 * Dependency-free (no React, no `preferences` import) so both the
 * preferences model and the rendering components can use it without a
 * cycle. Section *metadata* (label / kind) lives here, not in stored
 * preferences, so sections can be recategorised without a migration.
 *
 * A user's saved layout is an ordered list of `{ id, hidden }` per page —
 * array order is display order, `hidden` is per-section visibility (mirrors
 * the `waypointGroups` convention: one JSON value to diff/persist).
 */

export type SectionConfig = { id: string; hidden: boolean };
export type SectionKind = 'record-data' | 'helper';
export type ExplorePage = 'record' | 'repo';

export type RecordSectionId =
  | 'richPreview'
  | 'structuredJson'
  | 'rawJson'
  | 'engagement'
  | 'copyRow'
  | 'lexiconUsage'
  | 'backlinks'
  | 'signIn';

export type RepoSectionId = 'relationship' | 'profile' | 'identity' | 'repoGlance';

export type SectionMeta = {
  id: string;
  label: string;
  description: string;
  kind: SectionKind;
};

/**
 * Record-page sections, in default display order (matches the current
 * layout). The rich preview card, the rich JSON field table, and raw JSON
 * are the "content" views; the rest are helpers.
 */
export const RECORD_SECTION_META: SectionMeta[] = [
  {
    id: 'richPreview',
    label: 'Rich preview',
    description: 'The rendered Bluesky post card (or margin-lexicon card). Records without a card skip this.',
    kind: 'record-data',
  },
  {
    id: 'structuredJson',
    label: 'Rich JSON preview',
    description: "The record's fields as a structured, linkified table.",
    kind: 'record-data',
  },
  {
    id: 'rawJson',
    label: 'Raw JSON',
    description: 'The full, linkified record JSON.',
    kind: 'record-data',
  },
  {
    id: 'engagement',
    label: 'Engagement counts',
    description: 'Followers / posts and similar counts (non-post records).',
    kind: 'helper',
  },
  {
    id: 'copyRow',
    label: 'Copy & links',
    description: 'Copy AT-URI / DID / JSON, plus outbound links.',
    kind: 'helper',
  },
  {
    id: 'lexiconUsage',
    label: 'Lexicon usage',
    description: "How this record's lexicon is used across the network.",
    kind: 'helper',
  },
  {
    id: 'backlinks',
    label: 'Backlinks',
    description: 'Records elsewhere that reference this one.',
    kind: 'helper',
  },
  {
    id: 'signIn',
    label: 'Sign in to edit',
    description: 'Prompt to sign in (only shown when signed out).',
    kind: 'helper',
  },
];

/**
 * Repo/profile-page sections, in default display order. `Breadcrumb`
 * (first) and the tabbed collections view (last) are fixed and not
 * configurable.
 */
export const REPO_SECTION_META: SectionMeta[] = [
  {
    id: 'relationship',
    label: 'Relationship bar',
    description: 'The "you + @them" signals strip (silent for own / signed-out).',
    kind: 'helper',
  },
  {
    id: 'profile',
    label: 'Rich profile card',
    description: 'Avatar, display name, bio, banner and stats.',
    kind: 'record-data',
  },
  {
    id: 'identity',
    label: 'Identity row',
    description: 'Handle, DID and PDS.',
    kind: 'record-data',
  },
  {
    id: 'repoGlance',
    label: 'Repo at a glance',
    description: 'Size, creation date and inbound activity tiles.',
    kind: 'helper',
  },
];

/**
 * Sections that count toward the "at least one data view always stays
 * visible" rule, per page. On record pages it's the field table + raw JSON
 * (the rich preview *card* is a rendering, freely hideable). On repo pages
 * it's the profile card + identity row.
 */
export const GUARANTEED_DATA_IDS: Record<ExplorePage, readonly string[]> = {
  record: ['structuredJson', 'rawJson'],
  repo: ['profile', 'identity'],
};

/** Default visibility: everything shown except raw JSON (off by default). */
export const DEFAULT_RECORD_SECTIONS: SectionConfig[] = RECORD_SECTION_META.map((s) => ({
  id: s.id,
  hidden: s.id === 'rawJson',
}));

export const DEFAULT_REPO_SECTIONS: SectionConfig[] = REPO_SECTION_META.map((s) => ({
  id: s.id,
  hidden: false,
}));

export function sectionMetaFor(page: ExplorePage): SectionMeta[] {
  return page === 'record' ? RECORD_SECTION_META : REPO_SECTION_META;
}

export function defaultSectionsFor(page: ExplorePage): SectionConfig[] {
  return (page === 'record' ? DEFAULT_RECORD_SECTIONS : DEFAULT_REPO_SECTIONS).map((s) => ({
    ...s,
  }));
}

export function isGuaranteedDataView(page: ExplorePage, id: string): boolean {
  return GUARANTEED_DATA_IDS[page].includes(id);
}

export function isValidSectionConfig(x: unknown): x is SectionConfig {
  if (!x || typeof x !== 'object') return false;
  const v = x as Record<string, unknown>;
  return typeof v.id === 'string' && typeof v.hidden === 'boolean';
}

/**
 * Reconcile a saved section list against the current defaults: keep known
 * ids in their saved order + hidden flags, drop unknown ids, then append
 * any default section missing from the saved list (at its default
 * visibility) so sections added in a later release show up for existing
 * users. Mirrors the append-unknown-defaults step in `migrateToGroups`.
 */
export function reconcileSections(
  saved: SectionConfig[],
  defaults: SectionConfig[],
): SectionConfig[] {
  const known = new Set(defaults.map((d) => d.id));
  const seen = new Set<string>();
  const out: SectionConfig[] = [];
  for (const s of saved) {
    if (known.has(s.id) && !seen.has(s.id)) {
      out.push({ id: s.id, hidden: !!s.hidden });
      seen.add(s.id);
    }
  }
  for (const d of defaults) {
    if (!seen.has(d.id)) {
      out.push({ id: d.id, hidden: d.hidden });
      seen.add(d.id);
    }
  }
  return out;
}

/** Number of currently-visible guaranteed data views for a page. */
export function countVisibleGuaranteed(
  sections: SectionConfig[],
  page: ExplorePage,
): number {
  const ids = GUARANTEED_DATA_IDS[page];
  return sections.filter((s) => !s.hidden && ids.includes(s.id)).length;
}

/** Whether a section id is marked hidden in a saved list. */
export function sectionHidden(sections: SectionConfig[], id: string): boolean {
  return sections.find((s) => s.id === id)?.hidden === true;
}
