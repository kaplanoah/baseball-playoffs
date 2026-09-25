import { createWorker } from "./mcp.js";
import { SeasonStore, forwardToStore } from "./store.js";

const connector = createWorker();

// The store answers only under the APP_KEY secret, so a Worker without one has no store.
function findStorePath(pathname, appKey) {
  if (!appKey) return null;
  const prefix = `/${appKey}`;
  const isStorePath = pathname === `${prefix}/watch` || pathname.startsWith(`${prefix}/store/`);
  return isStorePath ? pathname.slice(prefix.length) : null;
}

export default {
  fetch(request, env = {}) {
    const storePath = findStorePath(new URL(request.url).pathname, env.APP_KEY);
    return storePath ? forwardToStore(request, env, storePath) : connector.fetch(request, env);
  },
};

export { SeasonStore };
