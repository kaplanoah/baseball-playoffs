/* Deploys the connector through Cloudflare's REST API, without wrangler.

   For a Claude Code cloud session whose environment holds the Cloudflare
   token as an API credential: the agent proxy adds the token to requests
   for api.cloudflare.com, so the session never sees it -- and wrangler,
   which looks for the token in an environment variable, refuses to start.
   Anywhere else, set CLOUDFLARE_API_TOKEN and this sends it itself.

     npm run deploy:api     (runs npm test first, then this)

   It deploys only a release: the checkout must be main, with nothing
   uncommitted, and exactly what GitHub has as main. It uploads the
   committed worker/dist/worker.mjs as it is -- it never rebuilds, and the
   tests have already failed if that file is stale. Anything else is refused
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

/* Refuses unless this checkout is exactly main as GitHub has it. `git` runs
   one git command and returns its output; the tests pass a stand-in. */
export function checkRelease(git = args => execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" }).trim()){
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if(branch !== RELEASE_BRANCH) throw new Error(`Deploys come from ${RELEASE_BRANCH} only; this checkout is on ${branch}. Merge through a pull request first.`);
  if(git(["status", "--porcelain"])) throw new Error("There are uncommitted changes. Deploy only what has been merged.");
  git(["fetch", "--quiet", "origin", RELEASE_BRANCH]);
  const local = git(["rev-parse", "HEAD"]), remote = git(["rev-parse", `origin/${RELEASE_BRANCH}`]);
  if(local !== remote) throw new Error(`This checkout (${local.slice(0, 7)}) isn't ${RELEASE_BRANCH} as GitHub has it (${remote.slice(0, 7)}). Pull ${RELEASE_BRANCH} and try again.`);
  return local;
}

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
    let body = {};
    try{ body = await res.json(); }catch(e){}
    if(!res.ok || body.success === false){
      const why = (body.errors || []).map(e => `${e.code}: ${e.message}`).join("; ") || `HTTP ${res.status}`;
      throw new Error(`${what} failed: ${why}`);
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
