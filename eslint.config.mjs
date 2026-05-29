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
