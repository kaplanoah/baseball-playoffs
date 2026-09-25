import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: [".claude/worktrees/", "worker/dist/", "tests/fixtures/", "page/js/sortable.min.js"] },
  js.configs.recommended,
  { rules: { "no-unused-vars": ["error", { ignoreRestSiblings: true }] } },
  { files: ["**/*.{js,mjs}"], languageOptions: { sourceType: "module", globals: globals.node } },
  {
    files: ["page/js/**/*.js"],
    languageOptions: { globals: { ...globals.browser, Sortable: "readonly" } },
  },
  {
    files: ["worker/src/**/*.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["tests/browser/runtime.js"],
    languageOptions: { sourceType: "script", globals: globals.browser },
  },
  {
    // Callbacks passed to page.evaluate run in the page.
    files: ["tests/browser/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
