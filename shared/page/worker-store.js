// The page's saved data, kept by the Worker that serves the page and pushed to it as it changes.
import { reloadWhenSignedOut } from "./access.js";
import { noteStep } from "./diagnostics.js";

const RECONNECT_FIRST_MS = 1000;
const RECONNECT_MAX_MS = 30 * 1000;
// A proxy or captive portal can hold a socket's handshake open without ever answering it.
const HANDSHAKE_WAIT_MS = 3 * 1000;

class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// Documents come back read-only, so the page copies before it changes one.
function freezeDeeply(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeeply);
    Object.freeze(value);
  }
  return value;
}

function createSnapshot(id, data) {
  const frozen = freezeDeeply(data ?? null);
  return { id, exists: frozen !== null, data: () => frozen ?? undefined };
}

const readId = (path) => path.slice(path.lastIndexOf("/") + 1);
const readCollectionName = (path) => path.slice(0, path.lastIndexOf("/"));
const compareIds = ([first], [second]) => (first < second ? -1 : 1);

async function requestJson(url, init = {}) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch (error) {
    throw new StoreError("unavailable", error instanceof Error ? error.message : String(error));
  }
  reloadWhenSignedOut(response);
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new StoreError(
      body?.error?.code || `http_${response.status}`,
      body?.error?.message || `The store answered ${response.status}.`,
    );
  // Something between the page and the Worker, like a captive portal, can answer instead.
  if (!body || typeof body !== "object")
    throw new StoreError("bad_payload", "The store's answer couldn't be read.");
  return body;
}

async function readData(url) {
  const body = await requestJson(url);
  if (!("data" in body)) throw new StoreError("bad_payload", "The store's answer had no document.");
  return body.data;
}

async function readDocs(url) {
  const body = await requestJson(url);
  if (!Array.isArray(body.docs))
    throw new StoreError("bad_payload", "The store's answer had no documents.");
  return body.docs;
}

const sendJson = (method, data) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

export function createWorkerStore(baseUrl = new URL("./", location.href)) {
  const listenersByPath = new Map();
  // Each watched collection keeps its documents by id, so a push changes one without a new listing.
  const collectionWatches = new Map();
  let socket = null;
  let isSocketOpen = false;
  let handshakeTimer = null;
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_FIRST_MS;
  // Reads overlap, so one that started before a pushed change, or before a read that already
  // arrived, must not replace it with older data.
  let clock = 0;
  const deliveredAt = new Map();

  const findUrl = (path) => new URL(`store/${path}`, baseUrl);
  const findListUrl = (name, count) => new URL(`store/${name}?limit=${count}`, baseUrl);
  const hasWatchers = () => listenersByPath.size > 0 || collectionWatches.size > 0;

  function deliverSnapshot(path, snapshot) {
    noteStep(`Store sent ${path}${snapshot.exists ? "" : ", not found"}`);
    for (const listener of listenersByPath.get(path) || []) listener.onNext(snapshot);
  }

  function deliverError(path, error) {
    noteStep(`Store couldn't read ${path}`);
    for (const listener of listenersByPath.get(path) || []) listener.onError(error);
  }

  async function readSnapshot(path) {
    return createSnapshot(readId(path), await readData(findUrl(path)));
  }

  async function refreshPath(path) {
    const startedAt = ++clock;
    try {
      const snapshot = await readSnapshot(path);
      if ((deliveredAt.get(path) || 0) > startedAt) return;
      deliveredAt.set(path, startedAt);
      deliverSnapshot(path, snapshot);
    } catch (error) {
      deliverError(path, error);
    }
  }

  function deliverCollection(watch) {
    const docs = [...watch.docsById].sort(compareIds).map(([id, data]) => createSnapshot(id, data));
    noteStep(`Store sent ${watch.name}, ${docs.length} in all`);
    for (const listener of watch.listeners) listener.onNext({ docs });
  }

  async function refreshCollection(name) {
    const watch = collectionWatches.get(name);
    const startedAt = ++clock;
    try {
      const docs = await readDocs(findListUrl(name, watch.limit));
      if (collectionWatches.get(name) !== watch || watch.listedAt > startedAt) return;
      watch.listedAt = startedAt;
      const docsById = new Map(docs.map(({ id, data }) => [id, data]));
      for (const [id, pushed] of watch.pushes) {
        if (pushed.at < startedAt) continue;
        if (pushed.data === null) docsById.delete(id);
        else docsById.set(id, pushed.data);
      }
      watch.docsById = docsById;
      deliverCollection(watch);
    } catch (error) {
      for (const listener of watch.listeners) listener.onError(error);
    }
  }

  // The Worker sends the page only changes to what it watches, so the page says what that is as
  // its socket opens and whenever it changes.
  function sendWatching() {
    if (!isSocketOpen) return;
    const collections = [...collectionWatches.keys()].map((name) => `${name}/`);
    try {
      socket.send(JSON.stringify({ watching: [...listenersByPath.keys(), ...collections] }));
    } catch {
      // A socket that closed mid-send reconnects and says it again.
    }
  }

  const refreshWatchedPaths = () =>
    Promise.all([
      ...[...listenersByPath.keys()].map(refreshPath),
      ...[...collectionWatches.keys()].map(refreshCollection),
    ]);

  // Before the first listing arrives, the listing takes the push in instead.
  function applyCollectionPush(path, data) {
    const watch = collectionWatches.get(readCollectionName(path));
    if (!watch) return;
    const id = readId(path);
    watch.pushes.set(id, { at: clock, data });
    if (!watch.docsById) return;
    if (data === null) watch.docsById.delete(id);
    else watch.docsById.set(id, data);
    deliverCollection(watch);
  }

  function receivePush(event) {
    const { path, data } = JSON.parse(event.data);
    deliveredAt.set(path, ++clock);
    deliverSnapshot(path, createSnapshot(readId(path), data));
    applyCollectionPush(path, data);
  }

  // While the socket is down, each reconnect attempt also reads the watched documents again.
  function scheduleReconnect() {
    socket = null;
    isSocketOpen = false;
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
    if (reconnectTimer || !hasWatchers()) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      refreshWatchedPaths();
      openSocket();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  function openSocket() {
    const url = new URL("watch", baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    const opened = new WebSocket(url);
    socket = opened;
    isSocketOpen = false;
    clearTimeout(handshakeTimer);
    handshakeTimer = setTimeout(() => {
      handshakeTimer = null;
      refreshWatchedPaths();
    }, HANDSHAKE_WAIT_MS);
    opened.addEventListener("open", () => {
      if (socket !== opened) return;
      noteStep("Store connected");
      isSocketOpen = true;
      clearTimeout(handshakeTimer);
      handshakeTimer = null;
      reconnectDelay = RECONNECT_FIRST_MS;
      sendWatching();
      refreshWatchedPaths();
    });
    opened.addEventListener("message", receivePush);
    opened.addEventListener("close", () => {
      noteStep("Store connection closed");
      if (socket === opened) scheduleReconnect();
    });
  }

  // A phone suspends a page in the background, and its socket can still look open after the
  // connection is gone, never to push again, so a page coming back reads again as a new socket
  // opens.
  function catchUp() {
    if (!hasWatchers()) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectDelay = RECONNECT_FIRST_MS;
    const stale = socket;
    socket = null;
    isSocketOpen = false;
    stale?.close();
    openSocket();
  }

  // A page no one is looking at closes its socket, so the Worker can update less often, and
  // catches up when it's back.
  function pause() {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    clearTimeout(handshakeTimer);
    handshakeTimer = null;
    const open = socket;
    socket = null;
    isSocketOpen = false;
    open?.close();
  }

  // A read sent before the socket opens can miss a change saved before the socket could hear of
  // it, so while a socket's handshake is under way, the read waits for the one the socket makes
  // as it opens, or for the one made once the handshake has taken too long.
  function readWhenWatching(refresh) {
    if (!socket && !reconnectTimer) openSocket();
    else if (!handshakeTimer) refresh();
  }

  function watchPath(path, onNext, onError) {
    const listener = { onNext, onError };
    if (!listenersByPath.has(path)) {
      listenersByPath.set(path, new Set());
      sendWatching();
    }
    listenersByPath.get(path).add(listener);
    readWhenWatching(() => refreshPath(path));
    return () => {
      const listeners = listenersByPath.get(path);
      listeners?.delete(listener);
      if (listeners && !listeners.size) {
        listenersByPath.delete(path);
        sendWatching();
      }
    };
  }

  function watchCollection(name, limit, onNext, onError) {
    const listener = { onNext, onError };
    if (!collectionWatches.has(name)) {
      collectionWatches.set(name, {
        name,
        limit,
        listeners: new Set(),
        docsById: null,
        listedAt: 0,
        pushes: new Map(),
      });
      sendWatching();
    }
    collectionWatches.get(name).listeners.add(listener);
    readWhenWatching(() => refreshCollection(name));
    return () => {
      const watch = collectionWatches.get(name);
      watch?.listeners.delete(listener);
      if (watch && !watch.listeners.size) {
        collectionWatches.delete(name);
        sendWatching();
      }
    };
  }

  async function updateDoc(path, data) {
    await requestJson(findUrl(path), sendJson("PATCH", data));
  }

  function doc(path) {
    return {
      id: readId(path),
      path,
      get: () => readSnapshot(path),
      update: (data) => updateDoc(path, data),
      onSnapshot: (onNext, onError = () => {}) => watchPath(path, onNext, onError),
    };
  }

  function collection(name) {
    return {
      limit: (count) => ({
        get: async () => {
          const docs = await readDocs(findListUrl(name, count));
          return { docs: docs.map(({ id, data }) => createSnapshot(id, data)) };
        },
        onSnapshot: (onNext, onError = () => {}) => watchCollection(name, count, onNext, onError),
      }),
    };
  }

  return { doc, collection, catchUp, pause };
}
