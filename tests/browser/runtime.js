// A stand-in for the claude.ai artifact runtime, installed before the page's scripts run.
(() => {
  const { store: initialStore, snapshots, connectorAdded, dbAvailable } = window.__runtimeConfig;
  const SERVER_NAME = "MLB Live";
  const TOOL_NAME = "get_snapshot";

  const copy = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
  const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  const createError = (code, message) => Object.assign(new Error(message), { code });

  const documents = new Map(Object.entries(copy(initialStore)));
  const listeners = new Map();
  const toolCalls = [];

  // The real store hands documents back read-only, with their keys sorted.
  function freezeSorted(value) {
    if (Array.isArray(value)) return Object.freeze(value.map(freezeSorted));
    if (isPlainObject(value)) {
      const keys = Object.keys(value).sort();
      return Object.freeze(Object.fromEntries(keys.map((key) => [key, freezeSorted(value[key])])));
    }
    return value;
  }

  function readDocumentSnapshot(path) {
    const exists = documents.has(path);
    return {
      id: path.split("/").pop(),
      exists,
      data: () => (exists ? freezeSorted(documents.get(path)) : undefined),
    };
  }

  function notifyListeners(path) {
    for (const listener of listeners.get(path) || [])
      setTimeout(() => listener(readDocumentSnapshot(path)));
  }

  function mergeFields(target, fields) {
    for (const [key, value] of Object.entries(fields)) {
      if (isPlainObject(value) && isPlainObject(target[key])) mergeFields(target[key], value);
      else target[key] = copy(value);
    }
  }

  const database = {
    doc: (path) => ({
      get: async () => readDocumentSnapshot(path),
      set: async (data) => {
        if (runtime.failWrites) throw createError("unavailable", "try again later");
        documents.set(path, copy(data));
        notifyListeners(path);
      },
      update: async (fields) => {
        if (runtime.failWrites) throw createError("unavailable", "try again later");
        if (!documents.has(path)) throw createError("not_found", `${path} does not exist`);
        mergeFields(documents.get(path), fields);
        notifyListeners(path);
      },
      onSnapshot: (listener) => {
        if (!listeners.has(path)) listeners.set(path, new Set());
        listeners.get(path).add(listener);
        setTimeout(() => listener(readDocumentSnapshot(path)));
        return () => listeners.get(path).delete(listener);
      },
    }),
    collection: (name) => ({
      limit() {
        return this;
      },
      get: async () => ({
        docs: [...documents.keys()]
          .filter((path) => path.split("/").length === 2 && path.startsWith(`${name}/`))
          .map(readDocumentSnapshot),
      }),
    }),
  };

  const runtime = {
    transformSnapshot: null,
    failWrites: false,
    toolCalls,
    read: (path) => (documents.has(path) ? copy(documents.get(path)) : null),
  };

  const mcp = {
    listTools: async (server) => ({
      servers: [
        { server, tools: connectorAdded && server === SERVER_NAME ? [{ name: TOOL_NAME }] : [] },
      ],
    }),
    callTool: async (server, tool, input) => {
      toolCalls.push({ server, tool, input: copy(input) });
      // A connector that was never added fails with a vague code, as the real one does.
      if (!connectorAdded) throw createError("upstream_error", "consent could not be asked");
      const snapshot = copy(snapshots[input.season]);
      if (server !== SERVER_NAME || tool !== TOOL_NAME || !snapshot)
        throw createError("tool_error", "no answer");
      return {
        payload: runtime.transformSnapshot ? runtime.transformSnapshot(snapshot) : snapshot,
      };
    },
  };

  window.__runtime = runtime;
  const capabilities = dbAvailable ? { db: database, mcp } : { mcp };
  window.claude = { use: async (name) => capabilities[name] ?? null };
})();
