import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // eslint-plugin-react's auto-detect calls context.getFilename(), which
    // ESLint 10 removed, so every rule that touches it throws before linting
    // starts. Declaring the version skips detection entirely.
    settings: { react: { version: "18.3" } },
  },
  {
    // The Node entrypoints and the realtime runtime are plain CommonJS - they
    // are launched with `node`, not bundled - so require() is correct there.
    files: [
      "server.js",
      "ws-server.js",
      "realtime-runtime/**/*.js",
      "scripts/**/*.js",
    ],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
