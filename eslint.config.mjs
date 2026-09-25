/* ESLint for the page, the connector, the tests, and the build scripts.
   Formatting is Prettier's job; this only looks for mistakes. */
import { readFileSync, readdirSync } from "node:fs";
import js from "@eslint/js";
import globals from "globals";

const VENDORED = "js/sortable.min.js";

/* The page loads js/*.js as plain scripts into one global scope, so each
   file's top-level names are globals to every other file. Reading them from
   the files keeps that list from going stale, and still catches a name that
   no file declares. */
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

/* In a plain script a top-level name is meant for other files, so only
   unused locals count. Leaving a field out with a rest pattern is how the
   code drops keys, so those aren't unused either. */
const scriptRules = { "no-unused-vars": ["error", { vars: "local", ignoreRestSiblings: true }] };

export default [
  { ignores: ["worker/dist/", "tests/fixtures/", VENDORED] },
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
    // Concatenated after js/snapshot.js into the Worker's one module.
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
