import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: 'Browser Extension Privacy Policy - aturi.to',
  description:
    'Privacy policy for the Aturi browser extension. What data it stores, what permissions it uses, and why.',
};

const headingPrimary = {
  color: 'var(--text-primary)',
  fontSize: '1.125rem',
  marginTop: '1.5rem',
  marginBottom: '0.75rem',
} as const;

const sectionHeading = {
  color: 'var(--text-primary)',
  fontSize: '1.5rem',
  marginBottom: '1rem',
} as const;

const paragraph = { marginBottom: '1rem' } as const;

const list = { marginBottom: '1rem', paddingLeft: '1.5rem' } as const;

export default function ExtensionPrivacyPage() {
  return (
    <div style={{ position: 'relative', overflowX: 'clip' }}>
      {/* Header is a direct child of the page wrapper — matching the home,
          explore, profile, and account pages — so it uses its normal full
          width instead of being boxed into (and pushed down by) the narrow
          content column. */}
      <Header compact />

      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
      <header style={{ marginBottom: '3rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Browser Extension Privacy Policy
        </h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
          Last updated: August 23, 2026
        </p>
      </header>

      <div
        className="card"
        style={{ padding: '2rem', maxWidth: '48rem', margin: '0 auto' }}
      >
        <article
          style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}
        >
          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>Summary</h2>
            <p style={paragraph}>
              The Aturi browser extension has no analytics, no telemetry, no
              tracking, no advertising, and no remote code. It does not sell
              data to anyone, ever.
            </p>
            <p style={paragraph}>
              There is exactly one optional feature that involves an
              Aturi-operated server: signing in to aturi.to, which lives in
              Settings under Account. If you never use it, the extension
              contacts no Aturi server at all and stores nothing about you
              anywhere but your own browser. Section&nbsp;5 describes what
              signing in does; everything outside that section applies
              whether you sign in or not.
            </p>
            <p style={paragraph}>
              The extension reads limited information from pages you visit
              so it can offer waypoints and inspect AT URIs. Page reading
              happens entirely inside your browser; the extension never
              sends page contents anywhere &mdash; not to Aturi, and not to
              anyone else &mdash; signed in or not.
              The extension also makes anonymous lookups to public atproto
              services (Bluesky AppView, PLC directory, Constellation, and
              your chosen Personal Data Server) when you actively use the
              waypoint picker or the Inspect tab. The details of every
              network request and every part of the page that is read are
              described below.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>1. What the extension stores</h2>
            <p style={paragraph}>
              The extension saves your preferences locally using your
              browser&rsquo;s built-in extension storage (
              <code>chrome.storage.sync</code>, with a fallback to{' '}
              <code>chrome.storage.local</code> if the sync quota is
              exceeded). The data stored is limited to:
            </p>
            <ul style={list}>
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
            <p style={paragraph}>
              If you sign in (Section&nbsp;5), the extension additionally
              stores a session token and your DID. Those are kept in{' '}
              <code>browser.storage.local</code>, which is deliberately a
              different storage area from the preferences above: local
              storage never leaves your device, so the token is not uploaded
              to your browser vendor&rsquo;s sync servers.
            </p>
            <p style={paragraph}>
              No part of this data is sent to Aturi, the developer, or any
              third party. If you are signed into your browser and have
              extension sync enabled, your browser vendor (Google, Mozilla,
              Apple, etc.) may sync this data across your devices through
              their own infrastructure under their own privacy policy. Aturi
              has no access to that synced data.
            </p>
            <p style={paragraph}>
              Identity records, record previews, and backlink counts fetched
              by the Inspect tab live only in popup memory while the popup is
              open and are discarded when you close it. One exception: when
              history is enabled (the default), the extension remembers the
              repo identifiers (the DID or handle) of records it saw, so the
              &ldquo;no AT URIs on this page&rdquo; empty state can suggest
              repos you recently looked at. These identifiers are stored
              locally alongside your other preferences, are gated on the same
              History toggle as the recents list, and are removed when you
              clear or disable history.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>2. What the extension reads from pages</h2>
            <p style={paragraph}>
              The extension includes two content scripts that run on
              ordinary web pages. Both run entirely inside your browser. No
              data they read is ever sent to Aturi-operated servers; the
              extension only uses what they read to render the popup and
              Inspect tab locally.
            </p>
            <ul style={list}>
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
                <strong>Inspect scan</strong> (
                <code>inspect-scan.content.ts</code>). This script scans the
                page for AT URIs (<code>at://&hellip;</code>) in the document
                head, OpenGraph and Twitter meta tags, anchor hrefs, JSON-LD
                blocks, and a capped portion (up to about 2&nbsp;MB) of the
                page&rsquo;s visible text. It runs in two modes:
                <ul style={list}>
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
                    <strong>On demand</strong>, when you open the
                    popup&rsquo;s <strong>Inspect</strong> tab: it runs the
                    same scan and returns the URIs it found, deduplicated,
                    along with a short surrounding text snippet for context.
                  </li>
                </ul>
                In both modes the scan stays inside your browser and never
                transmits page content to Aturi-operated servers.
              </li>
            </ul>
            <p style={paragraph}>
              Neither script injects content into pages you visit, modifies
              the DOM, intercepts form input, executes remote code, or
              participates in any cross-origin tracking. You can disable
              them entirely by uninstalling the extension or, on most
              browsers, by revoking host permissions for specific sites in
              the extension settings page.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>3. Network requests</h2>
            <p style={paragraph}>
              The extension makes a small number of well-defined network
              requests, each tied to a specific user action. None of these
              requests go to Aturi-operated servers; they go directly from
              your browser to the relevant public atproto service, whose
              own privacy policy applies.
            </p>
            <ul style={list}>
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
            <p style={paragraph}>
              <strong>Auto-redirects do not make network requests.</strong>{' '}
              They are implemented with{' '}
              <code>chrome.declarativeNetRequest</code>, which lets the
              browser rewrite URLs locally based on static rules the
              extension generates from your preferences. The extension does
              not see, read, or log the URLs you visit while redirects run.
            </p>
            <p style={paragraph}>
              Apart from the optional sign-in described in
              Section&nbsp;5, the extension does not contact{' '}
              <code>aturi.to</code> or any other Aturi-operated server.
              Browsing, redirecting, the waypoint picker and the Inspect tab
              never do, whether or not you are signed in.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>4. Permissions and why they&rsquo;re needed</h2>
            <ul style={list}>
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
                <strong>identity</strong>: used by one optional feature and
                nothing else &mdash; signing in to aturi.to from the
                Settings page. It opens a browser-managed authorization
                window; the extension never sees your password, and this
                permission grants it no access to your browser profile or
                your identity in any other browser.
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

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>5. Signing in (optional)</h2>
            <p style={paragraph}>
              The extension can sign in to aturi.to. This is off by default,
              requires you to enter your handle in Settings &rarr; Account,
              and can be undone at any time with Sign out. Nothing else in
              the extension changes based on whether you are signed in.
            </p>
            <p style={paragraph}>
              <strong>What it is for.</strong> The website lets you build
              waypoint groups and custom waypoints and stores them as a
              record in your own atproto repository. Signing in lets the
              extension read that record so you do not have to recreate the
              same setup twice.
            </p>
            <p style={paragraph}>
              <strong>What access it asks for.</strong> Read-only. The grant
              the extension requests cannot create, update or delete
              anything in your repository, and cannot upload files. This is
              a narrower grant than the website asks for.
            </p>
            <p style={paragraph}>
              <strong>What is transmitted, and to whom:</strong>
            </p>
            <ul style={list}>
              <li>
                When you sign in, the handle you typed goes to aturi.to,
                which starts a standard atproto OAuth flow. Your browser
                then opens your own PDS&rsquo;s consent screen in a window
                the browser manages. Your password is entered there, on your
                PDS, and is never visible to the extension or to Aturi.
              </li>
              <li>
                After you approve, aturi.to&rsquo;s server holds the
                resulting atproto tokens &mdash; encrypted &mdash; and hands
                the extension only an opaque session token, which is not an
                atproto credential and cannot be used against your PDS by
                anything but aturi.to. The extension stores that token on
                your device, in local extension storage, which never syncs
                to your browser vendor.
              </li>
              <li>
                When you use &ldquo;Import waypoint settings&rdquo;, the
                extension asks aturi.to to read one record from your
                repository (<code>to.aturi.actor.preferences</code>) and
                return it. aturi.to relays that request to your PDS and does
                not retain the result.
              </li>
            </ul>
            <p style={paragraph}>
              <strong>What aturi.to stores while you are signed in:</strong>{' '}
              your DID, the atproto tokens (encrypted at rest), the
              permissions you granted, your PDS address, and one row
              recording that this extension has a session, when it was
              created and when it was last used. The{' '}
              <Link href="/terms" style={{ color: 'var(--text-accent)' }}>
                aturi.to terms
              </Link>{' '}
              describe this and name the database provider.
            </p>
            <p style={paragraph}>
              <strong>How to undo it.</strong> &ldquo;Sign out&rdquo; in
              Settings &rarr; Account ends the extension&rsquo;s session and
              deletes the stored token. You can also see and end the
              extension&rsquo;s session from your account settings on
              aturi.to, and you can revoke Aturi&rsquo;s access entirely
              from your own PDS at any time.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>6. What the extension does not do</h2>
            <ul style={list}>
              <li>
                It does not collect or transmit personal information to
                Aturi, unless you sign in (Section&nbsp;5), in which case it
                transmits exactly what that section describes and nothing
                more.
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

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>7. Third-party destinations and services</h2>
            <p style={paragraph}>
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

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>8. Children&rsquo;s privacy</h2>
            <p style={paragraph}>
              The extension is a general-purpose link-routing and
              inspection utility and is not directed at children. It does not
              knowingly collect data from children under 13. Unless you sign
              in (Section&nbsp;5), it collects no personal information at all.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>9. Data retention and deletion</h2>
            <p style={paragraph}>
              Settings persist in your browser&rsquo;s extension storage for
              as long as the extension is installed. You can:
            </p>
            <ul style={list}>
              <li>
                Clear the recents list at any time from the History tab in
                the options page.
              </li>
              <li>
                Disable history tracking entirely from the History tab.
              </li>
              <li>
                Sign out from Settings &rarr; Account, which deletes the
                stored session token from your device and ends the session on
                aturi.to.
              </li>
              <li>
                Remove all extension data by uninstalling the extension. Your
                browser may also remove any synced copy via its own sync
                settings. Uninstalling removes the local token; to also end
                the session on aturi.to, sign out first or revoke it from
                your account settings there.
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>10. Open source</h2>
            <p style={paragraph}>
              Aturi is open source under GPL v3. You can audit the
              extension&rsquo;s source code, including every network request
              it makes, at{' '}
              <a
                href="https://github.com/atpota-to/aturi"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                }}
              >
                github.com/atpota-to/aturi
              </a>
              .
            </p>
          </section>

          <section>
            <h2 style={sectionHeading}>11. Changes to this policy</h2>
            <p style={paragraph}>
              This policy may be updated as the extension evolves. Changes
              will be reflected on this page with a new &ldquo;Last
              updated&rdquo; date. Material changes (for example, the
              addition of any new outbound network request) will also be
              noted in the extension&rsquo;s release notes.
            </p>
            <h3 style={headingPrimary}>Contact</h3>
            <p style={paragraph}>
              Questions or concerns? File an issue at{' '}
              <a
                href="https://github.com/atpota-to/aturi/issues"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                }}
              >
                github.com/atpota-to/aturi/issues
              </a>{' '}
              or contact{' '}
              <a
                href="https://bsky.app/profile/atpota.to"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                }}
              >
                @atpota.to
              </a>
              .
            </p>
          </section>
        </article>
      </div>
      </div>
    </div>
  );
}
