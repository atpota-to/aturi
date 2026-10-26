'use client';

import SearchBox from './explore/SearchBox';
import { ExtensionBrowserLinks } from './home/DownloadButton';

/**
 * Homepage hero: kicker pill, headline, one-line pitch, the Explore search
 * bar (the same one that leads the /explore page), and the extension's
 * per-browser download buttons.
 *
 * The search bar puts the explorer's core action right under the tagline
 * so visitors can jump straight to any repo. The developer entry point
 * that used to sit beside the download button lives in the "For
 * developers and agents" section further down.
 */
export default function HomeHero() {
  return (
    <section className="fn-home-hero" aria-labelledby="fn-home-title">
      <span className="fn-home-pill">Tour the Atmosphere</span>
      <h1 id="fn-home-title" className="fn-home-title">
        Jump between clients, share universal links,{' '}
        <span className="fn-home-title-accent">browse any PDS</span>
      </h1>
      <p className="fn-home-lede">
        Three small tools for the AT Protocol: a browser extension, links that
        open in any app, and an explorer for every account&rsquo;s data.
      </p>

      {/* Left-aligned text inside a centered hero, so the typeahead and
          recommendations dropdown reads naturally. home.css restyles the
          shared SearchBox to the hero's larger field. */}
      <div className="fn-home-search">
        <SearchBox />
      </div>

      <ExtensionBrowserLinks />
    </section>
  );
}
