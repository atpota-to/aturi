export type WaypointSlot =
  | 'root'
  | 'header'
  | 'title'
  | 'subtitle'
  | 'section'
  | 'sectionHeader'
  | 'list'
  | 'category'
  | 'categoryHeader'
  | 'categoryName'
  | 'categoryToggle'
  | 'button'
  | 'icon'
  | 'content'
  | 'name'
  | 'description'
  | 'actions'
  | 'copy'
  | 'open'
  | 'empty'
  | 'universalLink'
  | 'universalLinkIcon'
  | 'universalLinkLabel';

/** Map of slot -> developer-supplied class name(s), merged onto each element. */
export type WaypointClassNames = Partial<Record<WaypointSlot, string>>;

const BASE_CLASS: Record<WaypointSlot, string> = {
  root: 'aturi-wp',
  header: 'aturi-wp-header',
  title: 'aturi-wp-title',
  subtitle: 'aturi-wp-subtitle',
  section: 'aturi-wp-section',
  sectionHeader: 'aturi-wp-section-header',
  list: 'aturi-wp-list',
  category: 'aturi-wp-category',
  categoryHeader: 'aturi-wp-category-header',
  categoryName: 'aturi-wp-category-name',
  categoryToggle: 'aturi-wp-category-toggle',
  button: 'aturi-wp-button',
  icon: 'aturi-wp-icon',
  content: 'aturi-wp-content',
  name: 'aturi-wp-name',
  description: 'aturi-wp-description',
  actions: 'aturi-wp-actions',
  copy: 'aturi-wp-copy',
  open: 'aturi-wp-open',
  empty: 'aturi-wp-empty',
  universalLink: 'aturi-wp-universal-link',
  universalLinkIcon: 'aturi-wp-universal-link-icon',
  universalLinkLabel: 'aturi-wp-universal-link-label',
};

export function cx(
  ...parts: Array<string | false | null | undefined>
): string | undefined {
  const out = parts.filter(Boolean).join(' ');
  return out || undefined;
}

/**
 * Resolve the className for a slot. With `unstyled`, the built-in namespaced
 * class is dropped and only the developer's mapped class (if any) is applied.
 * The `data-aturi-wp="<slot>"` attribute is always present for styling/testing
 * regardless of `unstyled`.
 */
export function slotClass(
  slot: WaypointSlot,
  unstyled?: boolean,
  classNames?: WaypointClassNames,
): string | undefined {
  return cx(!unstyled && BASE_CLASS[slot], classNames?.[slot]);
}
