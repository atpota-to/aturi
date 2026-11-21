/**
 * Build-time browser flags.
 *
 * WXT replaces `import.meta.env.BROWSER` with a string literal when it builds
 * each target (`wxt build -b safari` and so on), so a branch on these
 * constants folds away and each bundle carries only its own browser's code.
 * One Safari build serves both macOS and iOS; tell those two apart at runtime
 * with `browser.runtime.getPlatformInfo()` (`os` is "mac" or "ios").
 *
 * Under Vitest the variable is undefined, so these are false and tests take
 * the Chrome path. A test that needs the Safari path can call
 * `vi.stubEnv('BROWSER', 'safari')`, then `vi.resetModules()`, then import the
 * module under test again.
 */
export const IS_SAFARI = import.meta.env.BROWSER === 'safari';
