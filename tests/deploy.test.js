/* worker/deploy.mjs against a stand-in for Cloudflare's API: the three calls
   it makes, what it uploads, when it sends a token itself, and how a refusal
   reads. The real API is never called. */
const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../worker/deploy.mjs");
const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };

function fakeCloudflare({ refuse } = {}){
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if(refuse && url.includes(refuse)){
      return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] }), { status: 403 });
    }
    const result = url.endsWith("/workers/subdomain") ? { subdomain: "nokap" } : {};
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}

test("the name and compatibility date come from wrangler.toml", async () => {
  const { workerConfig } = await load();
  assert.deepEqual(workerConfig(), { name: "mlb-live", compatibilityDate: "2026-09-01" });
  assert.throws(() => workerConfig('name = "x"'), /compatibility_date/);
});

test("upload, route, and the connector URL", async () => {
  const { deploy } = await load();
  const cf = fakeCloudflare();
  const url = await deploy({ fetchImpl: cf.fetchImpl, env: ENV, script: "export default {}", log: () => {} });
  assert.equal(url, "https://mlb-live.nokap.workers.dev/mcp");
  assert.deepEqual(cf.calls.map(c => `${c.init.method} ${c.url.replace("https://api.cloudflare.com/client/v4", "")}`), [
    "PUT /accounts/acct123/workers/scripts/mlb-live",
    "POST /accounts/acct123/workers/scripts/mlb-live/subdomain",
    "GET /accounts/acct123/workers/subdomain"
  ]);

  const form = cf.calls[0].init.body;
  const metadata = JSON.parse(await form.get("metadata").text());
  assert.deepEqual(metadata, { main_module: "worker.mjs", compatibility_date: "2026-09-01", observability: { enabled: true } });
  const file = form.get("worker.mjs");
  assert.equal(file.type, "application/javascript+module");
  assert.equal(await file.text(), "export default {}");
  assert.deepEqual(JSON.parse(cf.calls[1].init.body), { enabled: true, previews_enabled: false });
});

test("a token is sent only when one is in the environment", async () => {
  const { deploy } = await load();
  // In a cloud session the proxy adds it; the script must not send its own.
  const proxied = fakeCloudflare();
  await deploy({ fetchImpl: proxied.fetchImpl, env: ENV, script: "", log: () => {} });
  assert.ok(proxied.calls.every(c => !c.init.headers.authorization));

  const local = fakeCloudflare();
  await deploy({ fetchImpl: local.fetchImpl, env: { ...ENV, CLOUDFLARE_API_TOKEN: "t0k" }, script: "", log: () => {} });
  assert.ok(local.calls.every(c => c.init.headers.authorization === "Bearer t0k"));
});

test("a refusal names the step and Cloudflare's reason; no account ID is caught first", async () => {
  const { deploy } = await load();
  const cf = fakeCloudflare({ refuse: "/scripts/mlb-live/subdomain" });
  await assert.rejects(deploy({ fetchImpl: cf.fetchImpl, env: ENV, script: "", log: () => {} }),
    /workers\.dev route failed: 10000: Authentication error/);
  await assert.rejects(deploy({ fetchImpl: cf.fetchImpl, env: {}, script: "", log: () => {} }), /CLOUDFLARE_ACCOUNT_ID/);
});
