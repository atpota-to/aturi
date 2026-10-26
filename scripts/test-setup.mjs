/**
 * Registers the `@/…` alias resolver for `npm test`. Loaded via `--import`
 * so the hook is installed before the test files are resolved.
 */
import { register } from 'node:module';

register('./alias-resolve.mjs', import.meta.url);
