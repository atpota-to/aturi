import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import Header from '@/components/Header';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.extensionPrivacy' });
  return {
    title: t('title'),
    description: t('description'),
  };
}

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
    <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
      <Header simple />

      <header style={{ marginBottom: '3rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Browser Extension Privacy Policy
        </h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
          Last updated: May 6, 2026
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
              The Aturi browser extension does not collect, transmit, or sell
              any personal data. It has no analytics, no telemetry, no
              tracking, no advertising, and no remote code. Everything you
              configure stays in your own browser.
            </p>
            <p style={paragraph}>
              The only network request the extension ever makes is an
              anonymous lookup to the public Bluesky AppView, and only when
              you actively open a waypoint that requires a Decentralized
              Identifier (DID) for the handle in the URL.
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
              No part of this data is sent to Aturi, the developer, or any
              third party. If you are signed into your browser and have
              extension sync enabled, your browser vendor (Google, Mozilla,
              Apple, etc.) may sync this data across your devices through
              their own infrastructure under their own privacy policy. Aturi
              has no access to that synced data.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>2. Network requests</h2>
            <p style={paragraph}>
              The extension makes a single kind of network request:
            </p>
            <ul style={list}>
              <li>
                <strong>Handle resolution.</strong> When you open the popup
                on an Atmosphere page whose URL contains a handle (e.g.{' '}
                <code>example.bsky.social</code>) and you click a waypoint
                that requires a DID, the extension calls{' '}
                <code>
                  https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle
                </code>{' '}
                to convert the handle to a DID. The handle is sent as a
                query parameter; nothing else is sent. This call is made by
                your browser directly to Bluesky&rsquo;s public AppView.
                Bluesky&rsquo;s privacy policy applies to that request.
              </li>
            </ul>
            <p style={paragraph}>
              Auto-redirects do not make network requests. They are
              implemented with{' '}
              <code>chrome.declarativeNetRequest</code>, which lets the
              browser rewrite URLs locally based on static rules the
              extension generates from your preferences. The extension does
              not see, read, or log the URLs you visit while redirects run.
            </p>
            <p style={paragraph}>
              The extension never contacts <code>aturi.to</code> or any
              Aturi-operated server during normal use.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>3. Permissions and why they&rsquo;re needed</h2>
            <ul style={list}>
              <li>
                <strong>storage</strong> &mdash; to persist your preferences,
                custom waypoints, and recents list.
              </li>
              <li>
                <strong>tabs</strong> &mdash; to read the URL of the current
                tab when you open the popup, so the extension can offer
                waypoints that match the page you&rsquo;re on.
              </li>
              <li>
                <strong>declarativeNetRequest</strong> &mdash; to perform
                local URL redirects without exposing your browsing history
                to the extension.
              </li>
              <li>
                <strong>clipboardWrite</strong> &mdash; to copy universal
                Aturi links to your clipboard when you use the &ldquo;copy
                link&rdquo; action.
              </li>
              <li>
                <strong>host_permissions: &lt;all_urls&gt;</strong> &mdash;
                required so the popup can recognize Atmosphere pages on any
                domain (Bluesky, Leaflet, Blacksky, PDSls, custom waypoints
                you define, etc.) and so declarativeNetRequest rules can
                match those domains. The extension does not inject content
                scripts and does not read or modify page contents.
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>4. What the extension does not do</h2>
            <ul style={list}>
              <li>It does not collect or transmit personal information.</li>
              <li>It does not use cookies or any tracking technology.</li>
              <li>
                It does not run analytics, telemetry, crash reporting, or
                A/B testing.
              </li>
              <li>
                It does not load or execute remotely hosted code. All
                executable code is bundled in the released extension package
                and reviewed by the browser store.
              </li>
              <li>
                It does not read, modify, or send the contents of pages you
                visit.
              </li>
              <li>It does not show ads or include any advertising SDKs.</li>
              <li>
                It does not sell, rent, share, or trade any data with third
                parties.
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>5. Third-party destinations</h2>
            <p style={paragraph}>
              When you click a waypoint or follow an auto-redirected link,
              your browser navigates to a third-party Atmosphere client
              (Bluesky, Blacksky, Leaflet, etc.) or a custom waypoint you
              defined. Those services have their own privacy policies and
              terms of service, and Aturi has no control over them.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>6. Children&rsquo;s privacy</h2>
            <p style={paragraph}>
              The extension is a general-purpose link-routing utility and is
              not directed at children. Because it does not collect any
              personal information, it does not knowingly collect data from
              children under 13.
            </p>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>7. Data retention and deletion</h2>
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
                Remove all extension data by uninstalling the extension.
                Your browser may also remove any synced copy via its own
                sync settings.
              </li>
            </ul>
          </section>

          <section style={{ marginBottom: '2rem' }}>
            <h2 style={sectionHeading}>8. Open source</h2>
            <p style={paragraph}>
              Aturi is open source under GPL v3. You can audit the
              extension&rsquo;s source code, including every network request
              it makes, at{' '}
              <a
                href="https://tangled.org/atpota.to/aturi"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                }}
              >
                tangled.org/atpota.to/aturi
              </a>
              .
            </p>
          </section>

          <section>
            <h2 style={sectionHeading}>9. Changes to this policy</h2>
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
                href="https://tangled.org/atpota.to/aturi/issues"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                }}
              >
                tangled.org/atpota.to/aturi/issues
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
  );
}
