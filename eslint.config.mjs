import { readFileSync, readdirSync } from "node:fs";
import js from "@eslint/js";
import globals from "globals";

const VENDORED = "js/sortable.min.js";

// The page's scripts share one global scope: each sees the others' top-level names.
const pageScripts = readdirSync("js")
  .filter((f) => f.endsWith(".js"))
  .map((f) => `js/${f}`)
  .filter((f) => f !== VENDORED);
const TOP_LEVEL =
  /^(?:async\s+)?(?:function\*?\s+|class\s+|const\s+|let\s+|var\s+)([A-Za-z_$][\w$]*)/gm;
const declared = Object.fromEntries(
  pageScripts.map((f) => [f, [...readFileSync(f, "utf8").matchAll(TOP_LEVEL)].map((m) => m[1])]),
);
const fromOtherScripts = (file) =>
  Object.fromEntries(
    pageScripts
      .filter((f) => f !== file)
      .flatMap((f) => declared[f])
      .map((name) => [name, "writable"]),
  );

const scriptRules = { "no-unused-vars": ["error", { vars: "local", ignoreRestSiblings: true }] };

export default [
  { ignores: [".claude/worktrees/", "worker/dist/", "tests/fixtures/", VENDORED] },
  js.configs.recommended,
  { rules: { "no-unused-vars": ["error", { ignoreRestSiblings: true }] } },
  ...pageScripts.map((file) => ({
    files: [file],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...fromOtherScripts(file),
        Sortable: "readonly",
        module: "readonly",
      },
    },
    rules: scriptRules,
  })),
  {
    // Built into one module after js/snapshot.js, which defines MLBSnapshot.
    files: ["worker/src/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.serviceworker, MLBSnapshot: "readonly" },
    },
    rules: scriptRules,
  },
  { files: ["tests/**/*.js"], languageOptions: { sourceType: "commonjs", globals: globals.node } },
  { files: ["**/*.mjs"], languageOptions: { sourceType: "module", globals: globals.node } },
];
