import { useMemo } from 'react';
import {
  COMPAT_FAMILIES,
  COMPAT_FAMILY_ORDER,
  type RedirectCompatFamily,
} from '@aturi/waypoints.data';
import {
  clearRecents,
  getRedirectCompatFor,
  setFavoriteForFamily,
  type Prefs,
} from '../../../lib/prefs';
import { allWaypoints, DID_REQUIRED_WAYPOINTS, visibleWaypointIds } from '../../../lib/catalog';
import { t } from '../../../lib/i18n';
import SearchSelect, { type SearchSelectOption } from '../components/SearchSelect';

type Props = {
  prefs: Prefs;
  onChange: (partial: Partial<Prefs>) => void;
};

export default function DefaultsTab({ prefs, onChange }: Props) {
  const waypoints = useMemo(
    () => allWaypoints(prefs.customWaypoints),
    [prefs.customWaypoints]
  );
  const visible = useMemo(() => visibleWaypointIds(prefs), [prefs.waypointGroups]);

  // Build per-family candidate lists: visible, redirect-capable waypoints
  // that belong to that family.
  const familyCandidates = useMemo(() => {
    const map = new Map<RedirectCompatFamily, typeof waypoints>();
    for (const family of COMPAT_FAMILY_ORDER) {
      const candidates = waypoints.filter(w => {
        if (!visible.has(w.id)) return false;
        if (DID_REQUIRED_WAYPOINTS.has(w.id)) return false;
        const compat = getRedirectCompatFor(w.id, prefs.customWaypoints);
        return compat.includes(family);
      });
      if (candidates.length > 0) map.set(family, candidates);
    }
    return map;
  }, [waypoints, visible, prefs.customWaypoints]);

  // Only surface families with >1 member - there's nothing to "choose" if the
  // family has exactly one waypoint, and it'd only add clutter.
  const activeFamilies = useMemo(
    () => COMPAT_FAMILY_ORDER.filter(f => (familyCandidates.get(f)?.length ?? 0) > 1),
    [familyCandidates]
  );

  function setFamilyFavorite(family: RedirectCompatFamily, id: string) {
    const next = setFavoriteForFamily(prefs, family, id || null);
    onChange({ favoriteByFamily: next.favoriteByFamily });
  }

  async function handleClearRecents() {
    if (!confirm(t('defaults_clearRecentsConfirm'))) {
      return;
    }
    await clearRecents();
  }

  const onLabel = t('switch_on');
  const offLabel = t('switch_off');

  return (
    <div>
      <h1 className="options-h1">{t('defaults_h1')}</h1>
      <p className="options-lede">{t('defaults_lede')}</p>

      <div className="options-card">
        <div className="options-card-title">{t('defaults_appearanceTitle')}</div>
        <div className="options-card-sub">{t('defaults_appearanceSub')}</div>

        <div className="appearance-row">
          <div className="appearance-row-label">{t('defaults_theme')}</div>
          <div
            className="appearance-segmented"
            role="radiogroup"
            aria-label={t('defaults_themeAria')}
          >
            {(['dark', 'light'] as const).map(value => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={prefs.theme === value}
                className={`appearance-segment ${prefs.theme === value ? 'is-active' : ''}`}
                onClick={() => onChange({ theme: value })}
              >
                {value === 'dark' ? t('defaults_themeDark') : t('defaults_themeLight')}
              </button>
            ))}
          </div>
        </div>

        <div className="appearance-row">
          <div className="appearance-row-label">{t('defaults_textSize')}</div>
          <div
            className="appearance-segmented"
            role="radiogroup"
            aria-label={t('defaults_textSizeAria')}
          >
            {(
              [
                { value: 'small', labelKey: 'defaults_textSmall' },
                { value: 'medium', labelKey: 'defaults_textMedium' },
                { value: 'large', labelKey: 'defaults_textLarge' },
                { value: 'xlarge', labelKey: 'defaults_textXLarge' },
              ] as const
            ).map(opt => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={prefs.fontSize === opt.value}
                className={`appearance-segment ${prefs.fontSize === opt.value ? 'is-active' : ''}`}
                onClick={() => onChange({ fontSize: opt.value })}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="options-card">
        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">{t('defaults_autoRedirect')}</div>
            <div className="options-card-sub">
              {prefs.autoRedirect
                ? t('defaults_autoRedirectOnSub')
                : t('defaults_autoRedirectOffSub')}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.autoRedirect ? 'on' : ''}`}
            onClick={() => onChange({ autoRedirect: !prefs.autoRedirect })}
            aria-pressed={prefs.autoRedirect}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.autoRedirect ? onLabel : offLabel}</span>
          </button>
        </div>

        {prefs.autoRedirect && (
          <div className="defaults-favorites-block">
            <div className="aturi-hr" />
            <div className="defaults-favorites-intro">
              <div className="aturi-label" style={{ marginBottom: 4 }}>
                {t('defaults_favoritesLabel')}
              </div>
              <div className="aturi-subtle" style={{ fontSize: 12 }}>
                {t('defaults_favoritesHelp')}
              </div>
            </div>

            {activeFamilies.length === 0 ? (
              <div className="aturi-subtle" style={{ marginTop: 6 }}>
                {t('defaults_favoritesEmpty')}
              </div>
            ) : (
              <div className="defaults-family-list">
                {activeFamilies.map(family => {
                  const meta = COMPAT_FAMILIES[family];
                  const candidates = familyCandidates.get(family) ?? [];
                  const current = prefs.favoriteByFamily?.[family] ?? '';
                  const noneLabel = t('defaults_favoritesNone');
                  const options: SearchSelectOption[] = [
                    { value: '', label: noneLabel, fixed: true },
                    ...candidates.map(w => ({ value: w.id, label: w.name })),
                  ];
                  return (
                    <div className="defaults-family-row" key={family}>
                      <div className="defaults-family-meta">
                        <div className="defaults-family-name">{meta.name}</div>
                        <div className="defaults-family-desc">{meta.description}</div>
                      </div>
                      <SearchSelect
                        id={`favorite-${family}`}
                        options={options}
                        value={current}
                        onChange={val => setFamilyFavorite(family, val)}
                        placeholder={noneLabel}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">{t('defaults_smartRecsTitle')}</div>
            <div className="options-card-sub">
              {prefs.smartRecommendations
                ? t('defaults_smartRecsOnSub')
                : t('defaults_smartRecsOffSub')}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.smartRecommendations ? 'on' : ''}`}
            onClick={() => onChange({ smartRecommendations: !prefs.smartRecommendations })}
            aria-pressed={prefs.smartRecommendations}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.smartRecommendations ? onLabel : offLabel}</span>
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">{t('defaults_openNewTabTitle')}</div>
            <div className="options-card-sub">
              {prefs.openInNewTab
                ? t('defaults_openNewTabOnSub')
                : t('defaults_openNewTabOffSub')}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.openInNewTab ? 'on' : ''}`}
            onClick={() => onChange({ openInNewTab: !prefs.openInNewTab })}
            aria-pressed={prefs.openInNewTab}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.openInNewTab ? onLabel : offLabel}</span>
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">{t('defaults_compactTitle')}</div>
            <div className="options-card-sub">
              {prefs.compactMode
                ? t('defaults_compactOnSub')
                : t('defaults_compactOffSub')}
            </div>
          </div>
          <button
            className={`aturi-switch ${prefs.compactMode ? 'on' : ''}`}
            onClick={() => onChange({ compactMode: !prefs.compactMode })}
            aria-pressed={prefs.compactMode}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.compactMode ? onLabel : offLabel}</span>
          </button>
        </div>

        <div className="aturi-hr" />

        <div className="options-toggle-row">
          <div>
            <div className="options-card-title">{t('defaults_recentsTitle')}</div>
            <div className="options-card-sub">
              {prefs.historyEnabled
                ? t('defaults_recentsOnSub')
                : t('defaults_recentsOffSub')}
            </div>
            {prefs.historyEnabled && prefs.recents.length > 0 && (
              <button
                type="button"
                className="aturi-btn aturi-btn-ghost defaults-clear-recents"
                onClick={handleClearRecents}
              >
                {t('defaults_clearRecents', String(prefs.recents.length))}
              </button>
            )}
          </div>
          <button
            className={`aturi-switch ${prefs.historyEnabled ? 'on' : ''}`}
            onClick={() => onChange({ historyEnabled: !prefs.historyEnabled })}
            aria-pressed={prefs.historyEnabled}
          >
            <span className="aturi-switch-box" />
            <span className="aturi-muted">{prefs.historyEnabled ? onLabel : offLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
