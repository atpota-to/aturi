'use client';

/**
 * Static mock of the signed-in `/explore/<you>/space` view for the spaces
 * landing hero. Mirrors the live page's two blocks: the SpaceGlance stat
 * cells and the SpaceRows list beneath them, using the same example
 * addresses as the spaces OG image (`my.bulletin.board/self`).
 *
 * The duplicate `my.bulletin.board self` rows are deliberate: `listSpaces`
 * spans spaces anchored on other people's DIDs, so type and key collide
 * constantly and the authority column is what tells the rows apart. The
 * mock keeps that property so it teaches the same thing the real list does.
 */

const CELLS: { label: string; value: string; hint: string }[] = [
  { label: 'Spaces', value: '3', hint: 'Spaces you have written to' },
  { label: 'Authorities', value: '2', hint: '1 run by someone else' },
  { label: 'Records', value: '32', hint: 'Across every space' },
];

const ROWS: { spaceType: string; skey: string; authority: string; yours?: boolean }[] = [
  { spaceType: 'my.bulletin.board', skey: 'self', authority: '@you.example', yours: true },
  { spaceType: 'my.bulletin.board', skey: 'self', authority: '@alice.example' },
  { spaceType: 'my.bulletin.board', skey: 'book-club', authority: '@alice.example' },
];

export default function SpacesGlanceVisual() {
  return (
    <div className="fl-mock">
      <div className="fl-mock-head">
        <span className="fl-mock-head-stack">
          <span className="fl-mock-label">Explore · @you.example</span>
          <span className="fl-mock-head-title">Spaces at a glance</span>
        </span>
      </div>

      <div className="fl-stats" data-cols="3">
        {CELLS.map((cell) => (
          <div key={cell.label} className="fl-stat">
            <span className="fl-stat-label">{cell.label}</span>
            <span className="fl-stat-value">{cell.value}</span>
            <span className="fl-stat-sub">{cell.hint}</span>
          </div>
        ))}
      </div>

      <ul className="fl-spacerows">
        {ROWS.map((row) => (
          <li key={`${row.skey}-${row.authority}`}>
            <span>{row.spaceType}</span>
            <span className="fl-faint">{row.skey}</span>
            <span className="fl-spacerows-auth">
              {row.authority}
              {row.yours && (
                <span className="fl-chip" data-on="">
                  yours
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
