import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Terms & Privacy Policy - aturi.to',
  description: 'Terms of service and privacy policy for aturi.to',
};

export default function TermsPage() {
  return (
    <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
      {/* Branding */}
      <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
        <Link
          href="/"
          style={{
            display: 'inline-block',
            color: 'var(--text-tertiary)',
            fontSize: '0.875rem',
            textDecoration: 'none',
            transition: 'color 0.2s ease',
          }}
        >
          aturi.to
        </Link>
      </div>

      {/* Header */}
      <header style={{ marginBottom: '3rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
          Terms & Privacy Policy
        </h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
          Last updated: December 27, 2025
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
          {/* Terms of Service */}
          <section style={{ marginBottom: '3rem' }}>
            <h2
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.5rem',
                marginBottom: '1rem',
              }}
            >
              Terms of Service
            </h2>
            
            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              1. Service Description
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              aturi.to is a free link routing service that allows users to share
              ATProto content and let recipients choose which client to view it in.
              We do not host, store, or modify any ATProto content.
            </p>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              2. Acceptable Use
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              You may use aturi.to to share links to ATProto content. You must not
              use the service to:
            </p>
            <ul style={{ marginBottom: '1rem', paddingLeft: '1.5rem' }}>
              <li>Violate any laws or regulations</li>
              <li>Spam or abuse the service</li>
              <li>Attempt to disrupt or compromise the service</li>
              <li>Impersonate others or misrepresent your affiliation</li>
            </ul>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              3. Service Availability
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              We provide aturi.to on an "as is" basis. We make no guarantees about
              service availability, uptime, or functionality. We may modify,
              suspend, or discontinue the service at any time without notice.
            </p>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              4. Limitation of Liability
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              aturi.to is provided free of charge. We are not liable for any
              damages arising from your use of the service, including but not
              limited to lost data, service interruptions, or inaccurate routing.
            </p>
          </section>

          {/* Privacy Policy */}
          <section>
            <h2
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.5rem',
                marginBottom: '1rem',
              }}
            >
              Privacy Policy
            </h2>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              1. Data Collection
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              aturi.to collects minimal data:
            </p>
            <ul style={{ marginBottom: '1rem', paddingLeft: '1.5rem' }}>
              <li>
                <strong>Analytics:</strong> We use Vercel Analytics to collect
                anonymous usage statistics (page views, referrers, device types).
                No personal information is collected.
              </li>
              <li>
                <strong>Server Logs:</strong> Standard web server logs may include
                IP addresses, timestamps, and URLs accessed. These are retained
                temporarily for operational purposes.
              </li>
            </ul>
            <p style={{ marginBottom: '1rem' }}>
              We do not use cookies, tracking pixels, or other invasive tracking
              technologies.
            </p>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              2. Data Usage
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              Any data we collect is used solely to:
            </p>
            <ul style={{ marginBottom: '1rem', paddingLeft: '1.5rem' }}>
              <li>Operate and maintain the service</li>
              <li>Understand usage patterns to improve the service</li>
              <li>Prevent abuse and ensure service stability</li>
            </ul>
            <p style={{ marginBottom: '1rem' }}>
              We do not sell, rent, or share your data with third parties for
              marketing purposes.
            </p>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              3. Third-Party Services
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              When you click a waypoint link, you'll be redirected to a third-party
              ATProto client (Bluesky, Blacksky, etc.). Each of these services has
              their own privacy policies and terms of service.
            </p>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              4. Data Retention
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              We retain server logs for a maximum of 30 days. Anonymous analytics
              data may be retained indefinitely.
            </p>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              5. Your Rights
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              Since we collect minimal personal data, there is little data to
              request or delete. If you have concerns about your privacy, please
              contact us through our{' '}
              <a
                href="https://tangled.org/atpota.to/aturi"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                }}
              >
                repository
              </a>
              .
            </p>

            <h3
              style={{
                color: 'var(--text-primary)',
                fontSize: '1.125rem',
                marginTop: '1.5rem',
                marginBottom: '0.75rem',
              }}
            >
              6. Changes to This Policy
            </h3>
            <p style={{ marginBottom: '1rem' }}>
              We may update this privacy policy from time to time. Changes will be
              reflected on this page with an updated "Last updated" date.
            </p>
          </section>

          {/* Contact */}
          <section style={{ marginTop: '3rem', paddingTop: '2rem', borderTop: '1px solid var(--border-subtle)' }}>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
              Questions or concerns? Visit our{' '}
              <a
                href="https://tangled.org/atpota.to/aturi"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                }}
              >
                repository
              </a>{' '}
              or contact{' '}
              <a
                href="https://atpota.to"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-accent)',
                  textDecoration: 'none',
                }}
              >
                atpota.to
              </a>
              .
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}


