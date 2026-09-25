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

  async function callCloudflare(what, url, init) {
    const response = await fetchImpl(url, {
      ...init,
      headers: { ...auth, ...(init.headers || {}) },
    });
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

  await callCloudflare("workers.dev route", `${base}/scripts/${name}/subdomain`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });

  const { subdomain } = await callCloudflare("subdomain", `${base}/subdomain`, { method: "GET" });
  const url = `https://${name}.${subdomain}.workers.dev/mcp`;
  log(`Connector URL: ${url}`);
  return url;
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
