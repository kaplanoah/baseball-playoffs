import js from "@eslint/js";
import globals from "globals";

// A bullet or middle dot typed by hand, as a character, an escape, or an HTML entity.
const HAND_SEPARATOR = String.raw`/\u2022|\u00b7|&bull;|&middot;|&#8226;|&#183;/`;

export default [
  { ignores: [".claude/worktrees/", "apps/*/worker/dist/", "apps/*/page/js/sortable.min.js"] },
  js.configs.recommended,
  { rules: { "no-unused-vars": ["error", { ignoreRestSiblings: true }] } },
  { files: ["**/*.{js,mjs}"], languageOptions: { sourceType: "module", globals: globals.node } },
  {
    files: ["apps/*/page/js/**/*.js", "shared/page/**/*.js"],
    languageOptions: { globals: { ...globals.browser, Sortable: "readonly" } },
  },
  {
    // Markup reaches the page only through setHtml, which escapes whatever html`` didn't build,
    // and lists of facts only through joinWithSeparator, so they all read the same way.
    files: ["apps/*/page/js/**/*.js", "shared/page/**/*.js"],
    ignores: ["shared/page/html.js"],
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
        {
          selector: `Literal[value=${HAND_SEPARATOR}], TemplateElement[value.cooked=${HAND_SEPARATOR}]`,
          message: "Separate items with joinWithSeparator from html.js.",
        },
      ],
    },
  },
  {
    // A plain script the page loads before its modules, whose functions the page calls.
    files: ["shared/page/open-last-tab.js"],
    languageOptions: { sourceType: "script" },
    rules: { "no-unused-vars": ["error", { vars: "local" }] },
  },
  {
    files: ["apps/*/page/sw.js", "shared/page/push-worker.js"],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ["apps/*/worker/src/**/*.js", "shared/worker/**/*.js"],
    languageOptions: { globals: { ...globals.serviceworker, WebSocketPair: "readonly" } },
  },
  {
    // Callbacks passed to page.evaluate run in the page.
    files: ["apps/*/tests/browser/*.mjs"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
];
