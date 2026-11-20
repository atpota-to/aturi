import { defineConfig } from 'wxt';
import path from 'node:path';

const preactRoot = path.resolve(__dirname, 'node_modules/preact');

const TOOLBAR_ICONS = {
  16: 'icon/16.png',
  32: 'icon/32.png',
  48: 'icon/48.png',
  96: 'icon/96.png',
  128: 'icon/128.png',
};

// Safari lists extensions with larger icons than the toolbar uses (Apple asks
// for 48/64/96/128/256/512 in `icons`, and the App Store Connect packager
// wants a 512). `npm run icons` writes these to assets/safari-icon/ rather
// than public/icon/, because WXT adds every PNG it finds in public/icon/ to
// the manifest and Chrome/Firefox would pick them up too. The
// `build:publicAssets` hook below copies them in for the Safari build only.
const SAFARI_EXTRA_ICON_SIZES = [64, 256, 512] as const;

// Lowest Safari (macOS and iOS) the Safari build claims to support.
// - 17 added DNR `regexSubstitution`, which every redirect rule uses.
// - 18 fixed per-tab badges, and 18.0 is the first release that ships the
//   open-source WebKit DNR code the Safari behaviour here was checked against.
// - Before 18.4 `storage.onChanged` passed `areaName` as undefined, and prefs,
//   debugLog and the inspect-scan content script all filter on it.
const SAFARI_MIN_VERSION = '18.4';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  // Force MV3 on every target. WXT otherwise defaults Firefox/Safari to MV2,
  // where declarativeNetRequest is unavailable to the extension — which
  // silently disables the entire auto-redirect engine on those browsers while
  // the options UI still offers the toggle. gecko strict_min_version 140+
  // fully supports MV3 DNR and event-page backgrounds.
  manifestVersion: 3,
  webExt: {
    binaries: {
      firefox: '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    },
    startUrls: ['about:debugging#/runtime/this-firefox'],
  },
  // One `safari` build serves both macOS and iOS (`wxt build -b safari`).
  // Chrome and Firefox get exactly the manifest they had before this became a
  // function; only the Safari branch differs.
  manifest: ({ browser }) => {
    const isSafari = browser === 'safari';
    return {
      name: 'Aturi',
      description:
        'Move around the Atmosphere: switch between clients, auto-redirect to your client of choice, and copy universal links.',
      // Safari gets two permissions the other browsers don't need:
      // - `declarativeNetRequestWithHostAccess`: WebKit applies a DNR
      //   `redirect` only when the extension holds this permission AND the user
      //   has granted it the site being redirected from. With plain
      //   `declarativeNetRequest` the redirect rules install and never fire.
      // - `activeTab`: clicking the toolbar button grants the current tab, so
      //   the popup can read its URL and the content scripts are injected there
      //   even on sites the user hasn't allowed yet.
      permissions: isSafari
        ? [
            'storage',
            'tabs',
            'declarativeNetRequest',
            'declarativeNetRequestWithHostAccess',
            'clipboardWrite',
            'activeTab',
          ]
        : ['storage', 'tabs', 'declarativeNetRequest', 'clipboardWrite'],
      // Safari grants this site by site (or "every website") at the user's
      // choice, not at install. It still has to ship from the first Safari
      // release: an update that adds host permissions turns the extension off.
      host_permissions: ['<all_urls>'],
      action: {
        default_title: 'Aturi',
        default_icon: { ...TOOLBAR_ICONS },
      },
      icons: isSafari
        ? {
            ...TOOLBAR_ICONS,
            ...Object.fromEntries(SAFARI_EXTRA_ICON_SIZES.map(size => [size, `icon/${size}.png`])),
          }
        : { ...TOOLBAR_ICONS },
      // WXT passes `browser_specific_settings` through untouched for every
      // target, so the gecko keys would otherwise end up in Safari's manifest.
      browser_specific_settings: isSafari
        ? { safari: { strict_min_version: SAFARI_MIN_VERSION } }
        : {
            gecko: {
              id: 'aturi@dame.is',
              // Must match support for gecko.data_collection_permissions (desktop 140+, Android 142+ per AMO).
              strict_min_version: '140.0',
              // Required for new Firefox submissions on AMO (Nov 2025+).
              //
              // Back to `none`, as it was before sign-in to aturi.to existed.
              // While it did, this was `authenticationInfo`, because signing in
              // sent a handle to aturi.to and stored a session token. Sign-in
              // has since been removed.
              //
              // Deliberately NOT declared: `websiteContent`. Page scanning
              // happens entirely on-device and nothing it reads is ever
              // transmitted.
              data_collection_permissions: {
                required: ['none'],
              },
            },
            gecko_android: {
              strict_min_version: '142.0',
            },
          },
    };
  },
  vite: () => ({
    resolve: {
      alias: {
        '@aturi': path.resolve(__dirname, '../src/utils'),
        // Alias React APIs to Preact compat (smaller bundle, fewer linter hits than react-dom).
        'react/jsx-runtime': path.join(preactRoot, 'compat/jsx-runtime.mjs'),
        'react/jsx-dev-runtime': path.join(preactRoot, 'compat/jsx-dev-runtime.mjs'),
        'react-dom/client': path.join(preactRoot, 'compat/client.mjs'),
        react: path.join(preactRoot, 'compat/dist/compat.mjs'),
        'react-dom': path.join(preactRoot, 'compat/dist/compat.mjs'),
      },
    },
  }),
  hooks: {
    // Copy the Safari-only icon sizes into the Safari build (see
    // SAFARI_EXTRA_ICON_SIZES). A missing file fails the build, which is what
    // we want: run `npm run icons`.
    'build:publicAssets': (wxt, files) => {
      if (wxt.config.browser !== 'safari') return;
      for (const size of SAFARI_EXTRA_ICON_SIZES) {
        files.push({
          absoluteSrc: path.resolve(__dirname, `assets/safari-icon/${size}.png`),
          relativeDest: `icon/${size}.png`,
        });
      }
    },
    'build:manifestGenerated': (_wxt, manifest) => {
      const m = manifest as Record<string, unknown>;
      // Safari runs the background as a non-persistent page
      // (`scripts` + `persistent: false`) rather than a service worker. Safari's
      // Develop menu has shipped without a way to inspect service-worker
      // backgrounds, iOS has been reported to kill them early, and the same
      // bundle already runs as a background page on Firefox. iOS requires
      // non-persistent either way. WXT always writes `service_worker` for MV3
      // outside Firefox and overwrites any `background` set in the manifest
      // above, so this is the only place to change it.
      if (_wxt.config.browser === 'safari' && m.manifest_version === 3) {
        const bg = m.background as { service_worker?: string } | undefined;
        if (bg?.service_worker) {
          m.background = { scripts: [bg.service_worker], persistent: false };
        }
      }
      // WXT's MV2 manifest pipeline strips `default_icon` from the action object.
      // Reinject it so the toolbar always renders the leaf at the right size.
      const action =
        m.manifest_version === 3
          ? (m.action as Record<string, unknown> | undefined)
          : (m.browser_action as Record<string, unknown> | undefined);
      if (!action) return;
      action.default_icon = {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        96: 'icon/96.png',
        128: 'icon/128.png',
      };
    },
  },
});
