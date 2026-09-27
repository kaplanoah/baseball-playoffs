import { pollDelay, POLL_CHECK_MS } from "../../page/js/snapshot.js";
import { findNotableEntries, listNotifications } from "./notifications.js";
import { createPushService } from "./push.js";
import * as SeasonUpdater from "./season-updater.js";
import { createSnapshotServer } from "./snapshot.js";

// The page's saved data, kept in one Durable Object so every device reads the latest write.
// Documents come back with sorted keys, update() merges nested objects and replaces anything
// else, a null in an update removes that key, and a removed document reads as null.
// An alarm keeps the current season up to date from MLB while no page is open, and tells
// subscribed devices about new updates.

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LISTED = 100;

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

export function mergeFields(stored, fields) {
  const merged = { ...stored };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete merged[key];
    else if (isPlainObject(value))
      merged[key] = mergeFields(isPlainObject(merged[key]) ? merged[key] : {}, value);
    else merged[key] = value;
  }
  return merged;
}

const respondJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
const respondError = (status, code, message) => respondJson({ error: { code, message } }, status);

async function readObjectBody(request) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return { status: 413, message: "The document is too large." };
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return { status: 413, message: "The document is too large." };
  try {
    const body = JSON.parse(text);
    if (isPlainObject(body)) return { body };
  } catch {
    // Reported below with the same message as any other non-object.
  }
  return { status: 400, message: "The body must be a JSON object." };
}

function readPath(pathname) {
  const [, root, collection, id, ...rest] = pathname.split("/");
  const isValid =
    root === "store" &&
    NAME_PATTERN.test(collection || "") &&
    (id === undefined || NAME_PATTERN.test(id)) &&
    !rest.length;
  return isValid ? { collection, id } : null;
}

function openWatchSocket(ctx) {
  const [client, server] = Object.values(new WebSocketPair());
  ctx.acceptWebSocket(server);
  return new Response(null, { status: 101, webSocket: client });
}

const describeError = (error) => (error instanceof Error ? error.message : String(error));

export class SeasonStore {
  constructor(
    ctx,
    env,
    {
      openSocket = openWatchSocket,
      loadSnapshot = createSnapshotServer().loadSnapshot,
      now = () => Date.now(),
      fetchImpl = (input, init) => fetch(input, init),
    } = {},
  ) {
    this.ctx = ctx;
    this.openSocket = openSocket;
    this.loadSnapshot = loadSnapshot;
    this.now = now;
    this.hasAlarm = false;
    this.failures = 0;
    this.push = createPushService({ storage: ctx.storage, now, fetchImpl });
    this.docs = {
      read: async (key) => (await ctx.storage.get(key)) ?? null,
      list: async (collection) => [
        ...(await ctx.storage.list({ prefix: `${collection}/` })).values(),
      ],
      write: (key, doc) => this.putDoc(key, doc),
      remove: (key) => this.deleteDoc(key),
    };
  }

  async fetch(request) {
    await this.startUpdating();
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/watch") return this.acceptWatcher(request);
    if (pathname.startsWith("/push/")) return this.push.serveRequest(request, pathname);
    const path = readPath(pathname);
    if (!path) return respondError(404, "not_found", "No such path.");
    if (path.id === undefined) {
      if (request.method !== "GET") return respondError(405, "method_not_allowed", "GET only.");
      return this.listDocs(path.collection, searchParams);
    }
    const key = `${path.collection}/${path.id}`;
    if (request.method === "GET") return this.readDoc(key);
    if (request.method === "PUT") return this.replaceDoc(key, request);
    if (request.method === "PATCH") return this.updateDoc(key, request);
    if (request.method === "DELETE") return this.removeDoc(key);
    return respondError(405, "method_not_allowed", "GET, PUT, PATCH, or DELETE only.");
  }

  acceptWatcher(request) {
    if (request.headers.get("upgrade") !== "websocket")
      return respondError(426, "upgrade_required", "Open this path as a WebSocket.");
    return this.openSocket(this.ctx);
  }

  async listDocs(collection, searchParams) {
    const requested = Number(searchParams.get("limit")) || MAX_LISTED;
    const limit = Math.min(Math.max(requested, 1), MAX_LISTED);
    const stored = await this.ctx.storage.list({ prefix: `${collection}/`, limit });
    const docs = [...stored].map(([key, data]) => ({ id: key.slice(collection.length + 1), data }));
    return respondJson({ docs });
  }

  async readDoc(key) {
    const data = await this.ctx.storage.get(key);
    return respondJson({ data: data ?? null });
  }

  async replaceDoc(key, request) {
    const { body, status, message } = await readObjectBody(request);
    if (!body) return respondError(status, "invalid_argument", message);
    return this.saveDoc(key, body);
  }

  async updateDoc(key, request) {
    const { body, status, message } = await readObjectBody(request);
    if (!body) return respondError(status, "invalid_argument", message);
    const stored = await this.ctx.storage.get(key);
    if (stored === undefined)
      return respondError(404, "invalid_argument", "Update needs a document that exists.");
    return this.saveDoc(key, mergeFields(stored, body));
  }

  async saveDoc(key, doc) {
    await this.putDoc(key, doc);
    return new Response(null, { status: 204 });
  }

  async removeDoc(key) {
    await this.deleteDoc(key);
    return new Response(null, { status: 204 });
  }

  async putDoc(key, doc) {
    const data = sortKeys(doc);
    await this.ctx.storage.put(key, data);
    this.announceChange(key, data);
  }

  async deleteDoc(key) {
    await this.ctx.storage.delete(key);
    this.announceChange(key, null);
  }

  // A stored alarm outlives deploys, so this starts the updates only the first time.
  async startUpdating() {
    if (this.hasAlarm) return;
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(this.now());
    this.hasAlarm = true;
  }

  async alarm() {
    let delay = SeasonUpdater.RETRY_MS[0];
    try {
      delay = await this.updateSeason();
    } catch (error) {
      // Cloudflare would retry a failed alarm on its own schedule, on top of the one set here.
      console.error(`The season update failed: ${describeError(error)}`);
    }
    await this.ctx.storage.setAlarm(this.now() + delay);
  }

  // Returns how long to wait before the next update.
  async updateSeason() {
    let snapshot;
    try {
      snapshot = await SeasonUpdater.loadCurrentSnapshot(this.loadSnapshot, this.now());
    } catch (error) {
      return this.recordFailure({ error: "upstream_error", detail: describeError(error) });
    }
    let before;
    try {
      before = await SeasonUpdater.readUpdates(this.docs, snapshot.season);
      await SeasonUpdater.saveSnapshot(this.docs, snapshot);
    } catch (error) {
      return this.recordFailure({ write: describeError(error) });
    }
    this.failures = 0;
    const status = SeasonUpdater.describeSnapshotStatus(snapshot);
    await SeasonUpdater.saveStatus(this.docs, status, this.now());
    await this.notifyUpdates(before, snapshot);
    return pollDelay(snapshot, this.now()) ?? POLL_CHECK_MS;
  }

  // A failed notification never holds up the next update.
  async notifyUpdates(before, snapshot) {
    try {
      const after = await SeasonUpdater.readUpdates(this.docs, snapshot.season);
      const entries = findNotableEntries({
        before: before.log,
        after: after.log,
        ranking: after.ranking,
        state: snapshot,
        now: this.now(),
      });
      if (!entries.length) return;
      const context = { teams: snapshot.teams, standings: snapshot.standings };
      await this.push.sendToAll(listNotifications(entries, context));
    } catch (error) {
      console.error(`Notifying failed: ${describeError(error)}`);
    }
  }

  async recordFailure(status) {
    const retries = SeasonUpdater.RETRY_MS;
    const delay = retries[Math.min(this.failures, retries.length - 1)];
    this.failures += 1;
    await SeasonUpdater.saveStatus(this.docs, status, this.now());
    return delay;
  }

  announceChange(path, data) {
    const message = JSON.stringify({ path, data });
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
      } catch {
        // A socket that closed mid-send reconnects and reads the document again.
      }
    }
  }
}

// Only the page's own origin talks to the store, so it gets no CORS headers.
export function forwardToStore(request, env, storePath) {
  const url = new URL(request.url);
  url.pathname = storePath;
  const store = env.STORE.get(env.STORE.idFromName("store"));
  return store.fetch(new Request(url, request));
}
