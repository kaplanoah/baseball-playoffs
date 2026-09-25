import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: [".claude/worktrees/", "worker/dist/", "page/js/sortable.min.js"] },
  js.configs.recommended,
  { rules: { "no-unused-vars": ["error", { ignoreRestSiblings: true }] } },
  { files: ["**/*.{js,mjs}"], languageOptions: { sourceType: "module", globals: globals.node } },
  {
    files: ["page/js/**/*.js"],
    languageOptions: { globals: { ...globals.browser, Sortable: "readonly" } },
  },
  {
    // Markup reaches the page only through setHtml, which escapes whatever html`` didn't build.
    files: ["page/js/**/*.js"],
    ignores: ["page/js/html.js"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]",
          message: "Write markup with setHtml from html.js.",
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: "Write markup with setHtml from html.js.",
        },
      ],
    },
  },
  {
    files: ["worker/src/**/*.js"],
    languageOptions: { globals: { ...globals.serviceworker, WebSocketPair: "readonly" } },
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
