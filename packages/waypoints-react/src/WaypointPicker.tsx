import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
} from 'react';
import { ChevronDown } from 'lucide-react';
import type { WaypointType } from '@aturi/waypoints';
import {
  useWaypoints,
  type CustomWaypoint,
  type WaypointCategoryEntry,
  type WaypointEntry,
} from './useWaypoints';
import { WaypointList, type RenderWaypoint } from './WaypointList';
import { cx, slotClass, type WaypointClassNames } from './styling';

export type WaypointPickerProps = {
  type: WaypointType;
  handle: string;
  collection?: string;
  rkey?: string;
  did?: string;
  /** Defaults to `@handle`. Used in the contextual subtitle. */
  displayName?: string;
  waypointIds?: string[];
  hiddenIds?: string[];
  customWaypoints?: CustomWaypoint[];
  /** Show the recommended section. Default true. */
  showRecommended?: boolean;
  /** Show the per-row copy button. Default true. */
  showCopy?: boolean;
  /** Override the default open-in-new-tab behavior. */
  onSelect?: (waypoint: WaypointEntry, event: MouseEvent) => void;
  /** Drop all built-in class names; keep only `data-aturi-wp` hooks. */
  unstyled?: boolean;
  classNames?: WaypointClassNames;
  /** Replace the default row markup entirely. */
  renderWaypoint?: RenderWaypoint;
  /** Extra class on the root element (always applied). */
  className?: string;
};

type CategoryRowProps = {
  category: WaypointCategoryEntry;
  expanded: Set<string>;
  onToggle: (id: string) => void;
  copiedId: string | null;
  onCopy?: (waypoint: WaypointEntry) => void;
  onSelect?: (waypoint: WaypointEntry, event: MouseEvent) => void;
  showCopy: boolean;
  unstyled?: boolean;
  classNames?: WaypointClassNames;
  renderWaypoint?: RenderWaypoint;
};

function CategoryRow({
  category,
  expanded,
  onToggle,
  copiedId,
  onCopy,
  onSelect,
  showCopy,
  unstyled,
  classNames,
  renderWaypoint,
}: CategoryRowProps) {
  const isOpen = expanded.has(category.id);
  return (
    <div
      data-aturi-wp="category"
      data-category={category.id}
      data-expanded={isOpen || undefined}
      className={slotClass('category', unstyled, classNames)}
    >
      <button
        type="button"
        data-aturi-wp="category-header"
        aria-expanded={isOpen}
        className={slotClass('categoryHeader', unstyled, classNames)}
        onClick={() => onToggle(category.id)}
      >
        <span
          data-aturi-wp="category-name"
          className={slotClass('categoryName', unstyled, classNames)}
        >
          {category.name}
        </span>
        <ChevronDown
          size={18}
          aria-hidden
          data-aturi-wp="category-toggle"
          className={slotClass('categoryToggle', unstyled, classNames)}
          style={{ transform: isOpen ? 'rotate(180deg)' : undefined }}
        />
      </button>
      {isOpen ? (
        <>
          {category.waypoints.length > 0 ? (
            <WaypointList
              waypoints={category.waypoints}
              copiedId={copiedId}
              onCopy={onCopy}
              onSelect={onSelect}
              showCopy={showCopy}
              unstyled={unstyled}
              classNames={classNames}
              renderWaypoint={renderWaypoint}
            />
          ) : null}
          {category.subcategories.map((sub) => (
            <CategoryRow
              key={sub.id}
              category={sub}
              expanded={expanded}
              onToggle={onToggle}
              copiedId={copiedId}
              onCopy={onCopy}
              onSelect={onSelect}
              showCopy={showCopy}
              unstyled={unstyled}
              classNames={classNames}
              renderWaypoint={renderWaypoint}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function contextText(type: WaypointType, display: string): string {
  switch (type) {
    case 'post':
      return `Open post by ${display} on…`;
    case 'profile':
      return `Open profile for ${display} on…`;
    case 'list':
      return `Open list by ${display} on…`;
    case 'record':
      return `Open record from ${display} on…`;
    default:
      return `Open content from ${display} on…`;
  }
}

/**
 * Self-contained "Open in…" picker. Headless by default — emits namespaced
 * `data-aturi-wp` hooks and `aturi-wp-*` classes but ships no CSS. Opt into the
 * polished theme with `import '@aturi/waypoints-react/styles.css'`, map your own
 * classes via `classNames`, pass `unstyled` to drop built-in classes, or replace
 * rows entirely with `renderWaypoint`.
 */
export function WaypointPicker({
  type,
  handle,
  collection,
  rkey,
  did,
  displayName,
  waypointIds,
  hiddenIds,
  customWaypoints,
  showRecommended = true,
  showCopy = true,
  onSelect,
  unstyled,
  classNames,
  renderWaypoint,
  className,
}: WaypointPickerProps) {
  const { recommended, categories, copy } = useWaypoints({
    type,
    handle,
    collection,
    rkey,
    did,
    waypointIds,
    hiddenIds,
    customWaypoints,
  });

  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Smart expansion: open categories (and subcategories) that have at least
  // one compatible waypoint. `useWaypoints` already drops null-url waypoints,
  // so "has waypoints" is exactly "has compatible waypoints".
  const initialExpanded = useMemo(() => {
    const set = new Set<string>();
    const walk = (category: WaypointCategoryEntry) => {
      const subHasWaypoints = category.subcategories.some(
        (s) => s.waypoints.length > 0,
      );
      if (category.waypoints.length > 0 || subHasWaypoints) set.add(category.id);
      category.subcategories.forEach((sub) => {
        if (sub.waypoints.length > 0) set.add(sub.id);
        walk(sub);
      });
    };
    categories.forEach(walk);
    return set;
  }, [categories]);

  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  useEffect(() => setExpanded(initialExpanded), [initialExpanded]);

  const handleCopy = useCallback(
    async (waypoint: WaypointEntry) => {
      const ok = await copy(waypoint.url);
      if (ok) {
        setCopiedId(waypoint.id);
        setTimeout(() => setCopiedId(null), 2000);
      }
    },
    [copy],
  );

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const display = displayName || `@${handle}`;
  const onCopy = showCopy ? handleCopy : undefined;
  const hasRecommended = showRecommended && recommended.waypoints.length > 0;
  const hasAny = recommended.waypoints.length > 0 || categories.length > 0;

  return (
    <div
      data-aturi-wp="root"
      className={cx(slotClass('root', unstyled, classNames), className)}
    >
      <div
        data-aturi-wp="header"
        className={slotClass('header', unstyled, classNames)}
      >
        <p
          data-aturi-wp="subtitle"
          className={slotClass('subtitle', unstyled, classNames)}
        >
          {contextText(type, display)}
        </p>
      </div>

      {!hasAny ? (
        <div
          data-aturi-wp="empty"
          className={slotClass('empty', unstyled, classNames)}
        >
          No waypoints available for this content type yet.
        </div>
      ) : null}

      {hasRecommended ? (
        <section
          data-aturi-wp="section"
          data-section="recommended"
          className={slotClass('section', unstyled, classNames)}
        >
          <h2
            data-aturi-wp="section-header"
            className={slotClass('sectionHeader', unstyled, classNames)}
          >
            {recommended.label}
          </h2>
          <WaypointList
            waypoints={recommended.waypoints}
            copiedId={copiedId}
            onCopy={onCopy}
            onSelect={onSelect}
            showCopy={showCopy}
            unstyled={unstyled}
            classNames={classNames}
            renderWaypoint={renderWaypoint}
          />
        </section>
      ) : null}

      {categories.length > 0 ? (
        <section
          data-aturi-wp="section"
          data-section="more"
          className={slotClass('section', unstyled, classNames)}
        >
          {hasRecommended ? (
            <h2
              data-aturi-wp="section-header"
              className={slotClass('sectionHeader', unstyled, classNames)}
            >
              More Options
            </h2>
          ) : null}
          {categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              expanded={expanded}
              onToggle={toggle}
              copiedId={copiedId}
              onCopy={onCopy}
              onSelect={onSelect}
              showCopy={showCopy}
              unstyled={unstyled}
              classNames={classNames}
              renderWaypoint={renderWaypoint}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}
