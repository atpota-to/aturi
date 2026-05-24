'use client';

import { ArrowRight, Compass, Layers, Link2, Share2, Sparkles, UserCog } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import AppearIn from '@/components/explore/AppearIn';
import WaypointJumpVisual from '@/components/home/WaypointJumpVisual';
import WaypointCarousel from '@/components/home/WaypointCarousel';
import CrossLinkCards from './CrossLinkCards';
import FeatureSection from './FeatureSection';
import UrlAnatomyVisual from './UrlAnatomyVisual';
import RecordTypesGrid from './RecordTypesGrid';
import PickerPreviewVisual from './PickerPreviewVisual';
import SharingScenariosVisual from './SharingScenariosVisual';

const DEMO_HANDLE = 'aturi.to';
// Aturi's own DID — hardcoded so the carousel can build did-aware URLs
// without a runtime profile fetch.
const DEMO_DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';

export default function UniversalLinksLanding() {
  const t = useTranslations('universalLinks');
  const codeStyle = { color: 'var(--text-accent)' } as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      {/* Hero */}
      <AppearIn rise>
        <header
          style={{
            display: 'grid',
            gap: '2.5rem',
            alignItems: 'center',
          }}
          className="landing-hero"
        >
          <div>
            <Badge icon={<Link2 size={12} aria-hidden />}>{t('heroBadge')}</Badge>
            <h1
              style={{
                fontSize: '2.5rem',
                fontWeight: 300,
                marginBottom: '0.75rem',
                color: 'var(--text-primary)',
                lineHeight: 1.15,
              }}
            >
              {t('heroTitle')}
            </h1>
            <p
              style={{
                fontSize: '1.05rem',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                maxWidth: '34rem',
                marginBottom: '1.25rem',
              }}
            >
              {t.rich('heroBody', {
                code: (chunks) => (
                  <code
                    style={{
                      background: 'transparent',
                      padding: 0,
                      color: 'var(--text-accent)',
                    }}
                  >
                    {chunks}
                  </code>
                ),
              })}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Link
                href={`/profile/${DEMO_HANDLE}`}
                className="generate-button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem 1.25rem',
                  background: 'var(--accent-moss)',
                  color: 'var(--text-on-accent)',
                  border: '1px solid var(--accent-forest)',
                  fontSize: '0.95rem',
                  textDecoration: 'none',
                }}
              >
                {t('heroCta')}
                <ArrowRight size={14} />
              </Link>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <WaypointJumpVisual handle={DEMO_HANDLE} />
            <WaypointCarousel handle={DEMO_HANDLE} did={DEMO_DID} />
          </div>
        </header>
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <Compass size={12} />, label: t('anatomyBadge') }}
          title={t('anatomyTitle')}
          body={
            <>
              <p>{t('anatomyBody1')}</p>
              <p>{t('anatomyBody2')}</p>
            </>
          }
          visual={<UrlAnatomyVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <div>
            <Badge icon={<Layers size={12} />}>{t('recordTypesBadge')}</Badge>
            <h2
              style={{
                fontSize: '1.75rem',
                fontWeight: 300,
                color: 'var(--text-primary)',
                margin: '0 0 0.625rem',
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
              }}
            >
              {t('recordTypesTitle')}
            </h2>
            <p
              style={{
                fontSize: '1rem',
                lineHeight: 1.65,
                color: 'var(--text-secondary)',
                maxWidth: '46rem',
                margin: 0,
              }}
            >
              {t.rich('recordTypesBody', {
                code: (chunks) => <code style={codeStyle}>{chunks}</code>,
              })}
            </p>
          </div>
          <RecordTypesGrid />
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          flip
          badge={{ icon: <Sparkles size={12} />, label: t('pickerBadge') }}
          title={t('pickerTitle')}
          body={
            <>
              <p>{t('pickerBody1')}</p>
              <p>{t('pickerBody2')}</p>
            </>
          }
          visual={<PickerPreviewVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <UserCog size={12} />, label: t('prefsBadge') }}
          title={t('prefsTitle')}
          body={
            <>
              <p>{t('prefsBody1')}</p>
              <p>
                {t.rich('prefsBody2', {
                  code: (chunks) => <code style={codeStyle}>{chunks}</code>,
                })}
              </p>
            </>
          }
          visual={
            <div
              style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-medium)',
                padding: '1.25rem',
                maxWidth: '380px',
                margin: '0 auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.75rem',
                transform: 'rotate(-0.3deg)',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontSize: '0.7rem',
                  color: 'var(--text-tertiary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}
              >
                {t('prefsSignedInAs')}
              </div>
              <PrefRow lexicon="app.bsky.feed.post" client="Deer" />
              <PrefRow lexicon="pub.leaflet.document" client="Leaflet" />
              <PrefRow lexicon="sh.tangled.repo" client="Tangled" />
              <div
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-tertiary)',
                  fontStyle: 'italic',
                }}
              >
                {t('prefsSyncedNote')}
              </div>
            </div>
          }
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1.25rem',
          }}
        >
          <div>
            <Badge icon={<Share2 size={12} />}>{t('shareBadge')}</Badge>
            <h2
              style={{
                fontSize: '1.75rem',
                fontWeight: 300,
                color: 'var(--text-primary)',
                margin: '0 0 0.625rem',
                lineHeight: 1.2,
                letterSpacing: '-0.01em',
              }}
            >
              {t('shareTitle')}
            </h2>
            <p
              style={{
                fontSize: '1rem',
                lineHeight: 1.65,
                color: 'var(--text-secondary)',
                maxWidth: '46rem',
                margin: 0,
              }}
            >
              {t('shareBody')}
            </p>
          </div>
          <SharingScenariosVisual />
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <CrossLinkCards current="universal-links" />
      </AppearIn>
    </div>
  );
}

function Badge({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.25rem 0.625rem',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-tertiary)',
        color: 'var(--text-tertiary)',
        fontSize: '0.75rem',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-serif)',
        marginBottom: '1.25rem',
        lineHeight: 1,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function PrefRow({ lexicon, client }: { lexicon: string; client: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.625rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        fontSize: '0.75rem',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-secondary)',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {lexicon}
      </span>
      <span style={{ color: 'var(--text-tertiary)' }}>→</span>
      <span
        style={{
          fontFamily: 'var(--font-serif)',
          color: 'var(--text-accent)',
          padding: '2px 6px',
          border: '1px solid var(--text-accent)',
        }}
      >
        {client}
      </span>
    </div>
  );
}
