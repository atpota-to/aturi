import { defineConfig } from 'wxt';
import path from 'node:path';

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
    name: 'Aturi',
    description:
      'Open the current Atmosphere page in your preferred client, or auto-redirect links.',
    permissions: ['storage', 'tabs', 'declarativeNetRequest', 'clipboardWrite'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Aturi',
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
        strict_min_version: '115.0',
      },
    },
  },
  vite: () => ({
    resolve: {
      alias: {
        '@aturi': path.resolve(__dirname, '../src/utils'),
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
    },
  },
});
