/**
 * Whether a pointer event happened outside `container`.
 *
 * The obvious test — `container.contains(event.target)` — has a failure mode
 * that a popover containing an autocomplete hits every time. Picking a
 * suggestion removes that suggestion's own list from the DOM, and React
 * flushes discrete events synchronously, so the row is already detached by the
 * time a listener on `document` runs. `contains()` on a detached node answers
 * false, the popover reads that as a click on the page behind it, and closes
 * underneath the person who just tapped inside it.
 *
 * `composedPath()` is the answer to the question actually being asked. The
 * path is fixed when the event is dispatched, so it still names every ancestor
 * the pointer really went through, whatever the handlers have since done to
 * the DOM. It also stays correct in the case `isConnected` would get wrong:
 * something genuinely outside that removes itself on click is still outside.
 *
 * Falls back to `contains` where there is no path to read.
 */
export function isEventOutside(container: Node | null | undefined, event: Event): boolean {
  if (!container) return false;
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  if (path.length > 0) return !path.includes(container);
  const target = event.target as Node | null;
  return target ? !container.contains(target) : false;
}
