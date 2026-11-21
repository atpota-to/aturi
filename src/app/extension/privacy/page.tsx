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

      {/* The article template /terms uses (content.css), so the two
          policies read as one document family. */}
      <div className="fn-c-wrap" data-width="article">
        <header className="fn-c-head">
          <h1 className="fn-c-title">Browser Extension Privacy Policy</h1>
          <p className="fn-c-meta">Last updated: November 20, 2026</p>
        </header>

        <article className="fn-c-sheet fn-prose">
          <section>
            <h2>Summary</h2>
            <p>
              The Aturi browser extension has no analytics, no telemetry, no
              tracking, no advertising, and no remote code. It does not sell
              data to anyone, ever.
            </p>
            <p>
              The extension has no sign-in and no account. It never contacts
              aturi.to or any other Aturi-operated server, and stores nothing
              about you anywhere but your own browser.
            </p>
            <p>
              The extension does, however, read limited information from
              pages you visit so it can offer waypoints and show the AT URIs
              a page carries. Page reading happens entirely inside your
              browser; the extension never sends page contents to
              Aturi-operated servers. The extension also makes anonymous
              lookups to public atproto services (Bluesky AppView, PLC
              directory, and the Personal Data Servers that hold the
              records) when you open the popup on a page with records, or
              use the waypoint picker. The details of every network request
              and every part of the page that is read are described below.
            </p>
            <p>
              There is also a Safari version for Mac, iPhone and iPad, which
              comes inside the Aturi app. It works the same way, with the
              differences noted where they apply: Safari asks you site by
              site before the extension can read a page or redirect links to
              it, and Safari keeps the extension&rsquo;s storage on your
              device.
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
                popup. You can disable this, and clear it at any time, in the
                popup section of the settings page.
              </li>
              <li>UI preferences such as compact mode and open-in-new-tab.</li>
            </ul>
            <p>
              No part of this data is sent to Aturi, the developer, or any
              third party. If you are signed into your browser and have
              extension sync enabled, your browser vendor (Google, Mozilla,
              etc.) may sync this data across your devices through their own
              infrastructure under their own privacy policy. Aturi has no
              access to that synced data. Safari does not sync extension
              storage: in Safari, all of the above stays on the device where
              you set it, and Apple does not sync it to your other devices.
            </p>
            <p>
              Identity records and record previews fetched for the
              popup&rsquo;s record card live only in popup memory while the
              popup is open and are discarded when you close it. One
              exception: when history is enabled (the default), the
              extension keeps a &ldquo;Seen lately&rdquo; list of the
              accounts whose records it saw on pages where you opened the
              popup, so the popup can suggest them when you look something
              up. Each entry holds the account&rsquo;s DID, handle and PDS
              host, how many pages it turned up on, and a one-way hash of the
              last page counted (never the page&rsquo;s address). The list is
              capped at 50 accounts, stored only in this browser&rsquo;s
              local extension storage (it is not synced), gated on the same
              toggle as the recents list, and removed when you clear or
              disable history.
            </p>
            <p>
              A second exception: when &ldquo;Detect active apps&rdquo; is on
              (the default), the extension caches which collections an
              account&rsquo;s repository has, so the popup can mark the apps
              that account uses. Each entry holds the account&rsquo;s DID,
              its collection names and when they were fetched. The cache
              keeps at most 50 accounts, refetches an entry after an hour,
              and is stored only in this browser&rsquo;s local extension
              storage. The history controls do not clear it; it goes away
              when you remove the extension.
            </p>
          </section>

          <section>
            <h2>2. What the extension reads from pages</h2>
            <p>
              The extension includes two content scripts that run on
              ordinary web pages. Both run entirely inside your browser. No
              data they read is ever sent to Aturi-operated servers; the
              extension only uses what they read to render the popup
              locally.
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
                <strong>Page scan</strong> (
                <code>inspect-scan.content.ts</code>). This script scans the
                page for AT URIs (<code>at://&hellip;</code>) in the document
                head, OpenGraph and Twitter meta tags, anchor hrefs, JSON-LD
                blocks, and a capped portion (up to about 2&nbsp;MB) of the
                page&rsquo;s visible text. It runs in two modes:
                <ul>
                  <li>
                    <strong>Passively</strong>, when the
                    &ldquo;highlight Atmosphere pages&rdquo; badge is enabled
                    (the default): on each page load and SPA route change it
                    runs the scan and reports only the <em>count</em> of AT
                    URIs it found to the extension&rsquo;s own background
                    worker, which drives the toolbar badge and icon. No page
                    content leaves the page, only a number. You can turn this
                    off with the passive-scan toggle in the options page,
                    after which the script stays idle until you ask for a scan.
                  </li>
                  <li>
                    <strong>On demand</strong>, when you open the popup: it
                    runs the same scan and returns the URIs it found,
                    deduplicated, along with a short surrounding text
                    snippet for context, so the popup can show each record
                    the page carries as a tab on its record card.
                  </li>
                </ul>
                In both modes the scan stays inside your browser and never
                transmits page content to Aturi-operated servers.
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
            <p>
              In Safari, neither script runs on a site until you allow Aturi
              there (Section&nbsp;4). On a site you have not allowed, they
              run only in a tab where you open Aturi&rsquo;s popup, which
              gives the extension access to that tab. So in Safari the
              passive scan, and the toolbar badge it drives, happen only on
              sites you have allowed and in tabs where you have opened the
              popup. You can withdraw a site&rsquo;s access at any time in
              Safari&rsquo;s extension settings.
            </p>
          </section>

          <section>
            <h2>3. Network requests</h2>
            <p>
              The extension makes a small number of well-defined network
              requests, each tied to a specific user action. None of these
              requests go to Aturi-operated servers. The atproto lookups
              below go directly from your browser to the relevant public
              atproto service, and the font request to Google; each
              service&rsquo;s own privacy policy applies.
            </p>
            <ul>
              <li>
                <strong>Fonts.</strong> The popup and the settings page load
                the Figtree and IBM Plex Mono typefaces from Google Fonts
                (<code>fonts.googleapis.com</code> and{' '}
                <code>fonts.gstatic.com</code>) each time they open. Google
                receives an ordinary font request from your browser, with
                your IP address and user agent. No page content or account
                data is sent.
              </li>
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
                <strong>Record card: identity resolution.</strong> When you
                open the popup on a page with AT URIs, the extension
                resolves the repo identifier of the page&rsquo;s own record,
                and of each other record on the page, through the same
                Bluesky AppView. For <code>did:plc:&hellip;</code>{' '}
                identifiers it may fetch the DID document from the PLC
                directory (<code>plc.directory</code>), and for{' '}
                <code>did:web:&hellip;</code> identifiers it fetches the DID
                document from the <code>/.well-known/did.json</code>{' '}
                endpoint of the host named in the DID, to discover the
                account&rsquo;s handle (which labels the record&rsquo;s tab)
                and its PDS host.
              </li>
              <li>
                <strong>Record card: repository description.</strong> For
                the record whose tab is open, the extension calls{' '}
                <code>com.atproto.repo.describeRepo</code> on the resolved
                PDS host, which returns the account&rsquo;s handle and
                collections. If that call fails, it asks the same PDS for
                the repository&rsquo;s status (
                <code>com.atproto.sync.getRepoStatus</code>) to tell whether
                the account is inactive.
              </li>
              <li>
                <strong>Record card: record fetch.</strong> Once the PDS
                host is known, the extension calls{' '}
                <code>com.atproto.repo.getRecord</code> on that PDS to fetch
                the open record itself, for its CID (one of the identifiers
                the Copy list offers) and, for a record the page references,
                a short preview.
              </li>
            </ul>
            <p>
              <strong>Auto-redirects do not make network requests.</strong>{' '}
              They are implemented with{' '}
              <code>chrome.declarativeNetRequest</code>, which lets the
              browser rewrite URLs locally based on static rules the
              extension generates from your preferences. The extension does
              not see, read, or log the URLs you visit while redirects run.
              In Safari, the browser applies a redirect only to a link that
              points to a site you have allowed Aturi to access; links to
              other sites load as they are.
            </p>
            <p>
              The extension does not contact <code>aturi.to</code> or any
              other Aturi-operated server. Browsing, redirecting, the
              waypoint picker and the popup&rsquo;s record card never do.
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
                <strong>tabs</strong>: to read the URL and the tab id of
                the current tab when you open the popup, so the extension
                can offer waypoints that match the page you&rsquo;re on and
                route the page scan request to the right tab. In Safari,
                this shows the extension a tab&rsquo;s address only on sites
                you have allowed, or in the tab where you opened the popup.
              </li>
              <li>
                <strong>declarativeNetRequest</strong>: to perform
                local URL redirects without exposing your browsing history
                to the extension.
              </li>
              <li>
                <strong>declarativeNetRequestWithHostAccess</strong> (Safari
                only): Safari applies a redirect rule only when the extension
                has this permission and you have allowed the site the link
                points to. It gives the extension no access to any site
                beyond what you allow.
              </li>
              <li>
                <strong>activeTab</strong> (Safari only): when you open
                Aturi&rsquo;s popup, Safari gives the extension temporary
                access to the tab you are on, so the popup can read its
                address and the two content scripts in Section&nbsp;2 can run
                there, even on a site you have not allowed. It covers that
                tab only.
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
                off-device. Safari does not grant this at install. It asks
                you site by site, and you can allow a site once, for one day,
                always, or allow every website. Until you allow a site, the
                extension cannot see that page&rsquo;s address, the content
                scripts do not run there (except in a tab where you open the
                popup), and links to that site are not redirected. A one-day
                grant runs out, and redirects of links to that site stop with
                it. You can change or withdraw any of these in Safari&rsquo;s
                extension settings.
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
                package and reviewed by the store that distributes it (for
                Safari, the App Store).
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
              atp.tools, etc.) or a custom waypoint you defined. When the
              popup shows a page&rsquo;s records, your browser makes the
              lookups described in Section&nbsp;3 directly to the Bluesky
              AppView, the PLC directory, and the relevant Personal Data
              Server, and the popup and settings page load their fonts from
              Google Fonts. Each of these services has its own privacy
              policy and terms of service, and Aturi has no control over
              them.
            </p>
          </section>

          <section>
            <h2>7. Children&rsquo;s privacy</h2>
            <p>
              The extension is a general-purpose link-routing and
              inspection utility and is not directed at children. It does not
              knowingly collect data from children under 13. It collects no
              personal information at all.
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
                Clear the Recents and Seen lately lists at any time from the
                popup section of the settings page.
              </li>
              <li>
                Disable history tracking entirely from the same section,
                which also removes the Seen lately list.
              </li>
              <li>
                Remove all extension data by uninstalling the extension. Your
                browser may also remove any synced copy via its own sync
                settings. In Safari, the extension comes with the Aturi app;
                to uninstall it, delete the app.
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
    </>
  );
}
