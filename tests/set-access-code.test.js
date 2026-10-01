import test from "node:test";
import assert from "node:assert/strict";
import { setAccessCode } from "../worker/set-access-code.mjs";

const ENV = { CLOUDFLARE_ACCOUNT_ID: "acct123" };
const SECRETS_URL =
  "https://api.cloudflare.com/client/v4/accounts/acct123/workers/scripts/wnba-app/secrets";

function createFakeCloudflare({ secrets = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const result = url.endsWith("/secrets") && init.method === "GET" ? secrets : {};
    return new Response(JSON.stringify({ success: true, result }));
  };
  return { fetchImpl, calls };
}

const changeCode = (cloudflare, options) =>
  setAccessCode({
    app: "wnba",
    fetchImpl: cloudflare.fetchImpl,
    env: ENV,
    log: () => {},
    ...options,
  });

test("the code is stored as the Worker's ACCESS_CODE secret", async () => {
  const cloudflare = createFakeCloudflare();
  await changeCode(cloudflare, { code: "fast break" });
  const [put] = cloudflare.calls;
  assert.equal(put.url, SECRETS_URL);
  assert.equal(put.init.method, "PUT");
  assert.deepEqual(JSON.parse(put.init.body), {
    name: "ACCESS_CODE",
    text: "fast break",
    type: "secret_text",
  });
});

test("a code too short to guard the page, or none, is refused before Cloudflare hears of it", async () => {
  for (const code of [undefined, "", "a-b c"]) {
    const cloudflare = createFakeCloudflare();
    await assert.rejects(changeCode(cloudflare, { code }), /at least 4 letters or digits/);
    assert.equal(cloudflare.calls.length, 0);
  }
});

test("an app whose page has no gate can't be given a code", async () => {
  const cloudflare = createFakeCloudflare();
  await assert.rejects(changeCode(cloudflare, { app: "mlb", code: "FASTBREAK" }), /no gate\.html/);
  assert.equal(cloudflare.calls.length, 0);
});

test("--remove deletes the code, and does nothing when there's none", async () => {
  const set = createFakeCloudflare({ secrets: [{ name: "ACCESS_CODE", type: "secret_text" }] });
  await changeCode(set, { isRemoving: true });
  const removal = set.calls.find((call) => call.init.method === "DELETE");
  assert.equal(removal.url, `${SECRETS_URL}/ACCESS_CODE`);

  const unset = createFakeCloudflare();
  const printed = [];
  await changeCode(unset, { isRemoving: true, log: (line) => printed.push(line) });
  assert.ok(!unset.calls.some((call) => call.init.method === "DELETE"));
  assert.ok(printed.includes("The page asks for no code."));
});
