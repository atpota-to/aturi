import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { useTranslations } from 'next-intl';
import Header from '@/components/Header';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'meta.terms' });
  return {
    title: t('title'),
    description: t('description'),
  };
}

const linkAccent = {
  color: 'var(--text-accent)',
  textDecoration: 'none',
};

const h2Style = {
  color: 'var(--text-primary)',
  fontSize: '1.5rem',
  marginBottom: '1rem',
} as const;

const h3Style = {
  color: 'var(--text-primary)',
  fontSize: '1.125rem',
  marginTop: '1.5rem',
  marginBottom: '0.75rem',
} as const;

export default function TermsPage() {
  const t = useTranslations('terms');
  return (
    <div className="container-narrow" style={{ padding: '4rem 2rem' }}>
      <Header simple />

      <header style={{ marginBottom: '3rem', textAlign: 'center' }}>
        <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
          {t('pageTitle')}
        </h1>
        <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
          {t('lastUpdated')}
        </p>
      </header>

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
          <section style={{ marginBottom: '3rem' }}>
            <h2 style={h2Style}>{t('tosHeading')}</h2>

            <h3 style={h3Style}>{t('tos1Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('tos1Body')}</p>

            <h3 style={h3Style}>{t('tos2Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('tos2Intro')}</p>
            <ul style={{ marginBottom: '1rem', paddingLeft: '1.5rem' }}>
              <li>{t('tos2List1')}</li>
              <li>{t('tos2List2')}</li>
              <li>{t('tos2List3')}</li>
              <li>{t('tos2List4')}</li>
            </ul>

            <h3 style={h3Style}>{t('tos3Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('tos3Body')}</p>

            <h3 style={h3Style}>{t('tos4Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('tos4Body')}</p>
          </section>

          <section>
            <h2 style={h2Style}>{t('privacyHeading')}</h2>

            <h3 style={h3Style}>{t('priv1Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('priv1Intro')}</p>
            <p style={{ marginBottom: '1rem' }}>
              {t.rich('priv1Analytics', { strong: (c) => <strong>{c}</strong> })}
            </p>
            <ul style={{ marginBottom: '1rem', paddingLeft: '1.5rem' }}>
              <li>{t('priv1List1')}</li>
              <li>{t('priv1List2')}</li>
              <li>{t('priv1List3')}</li>
              <li>{t('priv1List4')}</li>
            </ul>
            <p style={{ marginBottom: '1rem' }}>{t('priv1AnalyticsNote')}</p>
            <p style={{ marginBottom: '1rem' }}>
              {t.rich('priv1Logs', { strong: (c) => <strong>{c}</strong> })}
            </p>
            <p style={{ marginBottom: '1rem' }}>{t('priv1NoTracking')}</p>

            <h3 style={h3Style}>{t('priv2Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('priv2Intro')}</p>
            <ul style={{ marginBottom: '1rem', paddingLeft: '1.5rem' }}>
              <li>{t('priv2List1')}</li>
              <li>{t('priv2List2')}</li>
              <li>{t('priv2List3')}</li>
            </ul>
            <p style={{ marginBottom: '1rem' }}>{t('priv2NoSale')}</p>

            <h3 style={h3Style}>{t('priv3Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('priv3Body')}</p>

            <h3 style={h3Style}>{t('priv4Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('priv4Body')}</p>

            <h3 style={h3Style}>{t('priv5Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>
              {t.rich('priv5Body', {
                repo: (c) => (
                  <a
                    href="https://tangled.org/atpota.to/aturi"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkAccent}
                  >
                    {c}
                  </a>
                ),
              })}
            </p>

            <h3 style={h3Style}>{t('priv6Title')}</h3>
            <p style={{ marginBottom: '1rem' }}>{t('priv6Body')}</p>
          </section>

          <section
            style={{
              marginTop: '3rem',
              paddingTop: '2rem',
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
              {t.rich('contact', {
                repo: (c) => (
                  <a
                    href="https://tangled.org/atpota.to/aturi"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkAccent}
                  >
                    {c}
                  </a>
                ),
                site: (c) => (
                  <a
                    href="https://atpota.to"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={linkAccent}
                  >
                    {c}
                  </a>
                ),
              })}
            </p>
          </section>
        </article>
      </div>
    </div>
  );
}
