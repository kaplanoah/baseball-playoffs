// Decides whether main needs a deploy. Only when nothing but the docs, tests, and tooling listed
// here changed since the live version does it skip one, so a new kind of file deploys until it
// is listed.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SKIPPED_FILES = new Set([
  "LICENSE",
  ".claude/settings.json",
  ".git-blame-ignore-revs",
  ".github/dependabot.yml",
  ".github/workflows/ci.yml",
  ".gitignore",
  ".prettierignore",
  "eslint.config.mjs",
  "knip.json",
  "playwright.config.mjs",
  "tsconfig.json",
  "types/globals.d.ts",
  "worker/check-pr-title.mjs",
  "worker/set-app-key.mjs",
]);
const SKIPPED_FOLDERS = ["tests/"];

const isSkipped = (path) =>
  path.endsWith(".md") ||
  SKIPPED_FILES.has(path) ||
  SKIPPED_FOLDERS.some((folder) => path.startsWith(folder));

export const findDeployedChanges = (paths) => paths.filter((path) => !isSkipped(path));

const root = fileURLToPath(new URL("../", import.meta.url));
const runGit = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

// Without --no-renames, a file moved out of page/ would list only where it went.
/** @param {string} since the live version's commit */
export function listChangedFiles(since, git = runGit) {
  try {
    return git(["diff", "--name-only", "--no-renames", since, "HEAD"]).split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

/** @param {string[] | null} changedFiles null when they couldn't be listed */
export function decideDeploy(changedFiles) {
  if (changedFiles === null)
    return {
      isNeeded: true,
      reason: "Couldn't list the changes since the live version, so deploying.",
    };
  const deployed = findDeployedChanges(changedFiles);
  if (deployed.length) return { isNeeded: true, reason: `Deploying for ${deployed.join(", ")}.` };
  return {
    isNeeded: false,
    reason: `Nothing the Worker runs changed since the live version, so nothing was deployed. Changed: ${changedFiles.join(", ") || "none"}.`,
  };
}
