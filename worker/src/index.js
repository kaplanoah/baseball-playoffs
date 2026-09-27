import { redirectToFolder, servePageFile, serveRobots, serveNotFound } from "./page.js";
import { createSnapshotServer } from "./snapshot.js";
import { SeasonStore, forwardToStore } from "./store.js";

const snapshots = createSnapshotServer();

// The page and its store answer only under the APP_KEY secret; nothing else does.
function findAppPath(pathname, appKey) {
  if (!appKey) return null;
  const prefix = `/${appKey}`;
  if (pathname === prefix) return "";
  return pathname.startsWith(`${prefix}/`) ? pathname.slice(prefix.length) : null;
}

const isStorePath = (appPath) => appPath === "/watch" || appPath.startsWith("/store/");

export default {
  fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === "/robots.txt") return serveRobots();
    const appPath = findAppPath(url.pathname, env.APP_KEY);
    if (appPath === null) return serveNotFound();
    if (appPath === "") return redirectToFolder(url);
    if (isStorePath(appPath)) return forwardToStore(request, env, appPath);
    if (appPath === "/snapshot" && request.method === "GET") return snapshots.serveSnapshot(url);
    return servePageFile(request, appPath);
  },
};

export { SeasonStore };
