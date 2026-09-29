import test from "node:test";
import assert from "node:assert/strict";
import { findTitleProblem, readVersion } from "../worker/release.mjs";

const BASELINE = "ccc75f8c1d899d98c35153d55921b6d52d43d5bc";

/** @param {string[]} subjects main's squash merges since the baseline, oldest first */
const createGit = (subjects) => (args) => {
  if (args[0] === "merge-base") return "";
  assert.deepEqual(args, [
    "log",
    "--first-parent",
    "--reverse",
    "--format=%s",
    `${BASELINE}..HEAD`,
  ]);
  return subjects.map((subject) => `${subject}\n`).join("");
};

test("the baseline commit is version 2.12.2", () => {
  assert.equal(readVersion(createGit([])), "2.12.2");
});

test("each merge's type moves the version from the one before it", () => {
  const cases = [
    { version: "2.12.3", subjects: ["fix: Keep the tab bar at the bottom (#113)"] },
    { version: "2.12.3", subjects: ["refactor: Name the release helpers (#113)"] },
    { version: "2.12.3", subjects: ["build: Bump the dev-tools group (#113)"] },
    { version: "2.13.0", subjects: ["feat: Show outs on live games (#113)"] },
    { version: "3.0.0", subjects: ["feat!: Move the page to a new address (#113)"] },
    { version: "3.0.0", subjects: ["fix!: Drop the old saved rankings (#113)"] },
    { version: "2.12.2", subjects: ["docs: Explain versions (#113)", "test: Cover it (#114)"] },
    { version: "2.12.2", subjects: ["ci: Retry the review (#113)", "chore: Tidy lint (#114)"] },
  ];
  for (const { version, subjects } of cases) {
    assert.equal(readVersion(createGit(subjects)), version, subjects.join(" / "));
  }
});

test("merges add up in order, and a bigger bump resets the smaller numbers", () => {
  const subjects = [
    "fix: One (#113)",
    "fix: Two (#114)",
    "feat: Three (#115)",
    "fix: Four (#116)",
    "feat!: Five (#117)",
    "docs: Six (#118)",
    "feat: Seven (#119)",
    "fix: Eight (#120)",
  ];
  assert.equal(readVersion(createGit(subjects)), "3.1.1");
});

test("a merge whose title has no known type counts as a fix", () => {
  const subjects = ["Count down to first pitch (#111)", "style: Even out rows (#113)"];
  assert.equal(readVersion(createGit(subjects)), "2.12.4");
});

test("without the baseline in HEAD's history, there's no version", () => {
  const git = (args) => {
    if (args[0] === "merge-base") throw new Error("not an ancestor");
    return "";
  };
  assert.equal(readVersion(git), null);
});

test("a title with a known type and a description passes", () => {
  for (const title of [
    "feat: Show outs on live games",
    "fix: Keep the tab bar at the bottom",
    "feat!: Move the page to a new address",
    "build: bump the dev-tools group with 2 updates",
  ]) {
    assert.equal(findTitleProblem(title, ["page/js/app.js"]), null, title);
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
      findTitleProblem(title, ["page/js/app.js"]),
      /^Start the title with a type: feat:, fix:, refactor:, build:, docs:, test:, ci:, chore:\./,
      title,
    );
  }
});

test("a type that doesn't release may change only what the deploy skips", () => {
  assert.equal(findTitleProblem("docs: Explain versions", ["README.md", "AGENTS.md"]), null);
  assert.equal(findTitleProblem("test: Cover the bracket", ["tests/bracket.test.js"]), null);
  assert.equal(
    findTitleProblem("chore: Tidy", ["README.md", "page/js/app.js", "page/styles.css"]),
    "chore: doesn't release, but this changes what the Worker runs: page/js/app.js, page/styles.css. Use feat:, fix:, refactor:, build:.",
  );
});

test("a type that releases may also change only what the deploy skips", () => {
  assert.equal(findTitleProblem("fix: Correct the README", ["README.md"]), null);
});
