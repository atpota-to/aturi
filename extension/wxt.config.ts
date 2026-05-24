import { defineConfig } from 'wxt';
import path from 'node:path';

const preactRoot = path.resolve(__dirname, 'node_modules/preact');

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: '.',
  webExt: {
    binaries: {
      firefox: '/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox',
    },
    startUrls: ['about:debugging#/runtime/this-firefox'],
  },
  manifest: {
    // i18n: name and description resolve from public/_locales/<lang>/messages.json
    // via Chrome's native __MSG_<key>__ syntax. Chrome picks the user's
    // browser UI language and falls back to `default_locale` ('en').
    default_locale: 'en',
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    permissions: ['storage', 'tabs', 'declarativeNetRequest', 'clipboardWrite'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: '__MSG_extActionTitle__',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        96: 'icon/96.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    browser_specific_settings: {
      gecko: {
        id: 'aturi@dame.is',
        // Must match support for gecko.data_collection_permissions (desktop 140+, Android 142+ per AMO).
        strict_min_version: '140.0',
        // Required for new Firefox submissions on AMO (Nov 2025+). Adjust if the
        // extension transmits data off-device for storage/processing.
        data_collection_permissions: {
          required: ['none'],
        },
      },
      gecko_android: {
        strict_min_version: '142.0',
      },
    },
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
    // WXT's MV2 manifest pipeline strips `default_icon` from the action object.
    // Reinject it so the toolbar always renders the leaf at the right size.
    'build:manifestGenerated': (_wxt, manifest) => {
      const m = manifest as Record<string, unknown>;
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
      // WXT resolves __MSG_*__ in `default_title` against the default
      // locale at build time, defeating Chrome's per-locale resolution.
      // Reinject the placeholder so the toolbar tooltip follows the user's
      // browser language.
      action.default_title = '__MSG_extActionTitle__';
    },
  },
});
