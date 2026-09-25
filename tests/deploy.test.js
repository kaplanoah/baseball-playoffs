import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loadDeployModule = () => import("../worker/deploy.mjs");
const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };

const API = "https://api.cloudflare.com/client/v4";
const CONNECTOR_URL = "https://mlb-live.nokap.workers.dev/mcp";
const LIVE_VERSIONS = [{ version_id: "v-live", percentage: 100 }];
const LIVE_DEPLOYMENTS = [
  { created_on: "2026-09-24T10:00:00Z", versions: [{ version_id: "v-older", percentage: 100 }] },
  { created_on: "2026-09-25T10:00:00Z", versions: LIVE_VERSIONS },
];
const ANSWER_INITIALIZE = () =>
  new Response(
    JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "mlb-live" } } }),
  );
const skipPause = async () => {};

/**
 * @param {{ refuse?: string, isNew?: boolean, answerConnector?: () => Response, refuseRollback?: boolean }} [options]
 */
function createFakeCloudflare({
  refuse,
  isNew = false,
  answerConnector = ANSWER_INITIALIZE,
  refuseRollback = false,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (!url.startsWith(API)) return answerConnector();
    const isDeployments = url.endsWith("/deployments");
    const isRefused =
      (refuse && url.includes(refuse)) ||
      (refuseRollback && isDeployments && init.method === "POST");
    if (isRefused) {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10000, message: "Authentication error" }],
        }),
        { status: 403 },
      );
    }
    if (isNew && isDeployments && init.method === "GET") {
      return new Response(
        JSON.stringify({
          success: false,
          errors: [{ code: 10007, message: "This Worker does not exist on your account." }],
        }),
        { status: 404 },
      );
    }
    let result = {};
    if (url.endsWith("/workers/subdomain")) result = { subdomain: "nokap" };
    if (isDeployments && init.method === "GET") result = { deployments: LIVE_DEPLOYMENTS };
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}

const describeCalls = (calls) =>
  calls.map((request) => `${request.init.method} ${request.url.replace(API, "")}`);

test("the name and compatibility date come from wrangler.toml", async () => {
  const { readWorkerConfig } = await loadDeployModule();
  assert.deepEqual(readWorkerConfig(), { name: "mlb-live", compatibilityDate: "2026-09-01" });
  assert.throws(() => readWorkerConfig('name = "x"'), /compatibility_date/);
});

test("upload, route, and the connector URL", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare();
  const url = await deploy({
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "export default {}",
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, CONNECTOR_URL);
  assert.deepEqual(describeCalls(cloudflare.calls), [
    "GET /accounts/acct123/workers/scripts/mlb-live/deployments",
    "PUT /accounts/acct123/workers/scripts/mlb-live",
    "POST /accounts/acct123/workers/scripts/mlb-live/subdomain",
    "GET /accounts/acct123/workers/subdomain",
    `POST ${CONNECTOR_URL}`,
  ]);

  const form = cloudflare.calls[1].init.body;
  const metadata = JSON.parse(await form.get("metadata").text());
  assert.deepEqual(metadata, {
    main_module: "worker.mjs",
    compatibility_date: "2026-09-01",
    observability: { enabled: true },
  });
  const file = form.get("worker.mjs");
  assert.equal(file.type, "application/javascript+module");
  assert.equal(await file.text(), "export default {}");
  assert.deepEqual(JSON.parse(cloudflare.calls[2].init.body), {
    enabled: true,
    previews_enabled: false,
  });
  assert.equal(JSON.parse(cloudflare.calls[4].init.body).method, "initialize");
});

test("a token is sent only when one is in the environment", async () => {
  const { deploy } = await loadDeployModule();
  // In a cloud session the proxy adds the token; the script must not send its own.
  const proxied = createFakeCloudflare();
  await deploy({
    fetchImpl: proxied.fetchImpl,
    env: ENV,
    script: "",
    log: () => {},
    pause: skipPause,
  });
  assert.ok(proxied.calls.every((request) => !request.init.headers.authorization));

  const local = createFakeCloudflare();
  await deploy({
    fetchImpl: local.fetchImpl,
    env: { ...ENV, CLOUDFLARE_API_TOKEN: "t0k" },
    script: "",
    log: () => {},
    pause: skipPause,
  });
  const [connectorCheck, ...cloudflareCalls] = local.calls.toReversed();
  assert.ok(
    cloudflareCalls.every((request) => request.init.headers.authorization === "Bearer t0k"),
  );
  assert.equal(connectorCheck.url, CONNECTOR_URL);
  assert.equal(
    connectorCheck.init.headers.authorization,
    undefined,
    "the token stays with Cloudflare",
  );
});

test("a refusal names the step and Cloudflare's reason; no account ID is caught first", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ refuse: "/scripts/mlb-live/subdomain" });
  await assert.rejects(
    deploy({
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /workers\.dev route failed: 10000: Authentication error/,
  );
  await assert.rejects(
    deploy({
      fetchImpl: cloudflare.fetchImpl,
      env: {},
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /CLOUDFLARE_ACCOUNT_ID/,
  );
});

test("a refusal that isn't Cloudflare's shows its status, server, and raw body", async () => {
  const { deploy } = await loadDeployModule();
  const refuseAsProxy = async () =>
    new Response("Forbidden by policy\n", { status: 403, headers: { server: "envoy" } });
  await assert.rejects(
    deploy({ fetchImpl: refuseAsProxy, env: ENV, script: "", log: () => {}, pause: skipPause }),
    /^Error: live version failed: HTTP 403 \(server: envoy\): Forbidden by policy$/,
  );
  const answerEmpty = async () => new Response("", { status: 502 });
  await assert.rejects(
    deploy({ fetchImpl: answerEmpty, env: ENV, script: "", log: () => {}, pause: skipPause }),
    /^Error: live version failed: HTTP 502$/,
  );
});

test("a request that carried no token says why, unless the script sent one itself", async () => {
  const { deploy } = await loadDeployModule();
  const refuseWithoutToken = async () =>
    new Response(
      JSON.stringify({
        success: false,
        errors: [
          { code: 9106, message: "Missing X-Auth-Key, X-Auth-Email or Authorization headers" },
        ],
      }),
      { status: 400 },
    );
  await assert.rejects(
    deploy({
      fetchImpl: refuseWithoutToken,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    (/** @type {Error} */ error) =>
      /live version failed: 9106/.test(error.message) &&
      /No token reached Cloudflare/.test(error.message) &&
      /NODE_USE_ENV_PROXY=1/.test(error.message),
  );
  await assert.rejects(
    deploy({
      fetchImpl: refuseWithoutToken,
      env: { ...ENV, CLOUDFLARE_API_TOKEN: "t0k" },
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    (/** @type {Error} */ error) =>
      /live version failed: 9106/.test(error.message) && !/No token reached/.test(error.message),
  );
  const cloudflare = createFakeCloudflare({ refuse: "/scripts/mlb-live" });
  await assert.rejects(
    deploy({
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    (/** @type {Error} */ error) =>
      /Authentication error/.test(error.message) && !/No token reached/.test(error.message),
  );
});

test("a first deploy has no live version to look up", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ isNew: true });
  const url = await deploy({
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, CONNECTOR_URL);
});

test("a connector that doesn't answer puts the live version back", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({
    answerConnector: () => new Response("Worker threw exception", { status: 500 }),
  });
  await assert.rejects(
    deploy({
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /didn't answer, so the earlier version is live again/,
  );
  const calls = describeCalls(cloudflare.calls);
  assert.equal(calls.filter((call) => call === `POST ${CONNECTOR_URL}`).length, 6);
  assert.equal(calls.at(-1), "POST /accounts/acct123/workers/scripts/mlb-live/deployments");
  assert.deepEqual(JSON.parse(cloudflare.calls.at(-1).init.body), {
    strategy: "percentage",
    versions: LIVE_VERSIONS,
  });
});

test("a failed check says so when there's nothing to go back to, or going back fails", async () => {
  const { deploy } = await loadDeployModule();
  const answerConnector = () => new Response("", { status: 404 });
  const brandNew = createFakeCloudflare({ isNew: true, answerConnector });
  await assert.rejects(
    deploy({
      fetchImpl: brandNew.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /didn't answer, and no earlier version exists/,
  );
  assert.ok(
    !describeCalls(brandNew.calls).some((call) =>
      call.startsWith("POST /accounts/acct123/workers/scripts/mlb-live/deployments"),
    ),
  );

  const stuck = createFakeCloudflare({ answerConnector, refuseRollback: true });
  await assert.rejects(
    deploy({ fetchImpl: stuck.fetchImpl, env: ENV, script: "", log: () => {}, pause: skipPause }),
    /the new version is still live: rollback failed: 10000: Authentication error/,
  );
});

test("the check uses the connector key, and never prints it", async () => {
  const { deploy } = await loadDeployModule();
  const answered = createFakeCloudflare();
  await deploy({
    fetchImpl: answered.fetchImpl,
    env: { ...ENV, CONNECTOR_KEY: "s3cret" },
    script: "",
    log: () => {},
    pause: skipPause,
  });
  assert.equal(answered.calls.at(-1).url, `${CONNECTOR_URL}/s3cret`);

  const silent = createFakeCloudflare({ answerConnector: () => new Response("", { status: 404 }) });
  const printed = [];
  await assert.rejects(
    deploy({
      fetchImpl: silent.fetchImpl,
      env: { ...ENV, CONNECTOR_KEY: "s3cret" },
      script: "",
      log: (line) => printed.push(line),
      pause: skipPause,
    }),
    (/** @type {Error} */ error) => !error.message.includes("s3cret"),
  );
  assert.ok(printed.every((line) => !line.includes("s3cret")));
});

function createFakeGit({
  branch = "main",
  dirty = "",
  head = "a".repeat(40),
  origin = "a".repeat(40),
} = {}) {
  const asked = [];
  const answerGitCommand = (args) => {
    asked.push(args.join(" "));
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return branch;
    if (args[0] === "status") return dirty;
    if (args[0] === "fetch") return "";
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? head : origin;
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git: answerGitCommand, asked };
}

test("a release is clean and exactly what GitHub has as main, on any branch", async () => {
  const { checkRelease } = await loadDeployModule();
  const cleanMain = createFakeGit();
  assert.equal(checkRelease(cleanMain.git), "a".repeat(40));
  assert.ok(
    cleanMain.asked.includes("fetch --quiet origin main"),
    "compares against a fresh fetch",
  );
  // A detached checkout reports its branch as HEAD.
  assert.equal(checkRelease(createFakeGit({ branch: "claude/some-branch" }).git), "a".repeat(40));
  assert.equal(checkRelease(createFakeGit({ branch: "HEAD" }).git), "a".repeat(40));
});

test("anything else is refused, with the reason", async () => {
  const { checkRelease } = await loadDeployModule();
  assert.throws(
    () => checkRelease(createFakeGit({ dirty: " M page/js/snapshot.js" }).git),
    /uncommitted changes/,
  );
  assert.throws(
    () => checkRelease(createFakeGit({ head: "b".repeat(40) }).git),
    /isn't main as GitHub has it/,
  );
  assert.throws(
    () => checkRelease(createFakeGit({ branch: "claude/some-branch", head: "b".repeat(40) }).git),
    /claude\/some-branch at bbbbbbb\) isn't main as GitHub has it \(aaaaaaa\)/,
  );
});

test("deploy:api runs the tests before it deploys, and sends its calls through any proxy", () => {
  const scripts = JSON.parse(
    readFileSync(`${import.meta.dirname}/../package.json`, "utf8"),
  ).scripts;
  assert.equal(scripts["deploy:api"], "npm test && NODE_USE_ENV_PROXY=1 node worker/deploy.mjs");
});

test("project settings allow only the checked deploy, and deny the unchecked ones", () => {
  const { permissions } = JSON.parse(
    readFileSync(`${import.meta.dirname}/../.claude/settings.json`, "utf8"),
  );
  assert.deepEqual(permissions.allow, ["Bash(npm run deploy:api)"]);
  for (const rule of [
    "Bash(npm run deploy)",
    "Bash(npx wrangler *)",
    "Bash(wrangler *)",
    "Bash(node worker/deploy.mjs)",
  ]) {
    assert.ok(permissions.deny.includes(rule), rule);
  }
});
