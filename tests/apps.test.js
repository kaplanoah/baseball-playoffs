import test from "node:test";
import assert from "node:assert/strict";
import { checkAppName, listApps, listAppsOrExit, listNamedApps } from "../worker/apps.mjs";

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

test("a command runs for the app it names, or for them all", () => {
  assert.deepEqual(listNamedApps("wnba", ["mlb", "wnba"]), ["wnba"]);
  assert.deepEqual(listNamedApps(undefined, ["mlb", "wnba"]), ["mlb", "wnba"]);
  assert.throws(() => listNamedApps("nfl", ["mlb"]), { message: /^There's no app named nfl\./ });
});

test("a command naming an app that doesn't exist says so plainly and fails", () => {
  const logged = [];
  const exits = [];
  const options = {
    apps: ["mlb", "wnba"],
    log: (message) => {
      logged.push(message);
    },
    exit: (code) => {
      exits.push(code);
    },
  };
  assert.deepEqual(listAppsOrExit("mlb", options), ["mlb"]);
  listAppsOrExit("nfl", options);
  assert.deepEqual(logged, ["There's no app named nfl. The apps are: mlb, wnba."]);
  assert.deepEqual(exits, [1]);
});
