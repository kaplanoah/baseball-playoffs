// Decides whether a merge needs a deploy. Only a merge that changes nothing but the docs, tests,
// and tooling listed here skips one, so a new kind of file deploys until it is listed.
// It imports only Node's own modules, so it runs before npm ci.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
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
  "worker/set-app-key.mjs",
]);
const SKIPPED_FOLDERS = ["tests/"];

const isSkipped = (path) =>
  path.endsWith(".md") ||
  SKIPPED_FILES.has(path) ||
  SKIPPED_FOLDERS.some((folder) => path.startsWith(folder));

const findDeployedChanges = (paths) => paths.filter((path) => !isSkipped(path));

const root = fileURLToPath(new URL("../", import.meta.url));
const runGit = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });

// Without --no-renames, a file moved out of page/ would list only where it went.
export function listChangedFiles(git = runGit) {
  try {
    return git(["diff", "--name-only", "--no-renames", "HEAD^", "HEAD"])
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
}

/** @param {string[] | null} changedFiles null when they couldn't be listed */
export function decideDeploy(changedFiles) {
  if (changedFiles === null)
    return { isNeeded: true, reason: "Couldn't list the merge's changes, so deploying." };
  const deployed = findDeployedChanges(changedFiles);
  if (deployed.length) return { isNeeded: true, reason: `Deploying for ${deployed.join(", ")}.` };
  return {
    isNeeded: false,
    reason: `Nothing the Worker runs changed, so nothing was deployed. Changed: ${changedFiles.join(", ") || "none"}.`,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { isNeeded, reason } = decideDeploy(listChangedFiles());
  console.log(isNeeded ? reason : `::notice::${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `deploy=${isNeeded}\n`);
}
