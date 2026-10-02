import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { listApps } from "../worker/apps.mjs";

const readManifest = (app) =>
  JSON.parse(
    readFileSync(new URL(`../apps/${app}/page/manifest.webmanifest`, import.meta.url), "utf8"),
  );

// Chrome offers to install a page only when its manifest has both of these sizes.
test("every app's manifest offers the icons Android needs to install it", () => {
  for (const app of listApps()) {
    const { icons, display } = readManifest(app);
    const sizes = icons.map((icon) => icon.sizes);
    assert.ok(sizes.includes("192x192"), app);
    assert.ok(sizes.includes("512x512"), app);
    assert.equal(display, "standalone", app);
    for (const { src } of icons)
      assert.ok(existsSync(new URL(`../apps/${app}/page/${src}`, import.meta.url)), src);
  }
});
