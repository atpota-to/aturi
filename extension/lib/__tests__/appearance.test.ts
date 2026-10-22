import { afterEach, describe, it, expect } from 'vitest';
import { applyAppearance } from '../appearance';
import { DEFAULT_PREFS } from '../prefs';

// vitest runs in node, so stand in a minimal document whose <html> carries a
// dataset, which is all applyAppearance touches.
function stubDocument(): Record<string, string | undefined> {
  const dataset: Record<string, string | undefined> = {};
  (globalThis as { document?: unknown }).document = { documentElement: { dataset } };
  return dataset;
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
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
