import test from "node:test";
import assert from "node:assert/strict";
import { listApps } from "../worker/apps.mjs";
import { listModules } from "../worker/page-files.mjs";

const IMPORTS = { "#shared/": "./shared/" };

test("the modules an entry loads are found through every kind of import, once each", () => {
  const files = {
    "js/app.js": {
      text: [
        'import { html } from "#shared/html.js";',
        "import {",
        "  renderGames,",
        "  renderTable,",
        '} from "./views/games.js";',
        'import "./side-effect.js";',
      ].join("\n"),
    },
    "js/views/games.js": {
      text: 'export { html } from "#shared/html.js";\nexport * from "../clubs.js";\n',
    },
    "js/clubs.js": { text: '/** @typedef {import("./types.js").Club} Club */\n' },
    "js/side-effect.js": { text: "" },
    "shared/html.js": { text: 'import "https://example.com/elsewhere.js";\n' },
    "js/unused.js": { text: "" },
  };
  assert.deepEqual(listModules(files, "js/app.js", IMPORTS), [
    "js/app.js",
    "shared/html.js",
    "js/views/games.js",
    "js/side-effect.js",
    "js/clubs.js",
  ]);
});

for (const app of listApps()) {
  test(`${app}: the page names its modules after the import map and before its entry`, async () => {
    const { default: files } = await import(`#page-files/${app}`);
    const page = files["index.html"].text;
    const preloads = [...page.matchAll(/<link rel="modulepreload" href="([^"]+)" \/>/g)];
    const paths = preloads.map(([, path]) => path);
    assert.equal(paths[0], "js/app.js");
    assert.ok(paths.includes("shared/html.js"));
    assert.ok(
      paths.every((path) => files[path]),
      "every named module is served",
    );
    assert.ok(page.indexOf('<script type="importmap">') < preloads[0].index);
    assert.ok(preloads.at(-1).index < page.indexOf('<script type="module" src="js/app.js">'));
  });
}
