import test from "node:test";
import assert from "node:assert/strict";
import { checkAppName, listApps } from "../worker/apps.mjs";

test("an app is a folder under apps/ whose Worker has a wrangler.toml", () => {
  assert.ok(listApps().includes("mlb"));
});

test("a command takes only an app that exists, and says which ones do", () => {
  assert.equal(checkAppName("mlb", ["mlb", "wnba"]), "mlb");
  assert.throws(() => checkAppName("nfl", ["mlb", "wnba"]), {
    message: "There's no app named nfl. The apps are: mlb, wnba.",
  });
  assert.throws(() => checkAppName(undefined, ["mlb"]), {
    message: "Name an app. The apps are: mlb.",
  });
});
