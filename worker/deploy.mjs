// Uses Cloudflare's REST API, not wrangler, so it works when a proxy adds the token:
// wrangler refuses to start without CLOUDFLARE_API_TOKEN in the environment.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

export async function deploy({
  fetchImpl = fetch,
  env = process.env,
  script = readRepoFile("worker/dist/worker.mjs"),
  log = console.log,
  pause = waitFor,
} = {}) {
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if (!account)
    throw new Error(
      "Set CLOUDFLARE_ACCOUNT_ID (Cloudflare dashboard > Workers & Pages > Account ID).",
    );
  const { name, compatibilityDate } = readWorkerConfig();
  const auth = env.CLOUDFLARE_API_TOKEN
    ? { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
    : {};
  const base = `${API}/accounts/${account}/workers`;

  async function callCloudflare(what, url, init, { isMissingAllowed = false } = {}) {
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
            `run \`npm run deploy:api\`, which sets NODE_USE_ENV_PROXY=1 (needs Node 22.21 or later; this is ${process.version}). ` +
            `Anywhere else, set CLOUDFLARE_API_TOKEN.`
          : "";
      throw new Error(`${what} failed: ${why}${hint}`);
    }
    log(`${what}: ok`);
    return body.result;
  }

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

  async function uploadWorker() {
    const form = new FormData();
    form.append(
      "metadata",
      new Blob(
        [
          JSON.stringify({
            main_module: "worker.mjs",
            compatibility_date: compatibilityDate,
            observability: { enabled: true },
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

  async function readConnectorUrl() {
    const { subdomain } = await callCloudflare("subdomain", `${base}/subdomain`, {
      method: "GET",
    });
    return `https://${name}.${subdomain}.workers.dev/mcp`;
  }

  async function rollBack(versions) {
    await callCloudflare("rollback", `${base}/scripts/${name}/deployments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ strategy: "percentage", versions }),
    });
  }

  async function confirmConnectorAnswers(url, previousVersions) {
    const keyedUrl = env.CONNECTOR_KEY ? `${url}/${env.CONNECTOR_KEY}` : url;
    if (await isConnectorAnswering(keyedUrl, { fetchImpl, pause })) {
      log("connector check: ok");
      return;
    }
    if (!previousVersions)
      throw new Error(`The connector at ${url} didn't answer, and no earlier version exists.`);
    await rollBack(previousVersions).catch((error) => {
      throw new Error(
        `The connector at ${url} didn't answer, and the new version is still live: ${error.message}`,
      );
    });
    throw new Error(`The connector at ${url} didn't answer, so the earlier version is live again.`);
  }

  const previousVersions = await findLiveVersions();
  await uploadWorker();
  await enableWorkersDevRoute();
  const url = await readConnectorUrl();
  await confirmConnectorAnswers(url, previousVersions);
  log(`Connector URL: ${url}`);
  return url;
}

const CHECK_ATTEMPTS = 6;
const CHECK_INTERVAL_MS = 5000;
const CHECK_TIMEOUT_MS = 10000;
const INITIALIZE_REQUEST = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "deploy-check", version: "1.0.0" },
  },
});

const waitFor = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function isInitializeAnswered(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: INITIALIZE_REQUEST,
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return !!body?.result?.serverInfo;
  } catch {
    return false;
  }
}

async function isConnectorAnswering(url, { fetchImpl = fetch, pause = waitFor } = {}) {
  for (let attempt = 0; attempt < CHECK_ATTEMPTS; attempt += 1) {
    // A new version takes a few seconds to reach every Cloudflare location.
    await pause(CHECK_INTERVAL_MS);
    if (await isInitializeAnswered(url, fetchImpl)) return true;
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
  deploy().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
