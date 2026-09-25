// The page's saved data, kept in one Durable Object so every device reads the latest write.
// It follows the artifact store's rules: documents come back with sorted keys, update() merges
// nested objects and replaces anything else, and a null in an update removes that key.

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_LISTED = 100;

const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

export function sortKeys(value) {
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

export class SeasonStore {
  constructor(ctx, env, { openSocket = openWatchSocket } = {}) {
    this.ctx = ctx;
    this.openSocket = openSocket;
  }

  async fetch(request) {
    const { pathname, searchParams } = new URL(request.url);
    if (pathname === "/watch") return this.acceptWatcher(request);
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
    return respondError(405, "method_not_allowed", "GET, PUT, or PATCH only.");
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
    const data = sortKeys(doc);
    await this.ctx.storage.put(key, data);
    this.announceChange(key, data);
    return new Response(null, { status: 204 });
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
