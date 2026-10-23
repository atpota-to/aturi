import type { Metadata } from 'next';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: 'Browser Extension Privacy Policy - aturi.to',
  description:
    'Privacy policy for the Aturi browser extension. What data it stores, what permissions it uses, and why.',
};

export default function ExtensionPrivacyPage() {
  return (
    <>
      <Header compact />

      <div className="container-narrow fl-container">
        <div className="fl-page fl-doc-page">
          <header className="fl-hero-copy">
            <span className="fl-pill">Browser extension</span>
            <h1 className="fl-title">Browser Extension Privacy Policy</h1>
            <p className="fl-doc-date">Last updated: May 26, 2026</p>
          </header>

          <article className="fl-card fl-doc">
            <section>
              <h2>Summary</h2>
              <p>
                The Aturi browser extension does not collect, transmit, or sell
                any personal data. It has no analytics, no telemetry, no
                tracking, no advertising, and no remote code. Everything you
                configure stays in your own browser.
              </p>
              <p>
                The extension does, however, read limited information from
                pages you visit so it can offer waypoints and inspect AT URIs.
                Page reading happens entirely inside your browser; the
                extension never sends page contents to Aturi-operated servers.
                The extension also makes anonymous lookups to public atproto
                services (Bluesky AppView, PLC directory, Constellation, and
                your chosen Personal Data Server) when you actively use the
                waypoint picker or the Inspect tab. The details of every
                network request and every part of the page that is read are
                described below.
              </p>
            </section>

            <section>
              <h2>1. What the extension stores</h2>
              <p>
                The extension saves your preferences locally using your
                browser&rsquo;s built-in extension storage (
                <code>chrome.storage.sync</code>, with a fallback to{' '}
                <code>chrome.storage.local</code> if the sync quota is
                exceeded). The data stored is limited to:
              </p>
              <ul>
                <li>
                  Your auto-redirect preferences (whether it&rsquo;s on, your
                  favorite waypoint per content family, and per-source
                  overrides).
                </li>
                <li>
                  Custom waypoints you define (name, domain, URL templates, and
                  category).
                </li>
                <li>
                  Your waypoint groups, ordering, and visibility choices.
                </li>
                <li>
                  A capped local list of recently used waypoints (up to 20
                  entries) used to surface frequently used destinations in the
                  popup. You can disable this in the History tab and clear it
                  at any time.
                </li>
                <li>UI preferences such as compact mode and open-in-new-tab.</li>
              </ul>
              <p>
                No part of this data is sent to Aturi, the developer, or any
                third party. If you are signed into your browser and have
                extension sync enabled, your browser vendor (Google, Mozilla,
                Apple, etc.) may sync this data across your devices through
                their own infrastructure under their own privacy policy. Aturi
                has no access to that synced data.
              </p>
              <p>
                The Inspect tab does not persist anything. AT URIs found on
                the page, identity records, record previews, and backlink
                counts live only in popup memory while the popup is open and
                are discarded when you close it.
              </p>
            </section>

            <section>
              <h2>2. What the extension reads from pages</h2>
              <p>
                The extension includes two content scripts that run on
                ordinary web pages. Both run entirely inside your browser. No
                data they read is ever sent to Aturi-operated servers; the
                extension only uses what they read to render the popup and
                Inspect tab locally.
              </p>
              <ul>
                <li>
                  <strong>Passive head detection</strong> (
                  <code>detect-head.content.ts</code>). On every page load, a
                  tiny script runs once and looks for{' '}
                  <code>&lt;link href=&quot;at://&hellip;&quot;&gt;</code>{' '}
                  elements in the document head. It does not read any other
                  part of the page, does not modify the page, and does not
                  send anything anywhere until you open the toolbar popup. If
                  the popup asks (and only then), it returns the AT URI it
                  found so the popup can show relevant waypoints. This is how
                  the extension supports apps like Leaflet, Offprint, and
                  pckt, which advertise their AT URI in the head rather than
                  the URL.
                </li>
                <li>
                  <strong>On-demand Inspect scan</strong> (
                  <code>inspect-scan.content.ts</code>). This script does
                  nothing until you open the popup&rsquo;s{' '}
                  <strong>Inspect</strong> tab on the page. When you do, it
                  scans the page for AT URIs (<code>at://&hellip;</code>) in
                  the document head, OpenGraph and Twitter meta tags, anchor
                  hrefs, JSON-LD blocks, and a capped portion (up to about
                  2&nbsp;MB) of the page&rsquo;s visible text. It returns the
                  URIs it finds, deduplicated, along with a short surrounding
                  text snippet for context. It does not log, persist, or
                  transmit any other page content.
                </li>
              </ul>
              <p>
                Neither script injects content into pages you visit, modifies
                the DOM, intercepts form input, executes remote code, or
                participates in any cross-origin tracking. You can disable
                them entirely by uninstalling the extension or, on most
                browsers, by revoking host permissions for specific sites in
                the extension settings page.
              </p>
            </section>

            <section>
              <h2>3. Network requests</h2>
              <p>
                The extension makes a small number of well-defined network
                requests, each tied to a specific user action. None of these
                requests go to Aturi-operated servers; they go directly from
                your browser to the relevant public atproto service, whose
                own privacy policy applies.
              </p>
              <ul>
                <li>
                  <strong>Handle resolution.</strong> When the popup needs to
                  turn a handle (e.g. <code>example.bsky.social</code>) into
                  a DID (for example, because a waypoint you clicked
                  requires a DID), the extension calls{' '}
                  <code>
                    public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle
                  </code>
                  . The handle is sent as a query parameter; nothing else is
                  sent.
                </li>
                <li>
                  <strong>Inspect: identity resolution.</strong> When you open
                  the Inspect tab and there is an AT URI to look up, the
                  extension resolves the repo identifier through the same
                  Bluesky AppView and, for <code>did:plc:&hellip;</code>{' '}
                  identifiers, may also fetch the DID document from the PLC
                  directory (<code>plc.directory</code>) to discover the
                  user&rsquo;s PDS host.
                </li>
                <li>
                  <strong>Inspect: record fetch.</strong> Once the PDS host is
                  known, the extension calls{' '}
                  <code>com.atproto.repo.getRecord</code> on that PDS to fetch
                  the record itself (when the AT URI points at a specific
                  collection and rkey) so the Inspect card can show a
                  preview.
                </li>
                <li>
                  <strong>Inspect: backlink count.</strong> The Inspect tab
                  queries the third-party Constellation index (
                  <code>constellation.microcosm.blue</code>) with the AT URI
                  to fetch an aggregate count of public backlinks to that
                  record.
                </li>
              </ul>
              <p>
                <strong>Auto-redirects do not make network requests.</strong>{' '}
                They are implemented with{' '}
                <code>chrome.declarativeNetRequest</code>, which lets the
                browser rewrite URLs locally based on static rules the
                extension generates from your preferences. The extension does
                not see, read, or log the URLs you visit while redirects run.
              </p>
              <p>
                The extension never contacts <code>aturi.to</code> or any
                other Aturi-operated server during normal use.
              </p>
            </section>

            <section>
              <h2>4. Permissions and why they&rsquo;re needed</h2>
              <ul>
                <li>
                  <strong>storage</strong>: to persist your preferences,
                  custom waypoints, and recents list.
                </li>
                <li>
                  <strong>tabs</strong>: to read the URL (and, for
                  Inspect, the tab id) of the current tab when you open the
                  popup, so the extension can offer waypoints that match the
                  page you&rsquo;re on and route the Inspect scan request to
                  the right tab.
                </li>
                <li>
                  <strong>declarativeNetRequest</strong>: to perform
                  local URL redirects without exposing your browsing history
                  to the extension.
                </li>
                <li>
                  <strong>clipboardWrite</strong>: to copy universal
                  Aturi links to your clipboard when you use the &ldquo;copy
                  link&rdquo; action.
                </li>
                <li>
                  <strong>host_permissions: &lt;all_urls&gt;</strong>:
                  required so the popup can recognize Atmosphere pages on any
                  domain (Bluesky, Leaflet, Blacksky, PDSls, custom waypoints
                  you define, etc.), so <code>declarativeNetRequest</code>{' '}
                  rules can match those domains, and so the two content
                  scripts described above can run on the active tab when
                  needed. The scripts only read the limited page surfaces
                  listed in Section&nbsp;2 and never transmit page contents
                  off-device.
                </li>
              </ul>
            </section>

            <section>
              <h2>5. What the extension does not do</h2>
              <ul>
                <li>
                  It does not collect or transmit personal information to
                  Aturi.
                </li>
                <li>It does not use cookies or any tracking technology.</li>
                <li>
                  It does not run analytics, telemetry, crash reporting, or
                  A/B testing.
                </li>
                <li>
                  It does not load or execute remotely hosted code. All
                  executable code is bundled in the released extension
                  package and reviewed by the browser store.
                </li>
                <li>
                  It does not modify the contents of pages you visit, inject
                  user-facing UI into pages, intercept form input, or read
                  page content beyond the specific surfaces described in
                  Section&nbsp;2.
                </li>
                <li>It does not show ads or include any advertising SDKs.</li>
                <li>
                  It does not sell, rent, share, or trade any data with third
                  parties.
                </li>
              </ul>
            </section>

            <section>
              <h2>6. Third-party destinations and services</h2>
              <p>
                When you click a waypoint or follow an auto-redirected link,
                your browser navigates to a third-party Atmosphere client
                (Bluesky, Blacksky, Leaflet, Tangled, Margin, Grain, PDSls,
                atp.tools, etc.) or a custom waypoint you defined. When you
                use the Inspect tab, your browser makes the lookups described
                in Section&nbsp;3 directly to the Bluesky AppView, the PLC
                directory, Constellation, and the relevant Personal Data
                Server. Each of these services has its own privacy policy
                and terms of service, and Aturi has no control over them.
              </p>
            </section>

            <section>
              <h2>7. Children&rsquo;s privacy</h2>
              <p>
                The extension is a general-purpose link-routing and
                inspection utility and is not directed at children. Because
                it does not collect any personal information, it does not
                knowingly collect data from children under 13.
              </p>
            </section>

            <section>
              <h2>8. Data retention and deletion</h2>
              <p>
                Settings persist in your browser&rsquo;s extension storage for
                as long as the extension is installed. You can:
              </p>
              <ul>
                <li>
                  Clear the recents list at any time from the History tab in
                  the options page.
                </li>
                <li>
                  Disable history tracking entirely from the History tab.
                </li>
                <li>
                  Remove all extension data by uninstalling the extension.
                  Your browser may also remove any synced copy via its own
                  sync settings.
                </li>
              </ul>
            </section>

            <section>
              <h2>9. Open source</h2>
              <p>
                Aturi is open source under GPL v3. You can audit the
                extension&rsquo;s source code, including every network request
                it makes, at{' '}
                <a
                  href="https://github.com/atpota-to/aturi"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/atpota-to/aturi
                </a>
                .
              </p>
            </section>

            <section>
              <h2>10. Changes to this policy</h2>
              <p>
                This policy may be updated as the extension evolves. Changes
                will be reflected on this page with a new &ldquo;Last
                updated&rdquo; date. Material changes (for example, the
                addition of any new outbound network request) will also be
                noted in the extension&rsquo;s release notes.
              </p>
              <h3>Contact</h3>
              <p>
                Questions or concerns? File an issue at{' '}
                <a
                  href="https://github.com/atpota-to/aturi/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  github.com/atpota-to/aturi/issues
                </a>{' '}
                or contact{' '}
                <a
                  href="https://bsky.app/profile/atpota.to"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  @atpota.to
                </a>
                .
              </p>
            </section>
          </article>
        </div>
      </div>
    </>
  );
}
