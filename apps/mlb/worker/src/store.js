import { choosePollDelay, POLL_CHECK_MS } from "../../page/js/snapshot.js";
import { findNotableUpdates, listNotifications } from "./notifications.js";
import { createPushService } from "../../../../shared/worker/push.js";
import { describeError, respondError, respondJson } from "../../../../shared/worker/responses.js";
import * as SeasonUpdater from "./season-updater.js";
import { createSnapshotServer } from "./snapshot.js";

// The page's saved data, kept in one Durable Object so every device reads the latest write.
// Documents come back with sorted keys, and a missing one reads as null. The page can read
// any document, but saves only its own fields of a season: each whole, with null removing one.
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

const SEASON_ID = /^\d{4}$/;
const PAGE_FIELDS = {
  ranking: (value) => Array.isArray(value) && value.every((id) => typeof id === "string"),
  seenAt: (value) => typeof value === "string",
};

const isPageField = ([key, value]) =>
  Object.hasOwn(PAGE_FIELDS, key) && (value === null || PAGE_FIELDS[key](value));

function replaceFields(stored, fields) {
  const replaced = { ...stored };
  for (const [key, value] of Object.entries(fields)) {
    if (value === null) delete replaced[key];
    else replaced[key] = value;
  }
  return replaced;
}

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
    if (request.method !== "PATCH")
      return respondError(405, "method_not_allowed", "GET or PATCH only.");
    if (path.collection !== "seasons" || !SEASON_ID.test(path.id))
      return respondError(403, "permission_denied", "Only a season takes changes.");
    return this.savePageFields(key, Number(path.id), request);
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

  // Creating a season here, with no read before it on the page, can't overwrite one the alarm
  // or another device made first.
  async savePageFields(key, year, request) {
    const { body, status, message } = await readObjectBody(request);
    if (!body) return respondError(status, "invalid_argument", message);
    if (!Object.entries(body).every(isPageField))
      return respondError(400, "invalid_argument", "A season takes only ranking and seenAt.");
    const stored = (await this.ctx.storage.get(key)) ?? { year };
    await this.putDoc(key, replaceFields(stored, body));
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
    // The next update's `before` holds what this one saved, so notifying can't wait on the status.
    await this.notifyUpdates(before, snapshot);
    const status = SeasonUpdater.describeSnapshotStatus(snapshot);
    await SeasonUpdater.saveStatus(this.docs, status, this.now());
    return choosePollDelay(snapshot, this.now()) ?? POLL_CHECK_MS;
  }

  // A failed notification never holds up the next update.
  async notifyUpdates(before, snapshot) {
    try {
      const after = await SeasonUpdater.readUpdates(this.docs, snapshot.season);
      const updates = findNotableUpdates({
        before,
        after,
        state: snapshot,
        now: this.now(),
      });
      if (!updates.length) return;
      const context = { teams: snapshot.teams, standings: snapshot.standings };
      await this.push.sendToAll(listNotifications(updates, context));
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
