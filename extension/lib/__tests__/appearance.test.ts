import { afterEach, describe, it, expect } from 'vitest';
import { applyAppearance, applyCachedAppearance } from '../appearance';
import { DEFAULT_PREFS } from '../prefs';

// vitest runs in node, so stand in a minimal document whose <html> carries a
// dataset, which is all applyAppearance touches.
function stubDocument(): Record<string, string | undefined> {
  const dataset: Record<string, string | undefined> = {};
  (globalThis as { document?: unknown }).document = { documentElement: { dataset } };
  return dataset;
}

function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  return store;
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('theme defaults', () => {
  it('defaults the theme to light, like the web app', () => {
    expect(DEFAULT_PREFS.theme).toBe('light');
  });
});

describe('applyAppearance', () => {
  it('writes the chosen theme and text size onto <html>', () => {
    const dataset = stubDocument();
    applyAppearance({ theme: 'dark', fontSize: 'large' });
    expect(dataset.theme).toBe('dark');
    expect(dataset.fs).toBe('large');
  });

  it('falls back to light and medium when prefs carry no values', () => {
    const dataset = stubDocument();
    applyAppearance({} as Parameters<typeof applyAppearance>[0]);
    expect(dataset.theme).toBe('light');
    expect(dataset.fs).toBe('medium');
  });

  it('applies the default prefs as light', () => {
    const dataset = stubDocument();
    applyAppearance(DEFAULT_PREFS);
    expect(dataset.theme).toBe('light');
  });

  it('does nothing without a document', () => {
    expect(() => applyAppearance({ theme: 'dark', fontSize: 'medium' })).not.toThrow();
  });
});

describe('applyCachedAppearance', () => {
  it('re-applies the last appearance before prefs load', () => {
    stubStorage();
    stubDocument();
    applyAppearance({ theme: 'dark', fontSize: 'xlarge' });
    const dataset = stubDocument();
    applyCachedAppearance();
    expect(dataset.theme).toBe('dark');
    expect(dataset.fs).toBe('xlarge');
  });

  it('leaves the defaults alone with no cache or a bad one', () => {
    const store = stubStorage();
    const dataset = stubDocument();
    applyCachedAppearance();
    expect(dataset.theme).toBeUndefined();
    store.set('aturi.appearance', '{not json');
    expect(() => applyCachedAppearance()).not.toThrow();
    store.set('aturi.appearance', JSON.stringify({ theme: 'neon', fontSize: 'huge' }));
    applyCachedAppearance();
    expect(dataset.theme).toBeUndefined();
    expect(dataset.fs).toBeUndefined();
  });

  it('does not throw without storage', () => {
    stubDocument();
    expect(() => applyCachedAppearance()).not.toThrow();
    expect(() => applyAppearance({ theme: 'dark', fontSize: 'medium' })).not.toThrow();
  });
});
