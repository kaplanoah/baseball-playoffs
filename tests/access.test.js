import test from "node:test";
import assert from "node:assert/strict";
import { reloadWhenSignedOut } from "#shared/access.js";

/** @param {string[]} events */
function watchReloads(events) {
  globalThis.location = /** @type {any} */ ({ reload: () => events.push("reload") });
}

test("a page turned away for want of the access code forgets its offline copy, then reloads", async (t) => {
  const events = [];
  const kept = new Set(["page"]);
  globalThis.caches = /** @type {any} */ ({
    keys: async () => [...kept],
    delete: async (name) => events.push(`forget ${name}`) && kept.delete(name),
  });
  watchReloads(events);
  t.after(() => {
    delete globalThis.caches;
    delete globalThis.location;
  });

  await reloadWhenSignedOut(new Response(null, { status: 200 }));
  assert.deepEqual(events, []);

  await reloadWhenSignedOut(new Response(null, { status: 401 }));
  assert.deepEqual(events, ["forget page", "reload"]);
});

test("a browser without the cache API still reloads a page turned away", async (t) => {
  const events = [];
  watchReloads(events);
  t.after(() => delete globalThis.location);

  await reloadWhenSignedOut(new Response(null, { status: 401 }));

  assert.deepEqual(events, ["reload"]);
});
