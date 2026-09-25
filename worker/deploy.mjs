/* Deploys the connector through Cloudflare's REST API, without wrangler.

   For a Claude Code cloud session whose environment holds the Cloudflare
   token as an API credential: the agent proxy adds the token to requests
   for api.cloudflare.com, so the session never sees it -- and wrangler,
   which looks for the token in an environment variable, refuses to start.
   Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node 22.21
   or later), so deploy:api sets it; without it no token reaches Cloudflare.
   Anywhere else, set CLOUDFLARE_API_TOKEN and this sends it itself.

     npm run deploy:api     (runs npm test first, then this)

   It deploys only a release: the checked-out commit must be exactly what
   GitHub has as main, with nothing uncommitted. The branch name doesn't
   matter, so a cloud session's own branch deploys once it matches main. It
   uploads the committed worker/dist/worker.mjs as it is -- it never
   rebuilds, and the tests have already failed if that file is stale. Anything else is refused
   with the reason, before Cloudflare is contacted.

   Then three calls: upload the script, switch on its workers.dev route,
   and read the account's workers.dev subdomain to print the connector's
   URL. The name and compatibility date come from worker/wrangler.toml, so
   both ways of deploying produce the same Worker. */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const API = "https://api.cloudflare.com/client/v4";
const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

/* The two settings the deploy needs from wrangler.toml. */
export function workerConfig(toml = read("worker/wrangler.toml")){
  const value = key => (toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m")) || [])[1];
  const name = value("name"), compatibilityDate = value("compatibility_date");
  if(!name || !compatibilityDate) throw new Error("worker/wrangler.toml needs name and compatibility_date");
  return { name, compatibilityDate };
}

const RELEASE_BRANCH = "main";

/* Refuses unless the checked-out commit is exactly main as GitHub has it,
   on whatever branch. `git` runs one git command and returns its output;
   the tests pass a stand-in. */
export function checkRelease(git = args => execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" }).trim()){
  if(git(["status", "--porcelain"])) throw new Error("There are uncommitted changes. Deploy only what has been merged.");
  git(["fetch", "--quiet", "origin", RELEASE_BRANCH]);
  const local = git(["rev-parse", "HEAD"]), remote = git(["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if(local !== remote){
    const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
    throw new Error(`This checkout (${branch} at ${local.slice(0, 7)}) isn't ${RELEASE_BRANCH} as GitHub has it (${remote.slice(0, 7)}). Merge through a pull request, or check out origin/${RELEASE_BRANCH}, and try again.`);
  }
  return local;
}

/* Cloudflare's codes for a request that carried no credentials at all. */
const NO_CREDENTIALS = new Set([9106, 1001]);

/* Upload, route, report. Returns the connector's URL. `fetchImpl` and `env`
   are parameters so the tests can run it against a stand-in API. */
export async function deploy({ fetchImpl = fetch, env = process.env, script = read("worker/dist/worker.mjs"), log = console.log } = {}){
  const account = env.CLOUDFLARE_ACCOUNT_ID;
  if(!account) throw new Error("Set CLOUDFLARE_ACCOUNT_ID (Cloudflare dashboard → Workers & Pages → Account ID).");
  const { name, compatibilityDate } = workerConfig();
  const auth = env.CLOUDFLARE_API_TOKEN ? { authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } : {};
  const base = `${API}/accounts/${account}/workers`;

  async function call(what, url, init){
    const res = await fetchImpl(url, { ...init, headers: { ...auth, ...(init.headers || {}) } });
    const text = await res.text();
    let body = {};
    try{ body = JSON.parse(text); }catch{ /* not JSON: shown raw below */ }
    if(!res.ok || body.success === false){
      const errors = body.errors || [];
      /* A refusal that isn't Cloudflare's JSON (a proxy's, a firewall's)
         says why only in its raw body, so show that. */
      const raw = text.trim()
        ? `HTTP ${res.status} (server: ${res.headers.get("server") || "?"}): ${text.trim().slice(0, 500)}`
        : `HTTP ${res.status}`;
      const why = errors.map(e => `${e.code}: ${e.message}`).join("; ") || raw;
      const hint = !env.CLOUDFLARE_API_TOKEN && errors.some(e => NO_CREDENTIALS.has(e.code))
        ? `\nNo token reached Cloudflare. In a cloud session the proxy adds it, but only to requests sent through the proxy: `
          + `run \`npm run deploy:api\`, which sets NODE_USE_ENV_PROXY=1 (needs Node 22.21 or later; this is ${process.version}). `
          + `Anywhere else, set CLOUDFLARE_API_TOKEN.`
        : "";
      throw new Error(`${what} failed: ${why}${hint}`);
    }
    log(`${what}: ok`);
    return body.result;
  }

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify({
    main_module: "worker.mjs",
    compatibility_date: compatibilityDate,
    observability: { enabled: true }
  })], { type: "application/json" }));
  form.append("worker.mjs", new Blob([script], { type: "application/javascript+module" }), "worker.mjs");
  await call("upload", `${base}/scripts/${name}`, { method: "PUT", body: form });

  await call("workers.dev route", `${base}/scripts/${name}/subdomain`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true, previews_enabled: false })
  });

  const { subdomain } = await call("subdomain", `${base}/subdomain`, { method: "GET" });
  const url = `https://${name}.${subdomain}.workers.dev/mcp`;
  log(`Connector URL: ${url}`);
  return url;
}

if(process.argv[1] === fileURLToPath(import.meta.url)){
  try{
    console.log(`Deploying ${RELEASE_BRANCH} at ${checkRelease().slice(0, 7)}`);
  }catch(e){
    console.error(`Not deploying: ${e.message}`);
    process.exit(1);
  }
  deploy().catch(e => { console.error(e.message); process.exit(1); });
}
