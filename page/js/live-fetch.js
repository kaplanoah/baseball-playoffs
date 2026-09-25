import * as MLBSnapshot from "./snapshot.js";
import { isSelfHosted } from "./worker-store.js";

export const LIVE_SERVER = "MLB Live";
const LIVE_TOOL = "get_snapshot";
const LIVE_CACHE_MS = 15 * 1000;
const DIRECT_TIMEOUT_MS = 10 * 1000;
const CONNECTOR_TIMEOUT_MS = 20 * 1000;

let directBlocked = false;
let mcp;

export class LiveError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function findLiveSource() {
  if (isSelfHosted()) return "worker";
  return directBlocked ? "connector" : "direct";
}

// A TypeError from fetch while online means the sandbox refused the request.
async function fetchMlbJson(path) {
  let response;
  try {
    response = await fetch(MLBSnapshot.MLB_API + path, {
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof TypeError && navigator.onLine !== false)
      throw new LiveError("direct_blocked", error.message);
    throw error;
  }
  if (!response.ok) throw new LiveError("upstream_error", `MLB answered ${response.status}`);
  return response.json();
}

async function fetchDirect(season) {
  return MLBSnapshot.fetchSnapshot(fetchMlbJson, season);
}

function limitTime(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new LiveError("timeout", "no answer in time")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function connectMcp() {
  if (mcp !== undefined) return mcp;
  try {
    mcp = (await window.claude?.use?.("mcp")) || null;
  } catch {
    mcp = null;
  }
  return mcp;
}

// A never-added connector fails calls with a vague code, and lists with no tools or not at all.
async function isConnectorMissing() {
  try {
    const { servers } = await mcp.listTools(LIVE_SERVER);
    const server = (servers || []).find((candidate) => candidate.server === LIVE_SERVER);
    return !server || !(server.tools || []).length;
  } catch {
    return false;
  }
}

async function callConnector(season) {
  const call = mcp.callTool(
    LIVE_SERVER,
    LIVE_TOOL,
    { season },
    { cache: { staleTime: LIVE_CACHE_MS } },
  );
  return limitTime(call, CONNECTOR_TIMEOUT_MS);
}

async function fetchViaConnector(season) {
  if (!(await connectMcp())) throw new LiveError("no_mcp", "no connector access in this view");
  let result;
  try {
    result = await callConnector(season);
  } catch (error) {
    if (error instanceof LiveError) throw error;
    const code = /** @type {{ code?: string } | undefined} */ (error)?.code;
    throw (await isConnectorMissing())
      ? new LiveError("server_not_connected", `${code}: not added`)
      : error;
  }
  const snapshot = result && result.payload;
  if (!snapshot || snapshot.version !== 1 || snapshot.season !== season)
    throw new LiveError("bad_payload", "unexpected answer");
  return snapshot;
}

async function fetchFromWorker(season) {
  const response = await fetch(new URL(`snapshot?season=${season}`, location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new LiveError("upstream_error", body?.error || `The Worker answered ${response.status}`);
  if (!body || body.version !== 1 || body.season !== season)
    throw new LiveError("bad_payload", "unexpected answer");
  return body;
}

// The Worker that serves a self-hosted page also reads MLB for it. On claude.ai, once the
// sandbox has refused a direct request, the connector is used from then on.
export async function fetchLive(season) {
  if (isSelfHosted()) return { snapshot: await fetchFromWorker(season), source: "worker" };
  if (!directBlocked) {
    try {
      return { snapshot: await fetchDirect(season), source: "direct" };
    } catch (error) {
      if (!(error instanceof LiveError) || error.code !== "direct_blocked") throw error;
      directBlocked = true;
    }
  }
  return { snapshot: await fetchViaConnector(season), source: "connector" };
}
