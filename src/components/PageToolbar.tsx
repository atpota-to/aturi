'use client';

import type { ReactNode } from 'react';

/**
 * One button on a {@link PageToolbar}.
 *
 * Most are a 44px icon chip, named by `label` for screen readers and as a
 * tooltip. A `wide` tool takes the room the search field has on the site's
 * own toolbar: an icon and a line of `text`, with an optional terse
 * `status` at its end (a count, "3 of 12"). A row has at most one.
 */
export type PageTool = {
  id: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  wide?: boolean;
  text?: ReactNode;
  status?: ReactNode;
  /** An on/off control: drawn lit while on. */
  pressed?: boolean;
  /** Opens a panel or sheet: drawn lit while it's open. */
  expanded?: boolean;
  /** DOM id of the panel it opens, for aria-controls. */
  controls?: string;
  /** What's set in that panel, worn as a badge. 0 shows none. */
  badge?: number;
  disabled?: boolean;
  /**
   * Tools next to each other with the same group are joined into one control
   * (Zoom out and Zoom in), the way the stream monitor's Pause and Stop are.
   * The group's name is its accessible name.
   */
  group?: string;
};

/**
 * The phone's bottom toolbar, for a page or full-screen view whose own
 * controls should be under the thumb instead of the site's search, Back,
 * Home and menu. Same object as the site's toolbar (`.fn-phone-bar` and
 * <ExploreChromeBar>, chrome.css): a strip pinned flush to the bottom edge,
 * 44px chips, the home indicator's inset under it. `start` sits at the left
 * end, `end` at the right, where a right thumb reaches most easily.
 *
 * Phone only (chrome.css, `max-width: 640px`): wider, the page keeps its own
 * controls where they are, and this isn't drawn. While one is up, the site's
 * own bottom toolbar steps aside, so there's only ever one.
 *
 * A component the view renders rather than a slot the site's toolbar fills
 * (as ChromeBarContext's are), so a modal view can keep it inside its own
 * dialog: a toolbar outside an `aria-modal` dialog is out of reach to a
 * screen reader while the dialog is up.
 */
export default function PageToolbar({
  label,
  start = [],
  end = [],
}: {
  /** Accessible name for the toolbar, e.g. "Thread". */
  label: string;
  start?: PageTool[];
  end?: PageTool[];
}) {
  return (
    <div className="fn-page-toolbar" role="toolbar" aria-label={label}>
      <div className="fn-page-toolbar-inner">
        <ToolRun tools={start} />
        <span className="fn-page-toolbar-gap" aria-hidden />
        <ToolRun tools={end} />
      </div>
    </div>
  );
}

/** A run of tools, with neighbours that share a group joined into one control. */
function ToolRun({ tools }: { tools: PageTool[] }) {
  const runs: PageTool[][] = [];
  for (const tool of tools) {
    const last = runs[runs.length - 1];
    if (tool.group && last?.[0].group === tool.group) last.push(tool);
    else runs.push([tool]);
  }
  return (
    <>
      {runs.map((run) =>
        run.length > 1 ? (
          <div key={run[0].id} className="fn-page-tool-group" role="group" aria-label={run[0].group}>
            {run.map((tool) => (
              <ToolButton key={tool.id} tool={tool} />
            ))}
          </div>
        ) : (
          <ToolButton key={run[0].id} tool={run[0]} />
        ),
      )}
    </>
  );
}

function ToolButton({ tool }: { tool: PageTool }) {
  const badge = tool.badge ?? 0;
  return (
    <button
      type="button"
      onClick={tool.onClick}
      disabled={tool.disabled}
      aria-label={tool.wide ? undefined : badge > 0 ? `${tool.label}, ${badge} set` : tool.label}
      aria-pressed={tool.pressed}
      aria-expanded={tool.expanded}
      aria-controls={tool.controls}
      title={tool.label}
      className="explore-chrome-button fn-page-tool"
      data-wide={tool.wide || undefined}
      data-placeholder={(tool.wide && tool.text == null) || undefined}
      data-on={tool.pressed || tool.expanded || undefined}
    >
      {tool.icon}
      {tool.wide && (
        <>
          <span className="fn-page-tool-text">{tool.text ?? tool.label}</span>
          {tool.status != null && <span className="fn-page-tool-status">{tool.status}</span>}
        </>
      )}
      {badge > 0 && (
        <span className="explore-chrome-badge fn-page-tool-badge" aria-hidden>
          {badge}
        </span>
      )}
    </button>
  );
}
