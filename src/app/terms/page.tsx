import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';

export const metadata: Metadata = {
  title: 'Terms & Privacy Policy - aturi.to',
  description:
    'Terms of service and privacy policy for aturi.to and its associated products, public APIs, and the Aturi browser extension.',
};

const CONTACT_EMAIL = 'contact@aturi.to';
// GitHub is the primary repository; tangled.org/atpota.to/aturi mirrors it.
const REPO_URL = 'https://github.com/atpota-to/aturi';
const ISSUES_URL = 'https://github.com/atpota-to/aturi/issues';
const BSKY_PROFILE_URL = 'https://bsky.app/profile/atpota.to';
const EXTENSION_PRIVACY_URL = '/extension/privacy';

const sectionHeading = {
  color: 'var(--text-primary)',
  fontSize: '1.5rem',
  marginBottom: '1rem',
} as const;

const subHeading = {
  color: 'var(--text-primary)',
  fontSize: '1.125rem',
  marginTop: '1.5rem',
  marginBottom: '0.75rem',
} as const;

const paragraph = { marginBottom: '1rem' } as const;

const list = { marginBottom: '1rem', paddingLeft: '1.5rem' } as const;

const allCapsParagraph = {
  marginBottom: '1rem',
  textTransform: 'uppercase' as const,
  fontSize: '0.85rem',
  letterSpacing: '0.02em',
  lineHeight: 1.7,
};

const linkStyle = {
  color: 'var(--text-accent)',
  textDecoration: 'none',
} as const;

export default function TermsPage() {
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
          Terms of Service & Privacy Policy
        </h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
          Last updated: August 27, 2026
        </p>
      </header>

      {/* Content */}
      <div
        className="card"
        style={{
          padding: '2rem',
          maxWidth: '48rem',
          margin: '0 auto',
        }}
      >
        <article
          style={{
            color: 'var(--text-secondary)',
            lineHeight: '1.7',
          }}
        >
          {/* Overview */}
          <section style={{ marginBottom: '3rem' }}>
            <h2 style={sectionHeading}>Overview</h2>
            <p style={paragraph}>
              aturi.to (&ldquo;<strong>Aturi</strong>,&rdquo; &ldquo;
              <strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo; or
              &ldquo;<strong>our</strong>&rdquo;) is a free, open-source
              ecosystem of tools for navigating the Atmosphere: the
              federated network of services built on the AT Protocol
              (atproto). These Terms of Service and Privacy Policy (together,
              this &ldquo;<strong>Agreement</strong>&rdquo;) govern your use
              of all Aturi products, including:
            </p>
            <ul style={list}>
              <li>
                The <strong>aturi.to web app</strong>, including the universal
                link router, profile and record landing pages, and OpenGraph
                image generation.
              </li>
              <li>
                Our <strong>public APIs and machine-readable endpoints</strong>,
                including the Resolve API, oEmbed metadata, and the{' '}
                <Link href="/mcp" style={linkStyle}>
                  Atmosphere MCP server
                </Link>{' '}
                (a Model Context Protocol endpoint that lets AI assistants and
                other tools read public Atmosphere data). These endpoints may
                be called directly or through third-party software such as
                share sheets, shortcuts, scripts, or AI assistants and
                agents. When a tool accesses the Service on your behalf or at
                your direction, that access is your use of the Service and
                this Agreement applies to it.
              </li>
              <li>
                The <strong>Atmosphere Explorer</strong> (the &ldquo;Explore&rdquo;
                feature), which lets visitors browse public repository data,
                identity history, collections, live commit activity,
                backlinks, and related aggregates for any account on the
                Atmosphere, using the third-party services described in
                Section 6 of the Terms.
              </li>
              <li>
                The <strong>Record Editor</strong> and other authenticated
                features that allow you, after signing in, to create, read,
                update, or delete records and upload blobs in your own atproto
                repository.
              </li>
              <li>
                <strong>Sign in with atproto</strong> (OAuth) and{' '}
                <strong>preference sync</strong> via your Personal Data Server
                (&ldquo;<strong>PDS</strong>&rdquo;). When you sign in, you can
                personalize the Service by reordering, hiding, grouping,
                renaming, pinning, and starring waypoints, adding your own
                custom waypoints, and storing other non-sensitive UI choices.
                These preferences are written to a record in your own atproto
                repository so they follow you across devices and clients. Any
                other authenticated functionality offered through aturi.to is
                also covered.
              </li>
              <li>
                The <strong>Aturi browser extension</strong> for Chrome,
                Firefox, Safari, and other supported browsers, including its
                detection, Inspect, auto-redirect, and waypoint-jump features.
                The extension is also governed by its dedicated{' '}
                <Link href={EXTENSION_PRIVACY_URL} style={linkStyle}>
                  Extension Privacy Policy
                </Link>
                , which controls in case of any conflict with this Agreement.
              </li>
              <li>
                Any other websites, APIs, integrations, share-sheet endpoints,
                Apple Shortcuts, or related features we make available under
                the aturi.to brand (collectively with the items above, the
                &ldquo;<strong>Service</strong>&rdquo;).
              </li>
            </ul>
            <p style={paragraph}>
              By accessing or using any part of the Service, you agree to be
              bound by this Agreement. If you do not agree, do not use the
              Service. If you are using the Service on behalf of an entity,
              you represent that you have authority to bind that entity, and
              &ldquo;you&rdquo; refers to that entity.
            </p>
            <p style={paragraph}>
              The Service is provided free of charge. We may add, change, or
              remove features at any time and without notice.
            </p>
          </section>

          {/* Terms of Service */}
          <section style={{ marginBottom: '3rem' }}>
            <h2 style={sectionHeading}>Terms of Service</h2>

            <h3 style={subHeading}>1. Eligibility</h3>
            <p style={paragraph}>
              You must be at least 13 years of age (or the minimum age of
              digital consent in your jurisdiction, if higher) to use the
              Service. By using the Service, you represent and warrant that
              (a) you meet this age requirement, (b) you have the legal
              capacity to enter into this Agreement, and (c) your use of the
              Service does not violate any applicable law or regulation, any
              order of any court or government authority, or any agreement
              you have with a third party.
            </p>

            <h3 style={subHeading}>2. The Service</h3>
            <p style={paragraph}>
              Aturi is, in substance, a routing and inspection layer over
              public data and identities that already exist on the Atmosphere.
              You should understand the following before using it:
            </p>
            <ul style={list}>
              <li>
                <strong>Universal link routing.</strong> aturi.to URLs resolve
                to a landing page that lets the recipient pick which
                third-party Atmosphere client they want to use to view a
                profile, post, list, or other public record. We do not host,
                store, modify, or curate the underlying content.
              </li>
              <li>
                <strong>Explore.</strong> The Atmosphere Explorer renders
                public repository data, identity history, backlinks, live
                commit activity, and related aggregates fetched on demand
                from the public atproto services and third-party indexes
                described in Section 6. Aturi does not warehouse this data;
                we display what those upstream services return, when you
                request it. Those services are operated by others and may be
                unavailable, rate-limited, or removed at any time.
              </li>
              <li>
                <strong>Record Editor and authenticated actions.</strong> When
                you sign in with atproto OAuth and grant write scopes,
                authenticated actions (create, update, delete records;
                upload blobs) are performed by your browser directly against
                your PDS using your DPoP-bound access tokens. Aturi acts as a
                client interface; the resulting data lives in your repository
                on your PDS, not on our servers. You are solely responsible
                for any record you create, modify, or delete through the
                Service, including the consequences of deletion (such as
                broken references, lost engagement metadata, or removal of
                content others have linked to).
              </li>
              <li>
                <strong>Preference sync and personalization.</strong> If you
                sign in, the Service may store non-sensitive preferences,
                including waypoint groups (name and order), per-group
                waypoint ordering, hidden/visible/pinned waypoints, custom
                waypoints you have defined (display name, domain, URL
                templates, supported record types), and other UI choices,
                as a record in your own PDS (identified in Section 1 of the
                Privacy Policy). The authoritative copy lives in your
                repository, under your control. A local copy is kept in your
                browser&rsquo;s storage for fast access and to support
                anonymous use. You can delete the preferences record at any
                time using the Service or any other atproto client. We do not
                maintain a separate copy.
              </li>
              <li>
                <strong>Public APIs.</strong> Aturi exposes public, read-only
                APIs: a Resolve API and oEmbed endpoint that accept an
                HTTP(S) URL or AT URI and return structured metadata, and
                the Atmosphere MCP server, which lets AI assistants and
                other tools run the same kinds of public-data lookups the
                site offers. To detect AT URIs in HTML pages, the Resolve
                API may fetch a limited portion of the page over standard
                HTTP(S) using a clearly identified user agent. API responses
                are assembled from public network data at request time and
                are not verified by Aturi; confirm anything important
                against the source before relying on it.
              </li>
              <li>
                <strong>Browser extension.</strong> The browser extension is
                distributed through official browser web stores. Its
                features, data handling, network requests, and permissions
                are described in the{' '}
                <Link href={EXTENSION_PRIVACY_URL} style={linkStyle}>
                  Extension Privacy Policy
                </Link>
                , which controls for the extension. The extension does not
                transmit data to Aturi-operated servers in normal use.
              </li>
            </ul>
            <p style={paragraph}>
              Atmosphere data is, by its nature, public. Records you publish
              to the AT Protocol are visible to anyone with access to your
              PDS or the relevant AppView, regardless of whether you use
              Aturi.
            </p>

            <h3 style={subHeading}>3. Your account and authentication</h3>
            <p style={paragraph}>
              Aturi authentication is performed entirely through standard
              atproto OAuth. We do not operate an identity provider, do not
              issue or store passwords, and do not maintain a centralized
              user account database. Your atproto identity is administered
              by your PDS host and any associated identity authority. Your
              continued ability to sign in depends on those upstream
              providers.
            </p>
            <p style={paragraph}>
              When you sign in:
            </p>
            <ul style={list}>
              <li>
                You authorize Aturi to act as an OAuth client against your
                PDS within the scopes you grant at the consent screen
                (e.g., create, update, delete records; upload blobs). Reads
                of records in your own repository are public and are not
                gated by a scope.
              </li>
              <li>
                Access and refresh tokens are bound to a DPoP key generated
                in your browser, stored in your browser&rsquo;s local
                storage (e.g., IndexedDB), and not sent to Aturi
                servers. Signing out from the Service removes the local
                session from your browser; it does not revoke tokens
                upstream. You can revoke tokens at any time through your
                PDS.
              </li>
              <li>
                You are responsible for safeguarding your atproto credentials
                and the device(s) where you sign in. Any action taken
                through a signed-in session is your action, including
                creating, modifying, or deleting records in your repository.
              </li>
              <li>
                We may decline to authenticate any request, end any session,
                or refuse to service any OAuth client interaction at our
                sole discretion, including to protect the Service or comply
                with applicable law.
              </li>
            </ul>

            <h3 style={subHeading}>4. Your content and your repository</h3>
            <p style={paragraph}>
              The Service does not host user content. When you create,
              update, or delete records or upload blobs while signed in, you
              are doing so against your own atproto repository on your own
              PDS. You retain all right, title, and interest in and to your
              content, subject to the protocols, terms, and policies of the
              PDS, AppView, and downstream services that store and propagate
              it.
            </p>
            <p style={paragraph}>
              You represent and warrant that:
            </p>
            <ul style={list}>
              <li>
                You have all rights necessary to create, modify, and publish
                any content you operate on through the Service.
              </li>
              <li>
                Your content and your use of the Service do not infringe,
                misappropriate, or violate any third party&rsquo;s
                intellectual property, privacy, publicity, contract, or
                other rights, and do not violate any applicable law.
              </li>
              <li>
                You understand that records published via the AT Protocol
                are public, may be replicated by third parties (including
                AppViews, relays, mirrors, and archives), and that deleting
                a record from your PDS does not guarantee deletion from
                those third parties.
              </li>
            </ul>
            <p style={paragraph}>
              To the extent any content you create or modify through the
              Service is processed by or briefly transits Aturi
              infrastructure in the course of operating the Service (for
              example, parsing or rendering inside your browser), you grant
              Aturi a worldwide, non-exclusive, royalty-free license to
              perform such processing solely for the purpose of providing
              the Service to you. No other license is granted.
            </p>

            <h3 style={subHeading}>5. Acceptable use</h3>
            <p style={paragraph}>You agree that you will not, and will not attempt to:</p>
            <ul style={list}>
              <li>Violate any applicable law, regulation, or court order;</li>
              <li>
                Use the Service to harass, threaten, defame, dox, stalk, or
                otherwise harm any person, or to incite or facilitate
                violence;
              </li>
              <li>
                Create, modify, distribute, or share content that is
                illegal, including content that sexually exploits or
                endangers minors, infringes intellectual property, or
                violates export control or sanctions law;
              </li>
              <li>
                Use the Service to send unsolicited bulk communications,
                spam, phishing, malware, ransomware, scams, or fraudulent
                content;
              </li>
              <li>
                Probe, scan, overload, disrupt, degrade, or test the
                vulnerability of the Service or its infrastructure, or
                attempt to bypass any rate limits, throttling, abuse
                protections, authentication, or security mechanism;
              </li>
              <li>
                Access the Service, or any account or repository, using
                automated means (including scripts, bots, and AI agents) in
                a manner that imposes a disproportionate load, or that is
                not consistent with this Agreement;
              </li>
              <li>
                Use the Service as a backend for bulk data harvesting, use
                it to evade the rate limits, blocks, or terms of the
                upstream services it queries, or resell or rebrand access
                to the hosted Service;
              </li>
              <li>
                Reverse engineer, decompile, or disassemble any portion of
                the Service except to the extent that activity is expressly
                permitted by applicable law or by the open-source license
                governing our code;
              </li>
              <li>
                Impersonate any person or entity, misrepresent your
                affiliation, or misrepresent the origin of any record or
                link;
              </li>
              <li>
                Use the Service to redirect to, or otherwise route traffic
                to, malicious, deceptive, or unlawful destinations;
              </li>
              <li>
                Use the Service in any way that could damage, disable, or
                impair the Service, the rights of other users, or the
                broader atproto ecosystem.
              </li>
            </ul>
            <p style={paragraph}>
              We may investigate suspected violations, cooperate with law
              enforcement, and take any action we deem appropriate,
              including blocking IP addresses, refusing service to specific
              identities, removing or rejecting links, suspending OAuth
              sessions, or terminating access entirely, in each case without
              notice and at our sole discretion.
            </p>

            <h3 style={subHeading}>6. Third-party services and destinations</h3>
            <p style={paragraph}>
              The Service interoperates with and routes to third-party
              services that we do not control, including without limitation:
            </p>
            <ul style={list}>
              <li>
                <strong>Public atproto network services</strong>: your PDS
                and identity authority, other PDSes, relays, AppViews (such
                as the Bluesky AppView), and the PLC directory, used for
                authentication, identity resolution, and repository reads
                and writes.
              </li>
              <li>
                <strong>
                  Third-party index, aggregation, streaming, and
                  documentation services
                </strong>{' '}
                queried to answer requests: for example, backlink indexes,
                reputation and lexicon-activity services, Jetstream relays
                for live commit streams, public DNS resolvers, and protocol
                documentation hosted on third-party platforms. Depending on
                the feature, these are contacted by your browser directly
                or by our servers on your behalf; standard connection
                metadata (IP address, user agent) is visible to any service
                your browser contacts directly.
              </li>
              <li>
                <strong>Third-party Atmosphere clients and waypoints</strong>,
                including custom waypoints you define: the destinations you
                (or your recipients) choose to open links in.
              </li>
              <li>
                <strong>Vercel</strong>: hosting, edge runtime, and
                anonymous analytics.
              </li>
              <li>
                <strong>Browser web stores and operating-system vendors</strong>{' '}
                that distribute the extension and may, depending on your
                settings, sync extension storage across your devices.
              </li>
              <li>
                <strong>Third-party software you use to reach the Service</strong>,
                including browsers, share sheets, shortcuts, and AI
                assistants or agents connected to our MCP endpoint. These
                tools are services of their operators, not of Aturi.
              </li>
            </ul>
            <p style={paragraph}>
              Your use of any third-party service is governed by that
              service&rsquo;s own terms and privacy policy. The specific
              third-party services the Service queries may change at any
              time without notice. Aturi makes no representations or
              warranties about any third-party service and is not
              responsible for any third-party content, conduct, or
              practices, including how a third party handles data we hand
              off to it when you click a waypoint, follow a redirect, sign
              in, or call an API.
            </p>

            <h3 style={subHeading}>7. Open source and intellectual property</h3>
            <p style={paragraph}>
              The Aturi source code is licensed under the GNU General Public
              License version 3 or later. You may inspect, fork, modify, and
              redistribute the source code subject to that license. The
              license to the source code is separate from this Agreement;
              this Agreement governs only your use of the hosted Service we
              operate at aturi.to.
            </p>
            <p style={paragraph}>
              All rights, title, and interest in and to the Service,
              including all related intellectual property rights, are and
              will remain the exclusive property of Aturi and its
              contributors. Nothing in this Agreement transfers any such
              rights to you, except the limited, revocable, non-exclusive,
              non-transferable license to access and use the Service in
              accordance with this Agreement.
            </p>
            <p style={paragraph}>
              The names &ldquo;aturi&rdquo; and &ldquo;aturi.to&rdquo; and
              any associated logos or marks are the property of their owner
              and may not be used to imply endorsement of, or affiliation
              with, any third-party fork, product, or service without prior
              written permission. Forks must comply with the attribution and
              licensing terms set out in the source repository.
            </p>

            <h3 style={subHeading}>8. Copyright and DMCA-style notices</h3>
            <p style={paragraph}>
              Because Aturi does not host atproto content and acts only as a
              client and router, takedown requests for underlying records
              must be directed to the operator of the PDS, AppView, or other
              service that hosts or surfaces the record in question. If you
              believe a routing link or rendered page on aturi.to itself
              infringes your rights, you may send a notice to{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
                {CONTACT_EMAIL}
              </a>{' '}
              that includes (i) identification of the work, (ii)
              identification of the aturi.to URL at issue, (iii) your
              contact information, (iv) a statement that you have a
              good-faith belief that the use is not authorized, (v) a
              statement, under penalty of perjury, that the information in
              your notice is accurate and that you are the rights holder or
              authorized to act on the rights holder&rsquo;s behalf, and
              (vi) your signature (physical or electronic). We may forward
              notices to relevant parties and take any action we deem
              appropriate.
            </p>

            <h3 style={subHeading}>9. Fees</h3>
            <p style={paragraph}>
              The Service is currently provided free of charge. We reserve
              the right to introduce paid features in the future, but no
              charge will be incurred without your express consent.
            </p>

            <h3 style={subHeading}>10. Service availability and changes</h3>
            <p style={paragraph}>
              The Service is provided on an as-available basis. We may
              modify, suspend, throttle, rate-limit, discontinue, or
              terminate the Service, any feature, any API, any waypoint, or
              any aspect of the Service at any time, with or without notice,
              and without liability. We do not guarantee any uptime,
              latency, response time, redirect success rate, or that the
              Service will be free of bugs, errors, or interruptions. We
              are not responsible for failures of third-party services on
              which the Service depends.
            </p>

            <h3 style={subHeading}>11. Termination and suspension</h3>
            <p style={paragraph}>
              You may stop using the Service at any time. We may suspend or
              terminate your access, in whole or in part, at any time and
              for any reason, including suspected violations of this
              Agreement, suspected abuse, threats to the Service or other
              users, or to comply with applicable law. Sections of this
              Agreement that by their nature should survive termination
              (including, without limitation, sections on intellectual
              property, disclaimers, limitation of liability,
              indemnification, dispute resolution, and miscellaneous
              provisions) will survive.
            </p>

            <h3 style={subHeading}>12. Disclaimers</h3>
            <p style={allCapsParagraph}>
              The Service, including all features, content, software, and
              data made available through it, is provided &ldquo;AS IS&rdquo;
              and &ldquo;AS AVAILABLE,&rdquo; with all faults and without
              warranty of any kind. To the maximum extent permitted by
              applicable law, Aturi and its contributors, affiliates, and
              service providers disclaim all warranties, whether express,
              implied, statutory, or otherwise, including any warranties of
              merchantability, fitness for a particular purpose, title,
              quiet enjoyment, accuracy, non-infringement, and any
              warranties arising from course of dealing, course of
              performance, or usage of trade.
            </p>
            <p style={allCapsParagraph}>
              Without limiting the foregoing, Aturi does not warrant that
              the Service will be uninterrupted, secure, timely, accurate,
              or error-free; that defects will be corrected; that any
              content (including atproto records, links, and waypoints) is
              accurate, complete, lawful, or reliable; that any third-party
              service or destination is safe, available, or trustworthy;
              that data stored in your repository will be preserved or
              recoverable; or that any redirect, link rewrite, or auto-fill
              will produce the intended result.
            </p>
            <p style={allCapsParagraph}>
              Data returned by the Service is retrieved from public
              third-party services at request time and consists of content
              authored and controlled by third parties. It is provided as
              data, not as advice or instructions from Aturi. If you access
              the Service through third-party software, including an AI
              assistant or agent, that software and its output (including
              any summary, interpretation, decision, or action it produces
              from Service responses) are not part of the Service, and
              Aturi is not responsible for them.
            </p>
            <p style={paragraph}>
              You assume sole responsibility and all risk arising from your
              use of the Service. Some jurisdictions do not allow the
              exclusion of certain warranties, so some of the above
              exclusions may not apply to you. In that case, any implied
              warranties are limited to the shortest period permitted by
              law.
            </p>

            <h3 style={subHeading}>13. Limitation of liability</h3>
            <p style={allCapsParagraph}>
              To the maximum extent permitted by applicable law, in no event
              will Aturi or its contributors, affiliates, officers,
              directors, employees, agents, suppliers, or licensors be
              liable for any indirect, incidental, special, consequential,
              exemplary, or punitive damages, or for any loss of profits,
              revenue, goodwill, use, data (including loss or corruption of
              records in your repository), substitute goods or services, or
              other intangible losses, arising out of or related to this
              Agreement or the Service, whether based in contract, tort
              (including negligence), strict liability, statute, or any
              other legal theory, and whether or not Aturi has been advised
              of the possibility of such damages.
            </p>
            <p style={allCapsParagraph}>
              To the maximum extent permitted by applicable law, the
              aggregate liability of Aturi and its contributors, affiliates,
              officers, directors, employees, agents, suppliers, and
              licensors arising out of or related to this Agreement or the
              Service will not exceed the greater of (a) the amount you
              have paid to Aturi in the twelve (12) months preceding the
              event giving rise to the claim, and (b) fifty US dollars
              (US$50.00).
            </p>
            <p style={paragraph}>
              The exclusions and limitations in this section apply
              regardless of the cause of action or the form of damages
              sought, and survive any failure of essential purpose of any
              limited remedy. Some jurisdictions do not allow the exclusion
              or limitation of certain damages, so these limitations may
              not fully apply to you; in such jurisdictions, the liability
              of Aturi is limited to the smallest extent permitted by law.
            </p>

            <h3 style={subHeading}>14. Indemnification</h3>
            <p style={paragraph}>
              You agree to defend, indemnify, and hold harmless Aturi and
              its contributors, affiliates, officers, directors, employees,
              and agents from and against any and all claims, demands,
              actions, liabilities, losses, damages, judgments, settlements,
              costs, and expenses (including reasonable attorneys&rsquo;
              fees and disbursements) arising out of or related to:
              (a) your access to or use of the Service, including access by
              any automated tool or agent acting on your behalf or at your
              direction; (b) your content or
              any actions you take through the Service, including any
              records you create, update, or delete in your repository;
              (c) your violation of this Agreement; (d) your violation of
              any law or any third party&rsquo;s rights; or (e) any
              third-party claim that your use of the Service caused harm to
              that third party. We reserve the right to assume the
              exclusive defense and control of any matter otherwise subject
              to indemnification by you, in which case you agree to
              cooperate with our defense.
            </p>

            <h3 style={subHeading}>15. Beta and experimental features</h3>
            <p style={paragraph}>
              From time to time we may make available features that are
              identified as beta, preview, experimental, or otherwise not
              ready for general use. Such features are provided for
              evaluation purposes only, may be modified or removed at any
              time, are not subject to the same level of testing or
              support, and may behave unexpectedly. You use such features
              at your own risk.
            </p>

            <h3 style={subHeading}>16. Force majeure</h3>
            <p style={paragraph}>
              Aturi will not be liable for any failure or delay in
              performance to the extent caused by events beyond its
              reasonable control, including acts of God, natural disasters,
              war, terrorism, civil unrest, governmental action, labor
              disputes, internet or telecommunications failures, denial-of-
              service attacks, outages of upstream services (including
              PDSes, AppViews, and infrastructure providers), or other
              similar events.
            </p>

            <h3 style={subHeading}>17. Changes to this Agreement</h3>
            <p style={paragraph}>
              We may update this Agreement from time to time. The
              &ldquo;Last updated&rdquo; date at the top of this page
              indicates when this Agreement was last revised. Material
              changes will be made apparent through reasonable means (for
              example, a notice on the Service or in release notes). Your
              continued use of the Service after the revised Agreement
              takes effect constitutes your acceptance of the revised
              Agreement. If you do not agree to the revised Agreement, you
              must stop using the Service.
            </p>

            <h3 style={subHeading}>18. Dispute resolution and governing law</h3>
            <p style={paragraph}>
              Before filing any formal action, you agree to first attempt to
              resolve any dispute informally by contacting us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
                {CONTACT_EMAIL}
              </a>{' '}
              and providing a written description of the dispute, your
              contact information, and the relief sought. We will attempt
              in good faith to resolve the dispute within sixty (60) days
              of receipt.
            </p>
            <p style={paragraph}>
              The parties have not selected an exclusive forum or governing
              law for disputes arising out of or related to this Agreement
              or the Service. Each party reserves all rights, remedies, and
              defenses available under any applicable law. Each party
              irrevocably waives, to the maximum extent permitted by
              applicable law, any right to participate in a class,
              collective, or representative action against the other party
              arising out of or related to this Agreement or the Service.
            </p>

            <h3 style={subHeading}>19. Miscellaneous</h3>
            <p style={paragraph}>
              <strong>Entire agreement.</strong> This Agreement, together
              with any other terms expressly referenced in it (including
              the Extension Privacy Policy), constitutes the entire
              agreement between you and Aturi regarding the Service and
              supersedes all prior or contemporaneous understandings on
              that subject.
            </p>
            <p style={paragraph}>
              <strong>Severability.</strong> If any provision of this
              Agreement is held to be invalid or unenforceable, that
              provision will be limited or eliminated to the minimum extent
              necessary, and the remaining provisions will remain in full
              force and effect.
            </p>
            <p style={paragraph}>
              <strong>No waiver.</strong> Our failure to enforce any right
              or provision will not be deemed a waiver of that right or
              provision. Any waiver must be in writing and signed by us to
              be effective.
            </p>
            <p style={paragraph}>
              <strong>Assignment.</strong> You may not assign or transfer
              this Agreement or any rights or obligations under it without
              our prior written consent. We may freely assign this
              Agreement, including to a successor in interest. Any
              prohibited assignment is null and void.
            </p>
            <p style={paragraph}>
              <strong>No third-party beneficiaries.</strong> This Agreement
              does not create any third-party beneficiary rights.
            </p>
            <p style={paragraph}>
              <strong>Relationship.</strong> Nothing in this Agreement
              creates any partnership, joint venture, employment, agency,
              or franchise relationship between you and Aturi.
            </p>
            <p style={paragraph}>
              <strong>Notices.</strong> We may provide notices to you by
              posting on the Service or by sending to any email address you
              provide. You may send notices to us at{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
                {CONTACT_EMAIL}
              </a>
              .
            </p>
            <p style={paragraph}>
              <strong>Headings.</strong> Section headings are for
              convenience only and have no legal effect.
            </p>
          </section>

          {/* Privacy Policy */}
          <section>
            <h2 style={sectionHeading}>Privacy Policy</h2>

            <p style={paragraph}>
              Aturi is designed to collect as little personal data as
              possible. This Privacy Policy explains what information we
              and our infrastructure providers process when you use the
              Service, why, and what your choices are. The Aturi browser
              extension is covered by its own dedicated{' '}
              <Link href={EXTENSION_PRIVACY_URL} style={linkStyle}>
                Extension Privacy Policy
              </Link>
              ; this section covers the web app, our public APIs, and
              associated server-side features.
            </p>

            <h3 style={subHeading}>1. Information we collect</h3>
            <p style={paragraph}>
              <strong>Anonymous analytics.</strong> We use Vercel Analytics
              to collect aggregate, anonymous usage statistics, which may
              include page views and visitor counts, referrer source,
              country-level location, and general device information
              (browser type, operating system, device type). Vercel
              Analytics does not use cookies and cannot track individual
              visitors across days or websites. Visitor data is anonymized
              using temporary daily identifiers that reset.
            </p>
            <p style={paragraph}>
              <strong>Server logs.</strong> Our hosting and edge-compute
              provider (Vercel) may temporarily log standard request
              metadata to operate, secure, and debug the Service. This may
              include IP addresses, timestamps, request method and path,
              user agent, response status, and the originating geography
              of the request.
            </p>
            <p style={paragraph}>
              <strong>OAuth and session data.</strong> When you sign in
              with atproto, the OAuth handshake occurs between your browser
              and your PDS (and any identity authority associated with it).
              Aturi acts as a public OAuth client. We do not run an
              identity provider and we do not store your password. Access
              tokens, refresh tokens, the DPoP key, and the session
              metadata required to keep you signed in are stored
              client-side in your browser&rsquo;s local storage (e.g.,
              IndexedDB) and are not sent to Aturi&rsquo;s servers.
              Signing out clears that local session in the browser you used.
            </p>
            <p style={paragraph}>
              <strong>Preferences and personalization.</strong> Non-sensitive
              preferences, including waypoint groups, per-group
              ordering, pinned/visible/hidden waypoints, custom waypoints
              you create (display name, domain, URL templates, supported
              record types), and other UI choices, are stored
              locally in your browser. If you are signed in, we also mirror
              those preferences as a record in your own PDS (NSID{' '}
              <code>to.aturi.actor.preferences</code>, rkey{' '}
              <code>self</code>) so they sync across your devices. The
              authoritative copy lives in your repository, under your
              control; we do not maintain a separate copy. The PDS record
              is technically public, like all atproto records,
              and may be visible to anyone with access to your PDS or
              relays that ingest your repository.
            </p>
            <p style={paragraph}>
              <strong>Atmosphere data.</strong> When you use Explore, view a
              landing page, request an OG image, or call one of our public
              APIs, the Service may fetch records, identity documents,
              blobs, profile data, aggregates, and live commit streams from
              public atproto and related services: for example, PDSes, the
              Bluesky AppView, the PLC directory, third-party indexes and
              aggregators, live-stream relays, public DNS resolvers, and
              public documentation sources. The specific services queried
              depend on the feature and may change. That data is rendered
              or returned to you and is not stored by Aturi for any purpose
              other than fulfilling the request (subject to short-lived
              edge caching for performance). The identifiers (handles,
              DIDs, AT URIs) and query terms you supply are necessarily
              transmitted to the relevant third party so it can answer the
              query.
            </p>
            <p style={paragraph}>
              <strong>Public APIs and automated access.</strong> Third-party
              software (a share sheet, an Apple Shortcut, a script, or an
              AI assistant or agent connected to our MCP endpoint) can call
              our public APIs. The query such a tool sends (a URL, AT URI,
              handle, or search term) and standard request metadata are
              processed like any other request in order to return a
              response; we do not receive the surrounding conversation,
              prompt, or context the tool is operating in. If a URL is
              provided and AT-URI detection in HTML is enabled, Aturi may
              fetch a limited portion of the page over HTTP(S) using a
              clearly identified user agent. What a third-party tool does
              with our responses, including any storage, sharing, or use in
              AI training by its operator, is governed by that
              operator&rsquo;s own terms and policies, not by this Privacy
              Policy.
            </p>
            <p style={paragraph}>
              <strong>Information you choose to send us.</strong> If you
              email us, file an issue in our public repository, or contact
              us through any other channel, we will process the
              information you provide so that we can respond.
            </p>
            <p style={paragraph}>
              We do not use tracking pixels, advertising SDKs, third-party
              advertising cookies, fingerprinting, session replay, or
              behavioral profiling on the Service.
            </p>

            <h3 style={subHeading}>2. How we use information</h3>
            <p style={paragraph}>Information processed in connection with the Service is used to:</p>
            <ul style={list}>
              <li>Operate, maintain, secure, and improve the Service;</li>
              <li>
                Resolve, route, and render Atmosphere content you (or your
                recipients) request;
              </li>
              <li>
                Sync your preferences to and from your own PDS when you are
                signed in;
              </li>
              <li>
                Detect, prevent, and respond to abuse, fraud, security
                incidents, and violations of this Agreement;
              </li>
              <li>
                Understand aggregate usage trends to inform product
                decisions;
              </li>
              <li>Comply with applicable law and respond to lawful requests.</li>
            </ul>
            <p style={paragraph}>
              We do not sell, rent, or trade your personal information. We
              do not share your information with third parties for their
              own marketing purposes. We do not use your information to
              train machine-learning models.
            </p>

            <h3 style={subHeading}>3. Legal bases (EEA/UK users)</h3>
            <p style={paragraph}>
              If you are located in the European Economic Area, the United
              Kingdom, or a jurisdiction with similar law, our legal bases
              for processing your personal data are: (a) our legitimate
              interests in operating, securing, and improving the Service
              and preventing abuse; (b) performance of a contract with you
              (this Agreement); and (c) compliance with our legal
              obligations.
            </p>

            <h3 style={subHeading}>4. Cookies and local storage</h3>
            <p style={paragraph}>
              Aturi does not use cookies for tracking or advertising.
              Vercel Analytics is cookieless. The Service does use your
              browser&rsquo;s local storage technologies (such as
              localStorage and IndexedDB) to remember your preferences,
              hold the OAuth session if you sign in, and store the DPoP
              key bound to your session. You can clear this data at any
              time via your browser&rsquo;s site-data controls; doing so
              will sign you out and reset your local preferences.
            </p>

            <h3 style={subHeading}>5. Where information is processed</h3>
            <p style={paragraph}>
              The Service is hosted on Vercel&rsquo;s global edge
              infrastructure, and requests are typically served from the
              region closest to you. As a result, information may be
              processed in countries other than your own, including the
              United States. If you access the Service from outside the
              country where our infrastructure providers operate, you
              consent to the transfer and processing of information in
              those countries, which may have different data protection
              laws than your own.
            </p>

            <h3 style={subHeading}>6. Service providers and other third parties</h3>
            <p style={paragraph}>
              <strong>Vercel</strong> hosts and operates the Service on our
              behalf, including anonymous analytics, and processes request
              data as our infrastructure provider. Beyond that, answering
              your requests means querying independent public services:
            </p>
            <ul style={list}>
              <li>
                <strong>Public atproto network services</strong>: your PDS
                and identity authority, other PDSes, relays, AppViews (such
                as the Bluesky AppView), and the PLC directory.
              </li>
              <li>
                <strong>
                  Third-party index, aggregation, streaming, and
                  documentation services
                </strong>
                : for example, backlink indexes, reputation and
                lexicon-activity services, Jetstream relays, public DNS
                resolvers, and public documentation sources.
              </li>
              <li>
                <strong>Third-party Atmosphere clients and waypoints</strong>:
                the destinations you (or your recipients) choose to open
                links in.
              </li>
              <li>
                <strong>Browser web stores and OS vendors</strong>: they
                distribute the extension and, depending on your settings,
                may sync extension storage across your devices.
              </li>
              <li>
                <strong>Software you use to reach the Service</strong>:
                browsers, share sheets, shortcuts, and AI assistants or
                agents, operated by their own providers.
              </li>
            </ul>
            <p style={paragraph}>
              These third parties act independently and are not our
              processors. They receive the query needed to answer a
              request, plus standard connection metadata when your browser
              or tool contacts them directly. The specific services queried
              may change at any time. Each is subject to its own privacy
              policy and terms, and we have no control over their
              practices.
            </p>

            <h3 style={subHeading}>7. Data retention</h3>
            <p style={paragraph}>
              <strong>Server logs.</strong> Operational logs are retained
              for a limited period (typically no more than 30 days), except
              where a longer period is required for security, abuse
              investigation, or legal compliance.
            </p>
            <p style={paragraph}>
              <strong>Anonymous analytics.</strong> Aggregate analytics may
              be retained indefinitely; this data does not identify
              individual visitors.
            </p>
            <p style={paragraph}>
              <strong>Preferences and OAuth sessions.</strong> Preferences
              mirrored to your PDS persist until you delete the record;
              local session data persists in your browser until you sign
              out or clear your browser data.
            </p>
            <p style={paragraph}>
              <strong>Atmosphere data.</strong> The Service does not
              persist atproto records, blobs, or identity documents fetched
              from upstream services beyond what is required to serve the
              request and apply short-lived edge cache.
            </p>

            <h3 style={subHeading}>8. Security</h3>
            <p style={paragraph}>
              We use commercially reasonable technical and organizational
              measures to protect the Service, including transport
              encryption (HTTPS), DPoP-bound OAuth tokens, and the
              principle of minimum data collection. No system is perfectly
              secure, however, and we cannot guarantee that the Service
              will be free of unauthorized access. You are responsible for
              keeping your atproto credentials and the device(s) on which
              you use the Service secure.
            </p>

            <h3 style={subHeading}>9. Your rights</h3>
            <p style={paragraph}>
              Because we collect very little personal data on our own
              infrastructure, the practical scope of access, correction, or
              deletion requests is limited. Subject to applicable law, you
              may have the right to (a) confirm whether we process personal
              data about you, (b) access a copy of that data, (c) request
              correction or deletion of that data, (d) object to or
              restrict certain processing, (e) request portability, and
              (f) lodge a complaint with a supervisory authority. To
              exercise these rights, contact{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
                {CONTACT_EMAIL}
              </a>
              . Many requests, especially those relating to records
              in your atproto repository, are best made directly to
              your PDS, since that is where the authoritative copy of your
              data lives.
            </p>
            <p style={paragraph}>
              California residents may have additional rights under the
              California Consumer Privacy Act (CCPA) and the California
              Privacy Rights Act (CPRA), including the right to know,
              delete, correct, and opt out of certain processing. We do
              not sell or share personal information as defined by those
              laws. To submit a request, use the contact address above.
              We will not discriminate against you for exercising your
              rights.
            </p>

            <h3 style={subHeading}>10. Children&rsquo;s privacy</h3>
            <p style={paragraph}>
              The Service is not directed to children under 13 (or the
              minimum age of digital consent in your jurisdiction, if
              higher), and we do not knowingly collect personal information
              from children. If you believe a child has provided us with
              personal information, please contact{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
                {CONTACT_EMAIL}
              </a>{' '}
              and we will take appropriate steps to delete it.
            </p>

            <h3 style={subHeading}>11. Do Not Track</h3>
            <p style={paragraph}>
              Aturi does not perform cross-site behavioral tracking and
              therefore does not respond differently to Do Not Track
              signals.
            </p>

            <h3 style={subHeading}>12. Browser extension</h3>
            <p style={paragraph}>
              The Aturi browser extension is covered by its own dedicated
              privacy policy. Please see the{' '}
              <Link href={EXTENSION_PRIVACY_URL} style={linkStyle}>
                Extension Privacy Policy
              </Link>{' '}
              for the full description of what the extension stores, what
              network requests it makes, and what permissions it uses.
            </p>

            <h3 style={subHeading}>13. Changes to this Privacy Policy</h3>
            <p style={paragraph}>
              We may update this Privacy Policy from time to time. Changes
              will be reflected on this page with an updated &ldquo;Last
              updated&rdquo; date. Material changes will be made apparent
              through reasonable means.
            </p>
          </section>

          {/* Contact */}
          <section
            style={{
              marginTop: '3rem',
              paddingTop: '2rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <h3 style={subHeading}>Contact</h3>
            <p style={paragraph}>
              Questions, legal notices, privacy requests, abuse reports, or
              other concerns about Aturi can be sent to{' '}
              <a href={`mailto:${CONTACT_EMAIL}`} style={linkStyle}>
                {CONTACT_EMAIL}
              </a>
              . You can also file a public issue in our{' '}
              <a
                href={ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                source repository
              </a>{' '}
              or reach the maintainer on Bluesky at{' '}
              <a
                href={BSKY_PROFILE_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                @atpota.to
              </a>
              . The source code is available under GPL v3 at{' '}
              <a
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={linkStyle}
              >
                github.com/atpota-to/aturi
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
