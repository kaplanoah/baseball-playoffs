// Uses Cloudflare's REST API, not wrangler, so it works when a proxy adds the token:
// wrangler refuses to start without CLOUDFLARE_API_TOKEN in the environment.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildWorker } from "./build.mjs";

const API = "https://api.cloudflare.com/client/v4";
const root = new URL("../", import.meta.url);
const readRepoFile = (path) => readFileSync(new URL(path, root), "utf8");

export function readWorkerConfig(toml = readRepoFile("worker/wrangler.toml")) {
  const readSetting = (key) => (toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m")) || [])[1];
  const name = readSetting("name");
  const compatibilityDate = readSetting("compatibility_date");
  if (!name || !compatibilityDate)
    throw new Error("worker/wrangler.toml needs name and compatibility_date");
  return { name, compatibilityDate };
}

const RELEASE_BRANCH = "main";

export function checkRelease(
  git = (args) => execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" }).trim(),
) {
  if (git(["status", "--porcelain"]))
    throw new Error("There are uncommitted changes. Deploy only what has been merged.");
  git(["fetch", "--quiet", "origin", RELEASE_BRANCH]);
  const local = git(["rev-parse", "HEAD"]);
  const remote = git(["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if (local !== remote) {
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    throw new Error(
      `This checkout (${branch} at ${local.slice(0, 7)}) isn't ${RELEASE_BRANCH} as GitHub has it (${remote.slice(0, 7)}). Merge through a pull request, or check out origin/${RELEASE_BRANCH}, and try again.`,
    );
  }
  return local;
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
 * @param {string} options.script The bundled Worker to upload.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 * @param {(milliseconds: number) => Promise<unknown>} [options.pause]
 */
export async function deploy({
  script,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
  pause = waitFor,
}) {
  const account = readAccount(env);
  const { name, compatibilityDate } = readWorkerConfig();
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

  // Deploy logs are public, and the address names the account's workers.dev subdomain.
  async function confirmWorkerAnswers(url, previousVersions) {
    if (await isWorkerAnswering(url, { fetchImpl, pause })) {
      log("worker check: ok");
      return;
    }
    if (!previousVersions)
      throw new Error("The Worker didn't answer, and no earlier version exists.");
    await rollBack(previousVersions).catch((error) => {
      throw new Error(
        `The Worker didn't answer, and the new version is still live: ${error.message}`,
      );
    });
    throw new Error("The Worker didn't answer, so the earlier version is live again.");
  }

  const previousVersions = await findLiveVersions();
  const migrations = listPendingMigrations(await readMigrationTag());
  await uploadWorker(migrations);
  await enableWorkersDevRoute();
  const url = await readWorkerUrl();
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(`Deploying ${RELEASE_BRANCH} at ${checkRelease().slice(0, 7)}`);
  } catch (error) {
    console.error(`Not deploying: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
  deploy({ script: await buildWorker() }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
