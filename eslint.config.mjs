import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // The explorer's data-fetching effects follow the canonical "reset state
  // then kick off cancellable async work" pattern. The set-state-in-effect
  // rule flags this as cascading-renders, but the immediate setState is
  // bounded to a single render before the async result lands. Disable the
  // rule for the explore subtree so the pattern stays consistent with the
  // rest of the explorer's React code.
  {
    files: [
      "src/components/explore/**/*.tsx",
      "src/components/explore/**/*.ts",
    ],
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Server-only OAuth modules read a signing key and a database credential.
  // Nothing outside the route handlers may import them: a client component
  // that did would pull a secret into the browser bundle, and this repository
  // is force-pushed to a public mirror on every push.
  //
  // This is the zero-dependency substitute for the `server-only` package. That
  // package would catch the same mistake at build time rather than lint time,
  // but it resolves through the `react-server` export condition, which plain
  // `node --test` does not set — so it breaks `npm test` for any module a test
  // touches. Lint runs in CI on every push, which is enough.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/app/api/oauth/**",
      // Only the two route handlers, NOT the whole directory: src/app/oauth/
      // also holds callback/page.tsx, which is a client component.
      "src/app/oauth/client-metadata.json/route.ts",
      "src/app/oauth/jwks.json/route.ts",
      "src/lib/oauth/server/**",
      // Tests run under `node --test` and are never bundled for the browser.
      "src/**/__tests__/**",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/lib/oauth/server/*", "**/oauth/server/*"],
              message:
                "Server-only: reads the OAuth signing key and database credential. " +
                "Import it from src/app/api/oauth/** or src/app/oauth/** only.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "extension/**",
    "packages/**",
  ]),
]);

export default eslintConfig;
