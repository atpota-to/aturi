// Stub for the wxt `#imports` alias so vitest can load modules that import
// `browser` and friends. Tests don't exercise the browser APIs themselves —
// they only need the import to resolve.
export const browser = undefined as unknown as Record<string, unknown>;

export function defineBackground<T>(definition: T): T {
  return definition;
}
