// Finds a pull request's CI run that passed on exactly the code main now has, so main can deploy
// without waiting for CI to run again. A pull request's CI tests it merged into main as main was
// then, and records that code's git tree; when nothing else merged first, the squash merge has
// the same tree.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const API = "https://api.github.com";
const CI_WORKFLOW = ".github/workflows/ci.yml";
const REQUEST_TIMEOUT_MS = 10000;

/** @param {string} tree */
export const nameTestedArtifact = (tree) => `ci-passed-${tree}`;

// Only CI as main's own workflow ran it, on a branch of this repository: a fork's pull request
// runs its own copy of the workflow, which could record a tree it never tested.
const isPassedPullRequestRun = (run) =>
  run.path === CI_WORKFLOW &&
  run.event === "pull_request" &&
  run.conclusion === "success" &&
  run.head_repository?.id === run.repository?.id;

/**
 * @param {object} options
 * @param {string} options.tree the git tree main now has
 * @param {string} options.repository as owner/name
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @returns {Promise<number | null>} the passed run's id
 */
export async function findPassedRun({ tree, repository, fetchImpl = fetch, env = process.env }) {
  const readJson = async (path) => {
    const response = await fetchImpl(`${API}/repos/${repository}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${env.GH_TOKEN}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${path}`);
    return response.json();
  };
  const name = nameTestedArtifact(tree);
  const { artifacts } = await readJson(`/actions/artifacts?name=${name}&per_page=100`);
  for (const artifact of artifacts) {
    if (artifact.expired) continue;
    const run = await readJson(`/actions/runs/${artifact.workflow_run.id}`);
    if (isPassedPullRequestRun(run)) return run.id;
  }
  return null;
}

/**
 * The run that passed on main's code, or why main waits for its own CI.
 * @param {string} tree
 * @returns {Promise<{ runId: number } | { reason: string }>}
 */
async function lookForPassedRun(tree) {
  try {
    const runId = await findPassedRun({ tree, repository: String(process.env.GITHUB_REPOSITORY) });
    return runId ? { runId } : { reason: "No pull request's CI passed on exactly this code" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reason: `Couldn't look for a passed CI run: ${message}` };
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const tree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { encoding: "utf8" }).trim();
  const found = await lookForPassedRun(tree);
  if ("runId" in found) {
    console.log(`CI run ${found.runId} passed on exactly this code, so it deploys now.`);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(process.env.GITHUB_OUTPUT, `run=${found.runId}\n`);
  } else {
    console.log(`::notice::${found.reason}, so the deploy waits for CI on main.`);
  }
}
