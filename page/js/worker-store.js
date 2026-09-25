// The artifact store's calls, answered by the Worker that serves the self-hosted page.

const RECONNECT_FIRST_MS = 1000;
const RECONNECT_MAX_MS = 30 * 1000;

export const isSelfHosted = () => !!document.querySelector('meta[name="store"][content="worker"]');

class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// The artifact store hands documents back read-only, and the page relies on copying them.
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

async function requestJson(url, init = {}) {
  let response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch (error) {
    throw new StoreError("unavailable", error instanceof Error ? error.message : String(error));
  }
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new StoreError(
      body.error?.code || `http_${response.status}`,
      body.error?.message || `The store answered ${response.status}.`,
    );
  return body;
}

const sendJson = (method, data) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(data),
});

export function createWorkerStore(baseUrl = new URL("./", location.href)) {
  const listenersByPath = new Map();
  let socket = null;
  let reconnectTimer = null;
  let reconnectDelay = RECONNECT_FIRST_MS;
  // A read that started before a pushed change must not replace it with older data.
  let clock = 0;
  const pushedAt = new Map();

  const findUrl = (path) => new URL(`store/${path}`, baseUrl);

  function deliverSnapshot(path, snapshot) {
    for (const listener of listenersByPath.get(path) || []) listener.onNext(snapshot);
  }

  function deliverError(path, error) {
    for (const listener of listenersByPath.get(path) || []) listener.onError(error);
  }

  async function readSnapshot(path) {
    const { data } = await requestJson(findUrl(path));
    return createSnapshot(readId(path), data);
  }

  async function refreshPath(path) {
    const startedAt = ++clock;
    try {
      const snapshot = await readSnapshot(path);
      if ((pushedAt.get(path) || 0) < startedAt) deliverSnapshot(path, snapshot);
    } catch (error) {
      deliverError(path, error);
    }
  }

  const refreshWatchedPaths = () => Promise.all([...listenersByPath.keys()].map(refreshPath));

  function receivePush(event) {
    const { path, data } = JSON.parse(event.data);
    pushedAt.set(path, ++clock);
    deliverSnapshot(path, createSnapshot(readId(path), data));
  }

  // While the socket is down, each reconnect attempt also reads the watched documents again.
  function scheduleReconnect() {
    socket = null;
    if (reconnectTimer || !listenersByPath.size) return;
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
    opened.addEventListener("open", () => {
      reconnectDelay = RECONNECT_FIRST_MS;
      refreshWatchedPaths();
    });
    opened.addEventListener("message", receivePush);
    opened.addEventListener("close", () => {
      if (socket === opened) scheduleReconnect();
    });
  }

  // A phone suspends a page in the background, and its socket can still look open after
  // missing pushes, so coming back always reads again, and reconnects at once if needed.
  function catchUpWhenVisible() {
    if (document.hidden || !listenersByPath.size) return;
    refreshWatchedPaths();
    if (socket) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectDelay = RECONNECT_FIRST_MS;
    openSocket();
  }
  document.addEventListener("visibilitychange", catchUpWhenVisible);

  function watchPath(path, onNext, onError) {
    const listener = { onNext, onError };
    if (!listenersByPath.has(path)) listenersByPath.set(path, new Set());
    listenersByPath.get(path).add(listener);
    refreshPath(path);
    if (!socket && !reconnectTimer) openSocket();
    return () => {
      const listeners = listenersByPath.get(path);
      listeners?.delete(listener);
      if (listeners && !listeners.size) listenersByPath.delete(path);
    };
  }

  async function writeDoc(path, method, data) {
    await requestJson(findUrl(path), sendJson(method, data));
  }

  function doc(path) {
    return {
      id: readId(path),
      path,
      get: () => readSnapshot(path),
      set: (data) => writeDoc(path, "PUT", data),
      update: (data) => writeDoc(path, "PATCH", data),
      onSnapshot: (onNext, onError = () => {}) => watchPath(path, onNext, onError),
    };
  }

  function collection(name) {
    return {
      limit: (count) => ({
        get: async () => {
          const { docs } = await requestJson(new URL(`store/${name}?limit=${count}`, baseUrl));
          return { docs: docs.map(({ id, data }) => createSnapshot(id, data)) };
        },
      }),
    };
  }

  return { doc, collection };
}
