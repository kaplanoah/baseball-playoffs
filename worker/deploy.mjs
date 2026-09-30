// Uses Cloudflare's REST API, not wrangler, so it works when a proxy adds the token:
// wrangler refuses to start without CLOUDFLARE_API_TOKEN in the environment.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findAppRoot, listAppsOrExit } from "./apps.mjs";
import { buildWorker } from "./build.mjs";
import { decideDeploy, listChangedFiles } from "./deploy-scope.mjs";

const API = "https://api.cloudflare.com/client/v4";
const root = new URL("../", import.meta.url);

/** @param {string} toml */
export function readWorkerConfig(toml) {
  const readSetting = (key) => (toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m")) || [])[1];
  const name = readSetting("name");
  const compatibilityDate = readSetting("compatibility_date");
  if (!name || !compatibilityDate)
    throw new Error("wrangler.toml needs name and compatibility_date");
  return { name, compatibilityDate };
}

/** @param {string} app */
export const readAppWorkerConfig = (app) =>
  readWorkerConfig(readFileSync(new URL("worker/wrangler.toml", findAppRoot(app)), "utf8"));

const RELEASE_BRANCH = "main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function isAncestor(git, commit, of) {
  try {
    git(["merge-base", "--is-ancestor", commit, of]);
    return true;
  } catch {
    return false;
  }
}

// A merged commit that main has since moved past isn't deployed: the newer one's deploy covers
// it, and deploying it would put older code live.
/** @returns {{ commit: string, newerMain: string | null }} */
export function checkRelease(
  git = (args) => execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" }).trim(),
) {
  if (git(["status", "--porcelain"]))
    throw new Error("There are uncommitted changes. Deploy only what has been merged.");
  git(["fetch", "--quiet", "origin", RELEASE_BRANCH]);
  const local = git(["rev-parse", "HEAD"]);
  const remote = git(["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if (local === remote) return { commit: local, newerMain: null };
  if (isAncestor(git, local, remote)) return { commit: local, newerMain: remote };
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  throw new Error(
    `This checkout (${branch} at ${local.slice(0, 7)}) isn't ${RELEASE_BRANCH} as GitHub has it (${remote.slice(0, 7)}). Merge through a pull request, or check out origin/${RELEASE_BRANCH}, and try again.`,
  );
}

const NO_CREDENTIALS = new Set([9106, 1001]);

const STORE_BINDING = {
  type: "durable_object_namespace",
  name: "STORE",
  class_name: "SeasonStore",
};
// Cloudflare records the last tag applied and rejects an upload that repeats one.
export const MIGRATIONS = [{ tag: "v1", new_sqlite_classes: ["SeasonStore"] }];

export function listPendingMigrations(appliedTag) {
  const pending = MIGRATIONS.slice(MIGRATIONS.findIndex(({ tag }) => tag === appliedTag) + 1);
  if (!pending.length) return null;
  return {
    old_tag: appliedTag,
    new_tag: pending.at(-1).tag,
    steps: pending.map(({ tag, ...step }) => step),
  };
}

export function readAccount(env) {
  if (!env.CLOUDFLARE_ACCOUNT_ID)
    throw new Error(
      "Set CLOUDFLARE_ACCOUNT_ID (Cloudflare dashboard > Workers & Pages > Account ID).",
    );
  return env.CLOUDFLARE_ACCOUNT_ID;
}

export const findWorkersApi = (account) => `${API}/accounts/${account}/workers`;

export function createCloudflareCaller({ fetchImpl, env, log }) {
  const auth = env.CLOUDFLARE_API_TOKEN
    ? { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
    : {};

  return async function callCloudflare(what, url, init, { isMissingAllowed = false } = {}) {
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...auth, ...(init.headers || {}) },
    });
    if (isMissingAllowed && response.status === 404) {
      log(`${what}: none`);
      return null;
    }
    const text = await response.text();
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON: shown raw below */
    }
    if (!response.ok || body.success === false) {
      const errors = body.errors || [];
      // A refusal from a proxy or firewall explains itself only in its raw body.
      const raw = text.trim()
        ? `HTTP ${response.status} (server: ${response.headers.get("server") || "?"}): ${text.trim().slice(0, 500)}`
        : `HTTP ${response.status}`;
      const why = errors.map((error) => `${error.code}: ${error.message}`).join("; ") || raw;
      const hint =
        !env.CLOUDFLARE_API_TOKEN && errors.some((error) => NO_CREDENTIALS.has(error.code))
          ? `\nNo token reached Cloudflare. In a cloud session the proxy adds it, but only to requests sent through the proxy: ` +
            `run this through its npm script, which sets NODE_USE_ENV_PROXY=1 (needs Node 22.21 or later; this is ${process.version}). ` +
            `Anywhere else, set CLOUDFLARE_API_TOKEN.`
          : "";
      throw new Error(`${what} failed: ${why}${hint}`);
    }
    log(`${what}: ok`);
    return body.result;
  };
}

/**
 * @param {object} options
 * @param {string} options.app The app whose Worker this is.
 * @param {string} options.script The bundled Worker to upload.
 * @param {string} [options.commit] The commit the bundle was built from, recorded on the version.
 * @param {(since: string) => string[] | null} [options.findChanges] Files changed since a commit.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 * @param {(milliseconds: number) => Promise<unknown>} [options.pause]
 * @returns {Promise<string | null>} the Worker's address, or null when nothing needed deploying
 */
export async function deploy({
  app,
  script,
  commit,
  findChanges = listChangedFiles,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
  pause = waitFor,
}) {
  const account = readAccount(env);
  const { name, compatibilityDate } = readAppWorkerConfig(app);
  const base = findWorkersApi(account);
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });

  async function findLiveVersions() {
    const result = await callCloudflare(
      "live version",
      `${base}/scripts/${name}/deployments`,
      { method: "GET" },
      { isMissingAllowed: true },
    );
    const deployments = result?.deployments || [];
    if (!deployments.length) return null;
    const newest = deployments.reduce((latest, deployment) =>
      deployment.created_on > latest.created_on ? deployment : latest,
    );
    return newest.versions.map(({ version_id, percentage }) => ({ version_id, percentage }));
  }

  // The version with the most traffic, which is all of it outside a rollout.
  async function readLiveCommit(versions) {
    const [live] = [...versions].sort((first, second) => second.percentage - first.percentage);
    const version = await callCloudflare(
      "live commit",
      `${base}/scripts/${name}/versions/${live.version_id}`,
      { method: "GET" },
    );
    const recorded = version?.annotations?.["workers/message"];
    return COMMIT_PATTERN.test(recorded || "") ? recorded : null;
  }

  // Without a recorded commit, there's nothing to compare with, so it deploys.
  async function isDeployNeeded(previousVersions) {
    const liveCommit = previousVersions && (await readLiveCommit(previousVersions));
    if (!liveCommit) return true;
    const { isNeeded, reason } = decideDeploy(findChanges(liveCommit), app);
    log(isNeeded ? reason : `::notice::${reason}`);
    return isNeeded;
  }

  async function readMigrationTag() {
    const scripts = await callCloudflare("migration tag", `${base}/scripts`, { method: "GET" });
    return scripts.find((stored) => stored.id === name)?.migration_tag;
  }

  async function uploadWorker(migrations) {
    const form = new FormData();
    form.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            main_module: "worker.mjs",
            compatibility_date: compatibilityDate,
            observability: { enabled: true },
            bindings: [STORE_BINDING],
            keep_bindings: ["secret_text"],
            ...(commit && { annotations: { "workers/message": commit } }),
            ...(migrations && { migrations }),
          }),
        ],
        { type: "application/json" },
      ),
    );
    form.append(
      "worker.mjs",
      new Blob([script], { type: "application/javascript+module" }),
      "worker.mjs",
    );
    await callCloudflare("upload", `${base}/scripts/${name}`, { method: "PUT", body: form });
  }

  async function enableWorkersDevRoute() {
    await callCloudflare("workers.dev route", `${base}/scripts/${name}/subdomain`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, previews_enabled: false }),
    });
  }

  async function readWorkerUrl() {
    const { subdomain } = await callCloudflare("subdomain", `${base}/subdomain`, {
      method: "GET",
    });
    return `https://${name}.${subdomain}.workers.dev/`;
  }

  async function rollBack(versions) {
    await callCloudflare("rollback", `${base}/scripts/${name}/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy: "percentage", versions }),
    });
  }

  // The upload makes the new version live, so anything that goes wrong after it puts the
  // earlier one back.
  /** @returns {Promise<never>} */
  async function restoreAfter(problem, previousVersions) {
    if (!previousVersions) throw new Error(`${problem}, and no earlier version exists.`);
    await rollBack(previousVersions).catch((error) => {
      throw new Error(`${problem}, and the new version is still live: ${error.message}`);
    });
    throw new Error(`${problem}, so the earlier version is live again.`);
  }

  // Deploy logs are public, and the address names the account's workers.dev subdomain.
  async function confirmWorkerAnswers(url, previousVersions) {
    if (await isWorkerAnswering(url, { fetchImpl, pause })) {
      log("worker check: ok");
      return;
    }
    await restoreAfter("The Worker didn't answer", previousVersions);
  }

  async function findNewVersionUrl(previousVersions) {
    try {
      await enableWorkersDevRoute();
      return await readWorkerUrl();
    } catch (error) {
      return restoreAfter(error instanceof Error ? error.message : String(error), previousVersions);
    }
  }

  const previousVersions = await findLiveVersions();
  if (!(await isDeployNeeded(previousVersions))) return null;
  const migrations = listPendingMigrations(await readMigrationTag());
  await uploadWorker(migrations);
  const url = await findNewVersionUrl(previousVersions);
  await confirmWorkerAnswers(url, previousVersions);
  return url;
}

const CHECK_ATTEMPTS = 6;
const CHECK_INTERVAL_MS = 5000;
const CHECK_TIMEOUT_MS = 10000;

const waitFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// robots.txt is the one path that answers without the page's key.
async function isRobotsAnswered(url, fetchImpl) {
  try {
    const response = await fetchImpl(new URL("robots.txt", url).href, {
      method: "GET",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function isWorkerAnswering(url, { fetchImpl = fetch, pause = waitFor } = {}) {
  for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt += 1) {
    // A new version takes a few seconds to reach every Cloudflare location.
    await pause(CHECK_INTERVAL_MS);
    if (await isRobotsAnswered(url, fetchImpl)) return true;
  }
  return false;
}

// Each line names its app, after any GitHub annotation that has to start it.
/** @param {string} app */
const createAppLog = (app) => (message) => {
  const [, annotation = "", text] = message.match(/^(::\w+::)?(.*)$/s);
  console.log(`${annotation}${app}: ${text}`);
};

function readReleaseOrExit() {
  try {
    return checkRelease();
  } catch (error) {
    console.error(`Not deploying: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const apps = listAppsOrExit(process.argv[2]);
  const { commit, newerMain } = readReleaseOrExit();
  if (newerMain) {
    console.log(
      `::notice::${RELEASE_BRANCH} has moved on to ${newerMain.slice(0, 7)}, whose deploy covers ${commit.slice(0, 7)}, so nothing was deployed.`,
    );
    process.exit(0);
  }
  console.log(`Deploying ${RELEASE_BRANCH} at ${commit.slice(0, 7)}`);
  let hasFailed = false;
  // One app's failed deploy doesn't hold back the others; each puts its own earlier version back.
  for (const app of apps) {
    try {
      await deploy({ app, script: await buildWorker(app), commit, log: createAppLog(app) });
    } catch (error) {
      console.error(`${app}: ${error instanceof Error ? error.message : error}`);
      hasFailed = true;
    }
  }
  if (hasFailed) process.exit(1);
}
