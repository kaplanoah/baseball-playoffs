import test from "node:test";
import assert from "node:assert/strict";
import { createKey, setAppKey } from "../worker/set-app-key.mjs";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };
const API = "https://api.cloudflare.com/client/v4/accounts/acct123/workers";

function createFakeCloudflare({ secrets = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    let result = {};
    if (url.endsWith("/secrets") && init.method === "GET") result = secrets;
    if (url.endsWith("/workers/subdomain")) result = { subdomain: "nokap" };
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}

test("a new key is stored as a secret, and the page's address is printed", async () => {
  const cloudflare = createFakeCloudflare();
  const printed = [];
  const url = await setAppKey({
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    log: (line) => printed.push(line),
    makeKey: () => "n3wkey",
  });
  assert.equal(url, "https://mlb-live.nokap.workers.dev/n3wkey/");
  const put = cloudflare.calls.find((call) => call.init.method === "PUT");
  assert.equal(put.url, `${API}/scripts/mlb-live/secrets`);
  assert.deepEqual(JSON.parse(put.init.body), {
    name: "APP_KEY",
    text: "n3wkey",
    type: "secret_text",
  });
  assert.ok(printed.includes(`Page address: ${url}`));
});

test("an existing key is replaced only when asked to rotate", async () => {
  const secrets = [{ name: "APP_KEY", type: "secret_text" }];
  const kept = createFakeCloudflare({ secrets });
  await assert.rejects(
    setAppKey({ fetchImpl: kept.fetchImpl, env: ENV, log: () => {} }),
    /already has an APP_KEY.*--rotate/s,
  );
  assert.ok(!kept.calls.some((call) => call.init.method === "PUT"));

  const rotated = createFakeCloudflare({ secrets });
  await setAppKey({ fetchImpl: rotated.fetchImpl, env: ENV, log: () => {}, isRotating: true });
  assert.ok(rotated.calls.some((call) => call.init.method === "PUT"));
});

test("keys are long, random, and safe in an address", () => {
  const keys = new Set(Array.from({ length: 20 }, createKey));
  assert.equal(keys.size, 20);
  for (const key of keys) assert.match(key, /^[A-Za-z0-9_-]{32}$/);
});
