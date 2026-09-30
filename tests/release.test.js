import test from "node:test";
import assert from "node:assert/strict";
import { findTitleProblem, readVersion } from "../worker/release.mjs";

const MLB_BASELINE = "ccc75f8c1d899d98c35153d55921b6d52d43d5bc";
const WNBA_FIRST = "d".repeat(40);

/**
 * main's squash merges since the app's baseline, oldest first, each a subject or a subject and
 * the files it changed.
 * @param {(string | { subject: string, files: string[] })[]} merges
 * @param {string} [baseline]
 */
const createGit =
  (merges, baseline = MLB_BASELINE) =>
  (args) => {
    if (args[0] === "merge-base") return "";
    if (args.includes("--format=%H")) {
      assert.deepEqual(args.slice(-2), ["--", "apps/wnba/"]);
      return `${WNBA_FIRST}\n`;
    }
    assert.deepEqual(args, [
      "log",
      "--first-parent",
      "--reverse",
      "--format=\x1e%s",
      "--name-only",
      `${baseline}..HEAD`,
    ]);
    return merges
      .map((merge) => (typeof merge === "string" ? { subject: merge, files: [] } : merge))
      .map(({ subject, files }) => `\x1e${subject}\n\n${files.map((file) => `${file}\n`).join("")}`)
      .join("");
  };

test("the baseline commit is version 2.12.2", () => {
  assert.equal(readVersion("mlb", createGit([])), "2.12.2");
});

test("each merge's type moves the version from the one before it", () => {
  const cases = [
    { version: "2.12.3", merges: ["fix: Keep the tab bar at the bottom (#113)"] },
    { version: "2.12.3", merges: ["refactor: Name the release helpers (#113)"] },
    { version: "2.12.3", merges: ["build: Bump the dev-tools group (#113)"] },
    { version: "2.13.0", merges: ["feat: Show outs on live games (#113)"] },
    { version: "3.0.0", merges: ["feat!: Move the page to a new address (#113)"] },
    { version: "3.0.0", merges: ["fix!: Drop the old saved rankings (#113)"] },
    { version: "2.12.2", merges: ["docs: Explain versions (#113)", "test: Cover it (#114)"] },
    { version: "2.12.2", merges: ["ci: Retry the review (#113)", "chore: Tidy lint (#114)"] },
  ];
  for (const { version, merges } of cases) {
    assert.equal(readVersion("mlb", createGit(merges)), version, merges.join(" / "));
  }
});

test("merges add up in order, and a bigger bump resets the smaller numbers", () => {
  const merges = [
    "fix: One (#113)",
    "fix: Two (#114)",
    "feat: Three (#115)",
    "fix: Four (#116)",
    "feat!: Five (#117)",
    "docs: Six (#118)",
    "feat: Seven (#119)",
    "fix: Eight (#120)",
  ];
  assert.equal(readVersion("mlb", createGit(merges)), "3.1.1");
});

test("a merge whose title has no known type counts as a fix", () => {
  const merges = ["Count down to first pitch (#111)", "style: Even out rows (#113)"];
  assert.equal(readVersion("mlb", createGit(merges)), "2.12.4");
});

test("a merge that changes only other apps' folders leaves an app's version alone", () => {
  const merges = [
    { subject: "feat: Show the WNBA bracket (#130)", files: ["apps/wnba/page/js/app.js"] },
    { subject: "fix: Tidy both pages (#131)", files: ["apps/wnba/page/styles.css", "README.md"] },
    { subject: "fix: Tidy the baseball page (#132)", files: ["apps/mlb/page/styles.css"] },
    { subject: "fix: Tidy the tooling (#133)", files: ["worker/build.mjs"] },
  ];
  assert.equal(readVersion("mlb", createGit(merges)), "2.12.5");
});

test("an app with no baseline counts from 1.0.0 at the merge that added its folder", () => {
  const merges = [
    { subject: "fix: Tidy the baseball page (#132)", files: ["apps/mlb/page/styles.css"] },
    { subject: "feat: Show the WNBA scores (#133)", files: ["apps/wnba/page/js/app.js"] },
  ];
  assert.equal(readVersion("wnba", createGit(merges, WNBA_FIRST)), "1.1.0");
});

test("without the baseline in HEAD's history, there's no version", () => {
  const git = (args) => {
    if (args[0] === "merge-base") throw new Error("not an ancestor");
    return "";
  };
  assert.equal(readVersion("mlb", git), null);
});

test("an app with no baseline and no merges yet has no version", () => {
  assert.equal(
    readVersion("wnba", () => ""),
    null,
  );
});

test("a title with a known type and a description passes", () => {
  for (const title of [
    "feat: Show outs on live games",
    "fix: Keep the tab bar at the bottom",
    "feat!: Move the page to a new address",
    "build: bump the dev-tools group with 2 updates",
  ]) {
    assert.equal(findTitleProblem(title, ["apps/mlb/page/js/app.js"]), null, title);
  }
});

test("a title without a known type, a colon, and a description is refused", () => {
  for (const title of [
    "Show outs on live games",
    "feature: Show outs on live games",
    "Feat: Show outs on live games",
    "feat(games): Show outs on live games",
    "feat:Show outs on live games",
    "feat: ",
  ]) {
    assert.match(
      findTitleProblem(title, ["apps/mlb/page/js/app.js"]),
      /^Start the title with a type: feat:, fix:, refactor:, build:, docs:, test:, ci:, chore:\./,
      title,
    );
  }
});

test("a type that doesn't release may change only what the deploy skips", () => {
  assert.equal(findTitleProblem("docs: Explain versions", ["README.md", "AGENTS.md"]), null);
  assert.equal(
    findTitleProblem("test: Cover the bracket", ["apps/mlb/tests/bracket.test.js"]),
    null,
  );
  assert.equal(
    findTitleProblem("chore: Tidy", [
      "README.md",
      "apps/mlb/page/js/app.js",
      "apps/mlb/page/styles.css",
    ]),
    "chore: doesn't release, but this changes what the Worker runs: apps/mlb/page/js/app.js, apps/mlb/page/styles.css. Use feat:, fix:, refactor:, build:.",
  );
});

test("a type that releases may also change only what the deploy skips", () => {
  assert.equal(findTitleProblem("fix: Correct the README", ["README.md"]), null);
});
