import LexiconFavicon from '../tabs/LexiconFavicon';

/**
 * The two glyphs of the Files view, drawn here rather than borrowed from an
 * icon set so they can take the theme's own tones (workbench.css) and carry
 * what a file browser's icons carry: a folder wears the icon of the site its
 * namespace reverses to, and a file wears its kind, the way a document's
 * icon wears its extension.
 *
 * Both fill the box their parent gives them; the list layout draws them at
 * text size and the icon layout large.
 */

/** A folder: a namespace or a collection. `prefix` puts its site's icon on the front. */
export function FolderGlyph({ prefix }: { prefix?: string }) {
  return (
    <span className="fx-fd-glyph" data-kind="folder" aria-hidden>
      <svg viewBox="0 0 64 52" focusable="false">
        <path
          className="fx-fd-folder-back"
          d="M2 9a6 6 0 0 1 6-6h13.2a6 6 0 0 1 4.3 1.8l2.4 2.4A6 6 0 0 0 32.2 9H56a6 6 0 0 1 6 6v29a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6Z"
        />
        <path
          className="fx-fd-folder-front"
          d="M2 21a6 6 0 0 1 6-6h48a6 6 0 0 1 6 6v23a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6Z"
        />
      </svg>
      {prefix && (
        <span className="fx-fd-badge">
          <LexiconFavicon prefix={prefix} />
        </span>
      )}
    </span>
  );
}

/** A file: one record. `kind` is the last segment of its lexicon, its "extension". */
export function FileGlyph({ kind }: { kind: string }) {
  return (
    <span className="fx-fd-glyph" data-kind="file" aria-hidden>
      <svg viewBox="0 0 48 60" focusable="false">
        <path
          className="fx-fd-page"
          d="M5 6a5 5 0 0 1 5-5h19.3a4 4 0 0 1 2.8 1.2l9.7 9.7a4 4 0 0 1 1.2 2.8V54a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5Z"
        />
        <path className="fx-fd-fold" d="M30 1.6V10a4 4 0 0 0 4 4h8.4" />
      </svg>
      <span className="fx-fd-ext">{kind}</span>
    </span>
  );
}

/** The last segment of an NSID: what a record's file icon is labelled with. */
export function fileKindOf(collection: string): string {
  const at = collection.lastIndexOf('.');
  return at >= 0 ? collection.slice(at + 1) : collection;
}
