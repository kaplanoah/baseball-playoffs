// Names releases with semantic versions. Each squash merge's title starts with a type that says
// how far it moves the version, so main's history alone gives every commit's version: no tags,
// and nothing written back to the repo.
import { findDeployedChanges } from "./deploy-scope.mjs";

// Worked out by sorting every pull request before versioning began into the types below.
const BASELINE = { commit: "ccc75f8c1d899d98c35153d55921b6d52d43d5bc", version: "2.12.2" };

/** @typedef {"major" | "minor" | "patch" | null} Bump */

/** @type {Record<string, Bump>} */
const BUMPS = {
  feat: "minor",
  fix: "patch",
  refactor: "patch",
  build: "patch",
  docs: null,
  test: null,
  ci: null,
  chore: null,
};

const TITLE_PATTERN = /^([a-z]+)(!?): \S/;

const listTypes = (isReleasing) =>
  Object.keys(BUMPS)
    .filter((type) => (BUMPS[type] !== null) === isReleasing)
    .map((type) => `${type}:`)
    .join(", ");

/**
 * @param {string} title
 * @returns {{ type: string, bump: Bump } | null} null when the title has no known type
 */
function readTitleType(title) {
  const [, type, breaking] = title.match(TITLE_PATTERN) ?? [];
  if (!type || !Object.hasOwn(BUMPS, type)) return null;
  return { type, bump: breaking ? "major" : BUMPS[type] };
}

/**
 * Says what's wrong with a pull request's title, or null when nothing is. A type that doesn't
 * release may only change what the deploy skips, so every deploy carries a new version.
 * @param {string} title
 * @param {string[]} changedFiles
 */
export function findTitleProblem(title, changedFiles) {
  const titleType = readTitleType(title);
  if (!titleType)
    return `Start the title with a type: ${listTypes(true)}, ${listTypes(false)}. A ! after the type, as in feat!:, marks a major change.`;
  const deployed = findDeployedChanges(changedFiles);
  if (titleType.bump === null && deployed.length)
    return `${titleType.type}: doesn't release, but this changes what the Worker runs: ${deployed.join(", ")}. Use ${listTypes(true)}.`;
  return null;
}

/**
 * @param {string} version
 * @param {Bump} bump
 */
function bumpVersion(version, bump) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  return version;
}

// A title without a known type still shipped something, so it counts as a fix.
const readBump = (subject) => {
  const titleType = readTitleType(subject);
  return titleType ? titleType.bump : "patch";
};

/**
 * The version of HEAD, from the merges on main's first-parent history since the baseline.
 * @param {(args: string[]) => string} git
 * @returns {string | null} null when HEAD's history doesn't reach the baseline
 */
export function readVersion(git) {
  let subjects;
  try {
    git(["merge-base", "--is-ancestor", BASELINE.commit, "HEAD"]);
    subjects = git([
      "log",
      "--first-parent",
      "--reverse",
      "--format=%s",
      `${BASELINE.commit}..HEAD`,
    ]);
  } catch {
    return null;
  }
  return subjects
    .split("\n")
    .filter(Boolean)
    .reduce((version, subject) => bumpVersion(version, readBump(subject)), BASELINE.version);
}
