import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const loadDeployModule = () => import("../worker/deploy.mjs");
const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };

const API = "https://api.cloudflare.com/client/v4";
const WORKER_URL = "https://mlb-live.example-subdomain.workers.dev/";
const ROBOTS_URL = `${WORKER_URL}robots.txt`;
const LIVE_VERSIONS = [{ version_id: "v-live", percentage: 100 }];
const LIVE_COMMIT = "1".repeat(40);
const NEW_COMMIT = "2".repeat(40);
const LIVE_DEPLOYMENTS = [
  { created_on: "2026-09-24T10:00:00Z", versions: [{ version_id: "v-older", percentage: 100 }] },
  { created_on: "2026-09-25T10:00:00Z", versions: LIVE_VERSIONS },
];
const ANSWER_ROBOTS = () => new Response("User-agent: *\nDisallow: /\n");
const skipPause = async () => {};

/**
 * @param {{ refuse?: string, isNew?: boolean, answerWorker?: () => Response, refuseRollback?: boolean, migrationTag?: string, liveCommit?: string }} [options]
 */
function createFakeCloudflare({
  refuse,
  isNew = false,
  answerWorker = ANSWER_ROBOTS,
  refuseRollback = false,
  migrationTag,
  liveCommit,
} = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (!url.startsWith(API)) return answerWorker();
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
    if (url.endsWith("/workers/subdomain")) result = { subdomain: "example-subdomain" };
    if (url.endsWith("/workers/scripts"))
      result = isNew ? [] : [{ id: "mlb-live", migration_tag: migrationTag }];
    if (isDeployments && init.method === "GET") result = { deployments: LIVE_DEPLOYMENTS };
    if (url.endsWith("/versions/v-live"))
      result = { id: "v-live", annotations: liveCommit ? { "workers/message": liveCommit } : {} };
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}

const describeCalls = (calls) =>
  calls.map((request) => `${request.init.method} ${request.url.replace(API, "")}`);

test("the name and compatibility date come from wrangler.toml", async () => {
  const { readAppWorkerConfig, readWorkerConfig } = await loadDeployModule();
  assert.deepEqual(readAppWorkerConfig("mlb"), {
    name: "mlb-live",
    compatibilityDate: "2026-09-01",
  });
  assert.throws(() => readWorkerConfig('name = "x"'), /compatibility_date/);
});

test("upload, route, and the Worker URL", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare();
  const url = await deploy({
    app: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "export default {}",
    commit: NEW_COMMIT,
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, WORKER_URL);
  assert.deepEqual(describeCalls(cloudflare.calls), [
    "GET /accounts/acct123/workers/scripts/mlb-live/deployments",
    "GET /accounts/acct123/workers/scripts/mlb-live/versions/v-live",
    "GET /accounts/acct123/workers/scripts",
    "PUT /accounts/acct123/workers/scripts/mlb-live",
    "POST /accounts/acct123/workers/scripts/mlb-live/subdomain",
    "GET /accounts/acct123/workers/subdomain",
    `GET ${ROBOTS_URL}`,
  ]);

  const form = cloudflare.calls[3].init.body;
  const metadata = JSON.parse(await form.get("metadata").text());
  assert.deepEqual(metadata, {
    main_module: "worker.mjs",
    compatibility_date: "2026-09-01",
    observability: { enabled: true },
    bindings: [{ type: "durable_object_namespace", name: "STORE", class_name: "SeasonStore" }],
    keep_bindings: ["secret_text"],
    annotations: { "workers/message": NEW_COMMIT },
    migrations: { new_tag: "v1", steps: [{ new_sqlite_classes: ["SeasonStore"] }] },
  });
  const file = form.get("worker.mjs");
  assert.equal(file.type, "application/javascript+module");
  assert.equal(await file.text(), "export default {}");
  assert.deepEqual(JSON.parse(cloudflare.calls[4].init.body), {
    enabled: true,
    previews_enabled: false,
  });
});

test("nothing is uploaded when nothing the Worker runs changed since the live version", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ liveCommit: LIVE_COMMIT });
  const asked = [];
  const lines = [];
  const url = await deploy({
    app: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    commit: NEW_COMMIT,
    findChanges: (since) => {
      asked.push(since);
      return ["README.md", "apps/mlb/tests/store.test.js"];
    },
    log: (line) => lines.push(line),
    pause: skipPause,
  });
  assert.equal(url, null);
  assert.deepEqual(asked, [LIVE_COMMIT]);
  assert.ok(!describeCalls(cloudflare.calls).some((call) => call.startsWith("PUT ")));
  assert.match(lines.at(-1), /Nothing the Worker runs changed since the live version/);
});

test("every change since the live version counts, not just the last merge's", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ liveCommit: LIVE_COMMIT });
  const url = await deploy({
    app: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    commit: NEW_COMMIT,
    findChanges: () => ["apps/mlb/worker/src/store.js", "README.md"],
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, WORKER_URL);
  assert.ok(
    describeCalls(cloudflare.calls).includes("PUT /accounts/acct123/workers/scripts/mlb-live"),
  );
});

test("a live version with no recorded commit, or changes that can't be listed, deploy", async () => {
  const { deploy } = await loadDeployModule();
  /** @param {string | undefined} liveCommit @param {string[] | null} changes */
  const deployWith = (liveCommit, changes) =>
    deploy({
      app: "mlb",
      fetchImpl: createFakeCloudflare({ liveCommit }).fetchImpl,
      env: ENV,
      script: "",
      commit: NEW_COMMIT,
      findChanges: () => changes,
      log: () => {},
      pause: skipPause,
    });
  assert.equal(await deployWith(undefined, []), WORKER_URL);
  assert.equal(await deployWith(LIVE_COMMIT, null), WORKER_URL);
});

test("a migration already applied isn't sent again", async () => {
  const { deploy, listPendingMigrations } = await loadDeployModule();
  assert.equal(listPendingMigrations("v1"), null);
  assert.deepEqual(listPendingMigrations(undefined), {
    old_tag: undefined,
    new_tag: "v1",
    steps: [{ new_sqlite_classes: ["SeasonStore"] }],
  });

  const cloudflare = createFakeCloudflare({ migrationTag: "v1" });
  await deploy({
    app: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    log: () => {},
    pause: skipPause,
  });
  const metadata = JSON.parse(await cloudflare.calls[3].init.body.get("metadata").text());
  assert.equal(metadata.migrations, undefined);
});

test("wrangler.toml declares the same store binding and migrations", async () => {
  const { MIGRATIONS } = await loadDeployModule();
  const toml = readFileSync(`${import.meta.dirname}/../apps/mlb/worker/wrangler.toml`, "utf8");
  assert.match(
    toml,
    /\[\[durable_objects\.bindings\]\]\nname = "STORE"\nclass_name = "SeasonStore"/,
  );
  for (const { tag, new_sqlite_classes: classes } of MIGRATIONS) {
    const declared = `[[migrations]]\ntag = "${tag}"\nnew_sqlite_classes = ${JSON.stringify(classes)}`;
    assert.ok(toml.includes(declared), declared);
  }
});

test("a token is sent only when one is in the environment", async () => {
  const { deploy } = await loadDeployModule();
  // In a cloud session the proxy adds the token; the script must not send its own.
  const proxied = createFakeCloudflare();
  await deploy({
    app: "mlb",
    fetchImpl: proxied.fetchImpl,
    env: ENV,
    script: "",
    log: () => {},
    pause: skipPause,
  });
  assert.ok(proxied.calls.every((request) => !request.init.headers?.authorization));

  const local = createFakeCloudflare();
  await deploy({
    app: "mlb",
    fetchImpl: local.fetchImpl,
    env: { ...ENV, CLOUDFLARE_API_TOKEN: "t0k" },
    script: "",
    log: () => {},
    pause: skipPause,
  });
  const [workerCheck, ...cloudflareCalls] = local.calls.toReversed();
  assert.ok(
    cloudflareCalls.every((request) => request.init.headers.authorization === "Bearer t0k"),
  );
  assert.equal(workerCheck.url, ROBOTS_URL);
  assert.equal(workerCheck.init.headers, undefined, "the token stays with Cloudflare");
});

test("a refusal names the step and Cloudflare's reason; no account ID is caught first", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ refuse: "/scripts/mlb-live/subdomain" });
  await assert.rejects(
    deploy({
      app: "mlb",
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
      app: "mlb",
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
    deploy({
      app: "mlb",
      fetchImpl: refuseAsProxy,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /^Error: live version failed: HTTP 403 \(server: envoy\): Forbidden by policy$/,
  );
  const answerEmpty = async () => new Response("", { status: 502 });
  await assert.rejects(
    deploy({
      app: "mlb",
      fetchImpl: answerEmpty,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
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
      app: "mlb",
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
      app: "mlb",
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
      app: "mlb",
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
    app: "mlb",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    script: "",
    log: () => {},
    pause: skipPause,
  });
  assert.equal(url, WORKER_URL);
});

test("the log and errors never show the Worker's address", async () => {
  const { deploy } = await loadDeployModule();
  const lines = [];
  const logLine = (line) => lines.push(line);
  await deploy({
    app: "mlb",
    fetchImpl: createFakeCloudflare().fetchImpl,
    env: ENV,
    script: "",
    log: logLine,
    pause: skipPause,
  });
  const silent = createFakeCloudflare({ answerWorker: () => new Response("", { status: 500 }) });
  const failure = await deploy({
    app: "mlb",
    fetchImpl: silent.fetchImpl,
    env: ENV,
    script: "",
    log: logLine,
    pause: skipPause,
  }).catch((error) => error);
  lines.push(failure.message);
  assert.ok(lines.includes("worker check: ok"));
  assert.match(failure.message, /the earlier version is live again/);
  assert.deepEqual(
    lines.filter((line) => line.includes("example-subdomain")),
    [],
  );
});

test("a Worker that doesn't answer puts the live version back", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({
    answerWorker: () => new Response("Worker threw exception", { status: 500 }),
  });
  await assert.rejects(
    deploy({
      app: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /didn't answer, so the earlier version is live again/,
  );
  const calls = describeCalls(cloudflare.calls);
  assert.equal(calls.filter((call) => call === `GET ${ROBOTS_URL}`).length, 6);
  assert.equal(calls.at(-1), "POST /accounts/acct123/workers/scripts/mlb-live/deployments");
  assert.deepEqual(JSON.parse(cloudflare.calls.at(-1).init.body), {
    strategy: "percentage",
    versions: LIVE_VERSIONS,
  });
});

test("a failed check says so when there's nothing to go back to, or going back fails", async () => {
  const { deploy } = await loadDeployModule();
  const answerWorker = () => new Response("", { status: 404 });
  const brandNew = createFakeCloudflare({ isNew: true, answerWorker });
  await assert.rejects(
    deploy({
      app: "mlb",
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

  const stuck = createFakeCloudflare({ answerWorker, refuseRollback: true });
  await assert.rejects(
    deploy({
      app: "mlb",
      fetchImpl: stuck.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /the new version is still live: rollback failed: 10000: Authentication error/,
  );
});

test("a step that fails after the upload puts the live version back", async () => {
  const { deploy } = await loadDeployModule();
  const cloudflare = createFakeCloudflare({ refuse: "/mlb-live/subdomain" });
  await assert.rejects(
    deploy({
      app: "mlb",
      fetchImpl: cloudflare.fetchImpl,
      env: ENV,
      script: "",
      log: () => {},
      pause: skipPause,
    }),
    /workers.dev route failed: 10000: Authentication error, so the earlier version is live again/,
  );
  const calls = describeCalls(cloudflare.calls);
  assert.equal(calls.at(-1), "POST /accounts/acct123/workers/scripts/mlb-live/deployments");
  assert.deepEqual(JSON.parse(cloudflare.calls.at(-1).init.body).versions, LIVE_VERSIONS);
});

function createFakeGit({
  branch = "main",
  dirty = "",
  head = "a".repeat(40),
  origin = "a".repeat(40),
  isBehind = false,
} = {}) {
  const asked = [];
  const answerGitCommand = (args) => {
    asked.push(args.join(" "));
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return branch;
    if (args[0] === "status") return dirty;
    if (args[0] === "fetch") return "";
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? head : origin;
    if (args[0] === "merge-base") {
      if (isBehind) return "";
      throw new Error("not an ancestor");
    }
    throw new Error(`unexpected git ${args.join(" ")}`);
  };
  return { git: answerGitCommand, asked };
}

test("a release is clean and exactly what GitHub has as main, on any branch", async () => {
  const { checkRelease } = await loadDeployModule();
  const cleanMain = createFakeGit();
  const release = { commit: "a".repeat(40), newerMain: null };
  assert.deepEqual(checkRelease(cleanMain.git), release);
  assert.ok(
    cleanMain.asked.includes("fetch --quiet origin main"),
    "compares against a fresh fetch",
  );
  // A detached checkout reports its branch as HEAD.
  assert.deepEqual(checkRelease(createFakeGit({ branch: "claude/some-branch" }).git), release);
  assert.deepEqual(checkRelease(createFakeGit({ branch: "HEAD" }).git), release);
});

test("a merged commit that main has moved past names the newer main instead", async () => {
  const { checkRelease } = await loadDeployModule();
  const behind = createFakeGit({ branch: "HEAD", head: "b".repeat(40), isBehind: true });
  assert.deepEqual(checkRelease(behind.git), { commit: "b".repeat(40), newerMain: "a".repeat(40) });
  assert.ok(behind.asked.includes(`merge-base --is-ancestor ${"b".repeat(40)} ${"a".repeat(40)}`));
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

test("project settings allow only the checked scripts, and deny running them any other way", () => {
  const { permissions } = JSON.parse(
    readFileSync(`${import.meta.dirname}/../.claude/settings.json`, "utf8"),
  );
  assert.deepEqual(permissions.allow, [
    "Bash(npm run deploy:api)",
    "Bash(npm run deploy:api -- *)",
    "Bash(npm run set-app-key -- *)",
  ]);
  for (const rule of [
    "Bash(npm run deploy)",
    "Bash(npx wrangler *)",
    "Bash(wrangler *)",
    "Bash(node worker/deploy.mjs)",
    "Bash(node worker/set-app-key.mjs)",
  ]) {
    assert.ok(permissions.deny.includes(rule), rule);
  }
});
