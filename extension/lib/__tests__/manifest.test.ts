import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import config from '../../wxt.config';

/**
 * The manifest is a function of the target browser. Safari gets its own
 * permissions, icons and settings; Chrome and Firefox must keep exactly what
 * they had. These call the config the way WXT does, without a build.
 */

type Manifest = Record<string, unknown> & {
  permissions?: string[];
  host_permissions?: string[];
  icons?: Record<string, string>;
  browser_specific_settings?: Record<string, unknown>;
};

function manifestFor(browser: string): Manifest {
  const manifest = config.manifest;
  if (typeof manifest !== 'function') throw new Error('manifest should be a function');
  return manifest({
    browser,
    manifestVersion: 3,
    mode: 'production',
    command: 'build',
  }) as Manifest;
}

type Hooks = {
  'build:publicAssets': (
    wxt: { config: { browser: string } },
    files: Array<{ absoluteSrc?: string; relativeDest: string }>
  ) => void;
  'build:manifestGenerated': (
    wxt: { config: { browser: string } },
    manifest: Record<string, unknown>
  ) => void;
};

const hooks = config.hooks as unknown as Hooks;

describe('manifest for Safari', () => {
  const m = manifestFor('safari');

  it('asks for what Safari needs and nothing it lacks', () => {
    expect(m.permissions).toEqual([
      'storage',
      'tabs',
      'declarativeNetRequest',
      'declarativeNetRequestWithHostAccess',
      'clipboardWrite',
      'activeTab',
    ]);
    expect(m.permissions).not.toContain('identity');
    expect(m.host_permissions).toEqual(['<all_urls>']);
  });

  it('declares the large icons Safari lists', () => {
    expect(Object.keys(m.icons!).map(Number).sort((a, b) => a - b)).toEqual([
      16, 32, 48, 64, 96, 128, 256, 512,
    ]);
  });

  it('carries a Safari minimum version and no Firefox keys', () => {
    expect(m.browser_specific_settings).toEqual({ safari: { strict_min_version: '18.4' } });
  });
});

describe.each(['chrome', 'firefox'])('manifest for %s', browser => {
  const m = manifestFor(browser);

  it('asks for no identity permission (there is no sign-in) and no Safari-only ones', () => {
    expect(m.permissions).toEqual(['storage', 'tabs', 'declarativeNetRequest', 'clipboardWrite']);
  });

  it('keeps the gecko settings and the toolbar icon set', () => {
    const settings = m.browser_specific_settings as Record<string, Record<string, unknown>>;
    expect(settings.gecko.id).toBe('aturi@dame.is');
    expect(settings.gecko.strict_min_version).toBe('140.0');
    expect(settings.gecko_android.strict_min_version).toBe('142.0');
    // No sign-in, so nothing to declare under authenticationInfo.
    expect(settings.gecko.data_collection_permissions).toEqual({ required: ['none'] });
    expect(settings.safari).toBeUndefined();
    expect(Object.keys(m.icons!)).toEqual(['16', '32', '48', '96', '128']);
  });
});

describe('build hooks', () => {
  it('copies the Safari icon sizes into the Safari build only', () => {
    const safariFiles: Array<{ absoluteSrc?: string; relativeDest: string }> = [];
    hooks['build:publicAssets']({ config: { browser: 'safari' } }, safariFiles);
    expect(safariFiles.map(f => f.relativeDest)).toEqual([
      'icon/64.png',
      'icon/256.png',
      'icon/512.png',
    ]);
    // `npm run icons` writes these; the build fails without them.
    for (const file of safariFiles) expect(existsSync(file.absoluteSrc!)).toBe(true);

    const chromeFiles: Array<{ absoluteSrc?: string; relativeDest: string }> = [];
    hooks['build:publicAssets']({ config: { browser: 'chrome' } }, chromeFiles);
    expect(chromeFiles).toEqual([]);
  });

  it('turns the Safari service worker into a non-persistent background page', () => {
    const safari: Record<string, unknown> = {
      manifest_version: 3,
      action: {},
      background: { service_worker: 'background.js' },
    };
    hooks['build:manifestGenerated']({ config: { browser: 'safari' } }, safari);
    expect(safari.background).toEqual({ scripts: ['background.js'], persistent: false });
  });

  it('leaves the Chrome and Firefox backgrounds alone', () => {
    const chrome: Record<string, unknown> = {
      manifest_version: 3,
      action: {},
      background: { service_worker: 'background.js' },
    };
    hooks['build:manifestGenerated']({ config: { browser: 'chrome' } }, chrome);
    expect(chrome.background).toEqual({ service_worker: 'background.js' });

    const firefox: Record<string, unknown> = {
      manifest_version: 3,
      action: {},
      background: { scripts: ['background.js'] },
    };
    hooks['build:manifestGenerated']({ config: { browser: 'firefox' } }, firefox);
    expect(firefox.background).toEqual({ scripts: ['background.js'] });
  });
});
