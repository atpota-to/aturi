'use client';

import {
  Compass,
  Eye,
  Link2,
  MousePointerClick,
  Repeat,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import AppearIn from '@/components/explore/AppearIn';
import BrowserChrome from '@/components/home/BrowserChrome';
import ExtensionPopupVisual from '@/components/home/ExtensionPopupVisual';
import DownloadButton, { BrowserFallbackList } from '@/components/home/DownloadButton';
import { getWaypointCount } from '@/utils/waypoints';
import CrossLinkCards from './CrossLinkCards';
import InspectPanelVisual from './InspectPanelVisual';
import AutoRedirectVisual from './AutoRedirectVisual';
import ContextMenuVisual from './ContextMenuVisual';
import FeatureSection from './FeatureSection';

export default function ExtensionLanding() {
  const t = useTranslations('extensionPage');
  const waypointCount = getWaypointCount();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      {/* Hero: badge + headline + copy + CTA on the left, popup demo on the right */}
      <AppearIn rise>
        <header
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: '2.5rem',
            alignItems: 'center',
          }}
          className="landing-hero"
        >
          <div>
            <Badge icon={<MousePointerClick size={12} aria-hidden />}>
              {t('heroBadge')}
            </Badge>
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
                marginBottom: '1rem',
              }}
            >
              {t('heroBody')}
            </p>
            <p
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.85rem',
                color: 'var(--text-accent)',
                fontFamily: 'var(--font-mono)',
                marginBottom: '1.25rem',
              }}
            >
              <Repeat size={14} />
              {t('clientCount', { count: waypointCount })}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
              <DownloadButton variant="primary" align="start" />
              <BrowserFallbackList justify="start" />
            </div>
          </div>
          <div>
            <BrowserChrome>
              <ExtensionPopupVisual />
            </BrowserChrome>
          </div>
        </header>
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <Compass size={12} />, label: t('oneClickBadge') }}
          title={t('oneClickTitle')}
          body={
            <>
              <p>{t('oneClickBody1')}</p>
              <p>{t('oneClickBody2')}</p>
            </>
          }
          visual={
            <BrowserChrome>
              <ExtensionPopupVisual />
            </BrowserChrome>
          }
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          flip
          badge={{ icon: <Eye size={12} />, label: t('inspectBadge') }}
          title={t('inspectTitle')}
          body={
            <>
              <p>{t('inspectBody1')}</p>
              <p>{t('inspectBody2')}</p>
            </>
          }
          visual={<InspectPanelVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <Zap size={12} />, label: t('autoBadge') }}
          title={t('autoTitle')}
          body={
            <>
              <p>{t('autoBody1')}</p>
              <p>{t('autoBody2')}</p>
            </>
          }
          visual={<AutoRedirectVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          flip
          badge={{ icon: <Link2 size={12} />, label: t('contextBadge') }}
          title={t('contextTitle')}
          body={
            <>
              <p>
                {t.rich('contextBody1', {
                  code: (chunks) => (
                    <code style={{ color: 'var(--text-accent)' }}>{chunks}</code>
                  ),
                })}
              </p>
              <p>{t('contextBody2')}</p>
            </>
          }
          visual={<ContextMenuVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <section
          style={{
            padding: '2rem',
            border: '1px solid var(--border-medium)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            alignItems: 'flex-start',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--text-accent)',
              fontSize: '0.75rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-serif)',
            }}
          >
            <ShieldCheck size={14} aria-hidden /> {t('localFirstBadge')}
          </div>
          <h2
            style={{
              fontSize: '1.625rem',
              fontWeight: 300,
              color: 'var(--text-primary)',
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {t('localFirstTitle')}
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '1rem',
              lineHeight: 1.65,
              margin: 0,
              maxWidth: '46rem',
            }}
          >
            {t.rich('localFirstBody', {
              link: (chunks) => (
                <Link
                  href="/extension/privacy"
                  style={{ color: 'var(--text-accent)' }}
                >
                  {chunks}
                </Link>
              ),
            })}
          </p>
          <DownloadButton variant="outline" align="start" />
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <CrossLinkCards current="extension" />
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
