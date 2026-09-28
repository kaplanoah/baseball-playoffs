import test from "node:test";
import assert from "node:assert/strict";
import { decideDeploy, listChangedFiles } from "../worker/deploy-scope.mjs";

test("a merge of only docs, tests, and tooling skips the deploy", () => {
  const decision = decideDeploy([
    "AGENTS.md",
    "README.md",
    "tests/store.test.js",
    "tests/browser/page.spec.mjs",
    ".github/workflows/ci.yml",
    "eslint.config.mjs",
    "worker/set-app-key.mjs",
  ]);
  assert.equal(decision.isNeeded, false);
  assert.match(
    decision.reason,
    /^Nothing the Worker runs changed since the live version, so nothing was deployed\./,
  );
  assert.match(decision.reason, /AGENTS\.md, README\.md/);
});

test("a merge that changes what the Worker runs, or how it deploys, deploys", () => {
  for (const path of [
    "page/js/app.js",
    "page/styles.css",
    "worker/src/store.js",
    "worker/build.mjs",
    "worker/deploy.mjs",
    "worker/wrangler.toml",
    "package-lock.json",
    ".nvmrc",
    ".github/workflows/deploy.yml",
  ]) {
    assert.equal(decideDeploy([path]).isNeeded, true, path);
  }
});

test("a file no list names deploys, and the reason names only what deploys", () => {
  const decision = decideDeploy(["README.md", "shared/clubs.js", "page/js/app.js"]);
  assert.equal(decision.isNeeded, true);
  assert.equal(decision.reason, "Deploying for shared/clubs.js, page/js/app.js.");
});

test("changes that can't be listed deploy", () => {
  const failingGit = () => {
    throw new Error("unknown revision abc1234");
  };
  assert.equal(listChangedFiles("abc1234", failingGit), null);
  assert.equal(decideDeploy(null).isNeeded, true);
});

test("changes are listed since the live version, with a moved file on both sides", () => {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    return "page/js/old.js\ntests/old.test.js\n";
  };
  assert.deepEqual(listChangedFiles("abc1234", git), ["page/js/old.js", "tests/old.test.js"]);
  assert.deepEqual(calls[0], ["diff", "--name-only", "--no-renames", "abc1234", "HEAD"]);
});
