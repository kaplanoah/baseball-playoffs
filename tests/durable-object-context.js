// A stand-in for a Durable Object's ctx: its key-value storage and its accepted WebSockets.
export function createDurableObjectContext() {
  const stored = new Map();
  const sockets = [];
  const ctx = {
    storage: {
      get: async (key) => structuredClone(stored.get(key)),
      put: async (key, value) => {
        stored.set(key, structuredClone(value));
      },
      list: async ({ prefix, limit }) =>
        new Map(
          [...stored]
            .filter(([key]) => key.startsWith(prefix))
            .sort(([first], [second]) => first.localeCompare(second))
            .slice(0, limit),
        ),
    },
    acceptWebSocket: (socket) => sockets.push(socket),
    getWebSockets: () => sockets,
  };
  return { ctx, stored, sockets };
}
