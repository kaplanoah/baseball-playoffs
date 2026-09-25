import * as MLBSnapshot from "../../page/js/snapshot.js";

const SERVER_INFO = { name: "mlb-live", title: "MLB Live", version: "1.0.0" };
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const TOOL = {
  name: "get_snapshot",
  title: "MLB live snapshot",
  description:
    "The current state of one MLB season: the postseason field and seeds (projected from the " +
    "standings until MLB sets the bracket), every series record and its next game, division and " +
    "wild card standings, and the day's games with scores and innings. Read-only, from the public " +
    "MLB Stats API.",
  inputSchema: {
    type: "object",
    properties: {
      season: {
        type: "integer",
        minimum: 1995,
        maximum: 2100,
        description: "Season year, e.g. 2026. Defaults to this year.",
      },
    },
    additionalProperties: false,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
};
const { minimum: FIRST_SEASON, maximum: LAST_SEASON } = TOOL.inputSchema.properties.season;
const SEASON_RULE = `season must be a whole year between ${FIRST_SEASON} and ${LAST_SEASON}`;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const UPSTREAM_TIMEOUT_MS = 8000;
const EDGE_CACHE_SECONDS = 15; // under MLB's own 20-second cache
const SNAPSHOT_REUSE_MS = 10000;
const MAX_BODY_BYTES = 64 * 1024;
// Each tool call can cost four MLB requests, and a Worker may make only so many per request.
const MAX_BATCH = 10;

const describeError = (error) => (error instanceof Error ? error.message : String(error));
const isPlainObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id",
};
const respondJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });
const respondText = (body, status, extraHeaders = {}) =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain", ...CORS, ...extraHeaders },
  });
const respondAccepted = () => new Response(null, { status: 202, headers: CORS });

const createResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const createError = (id, code, message) => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message },
});

async function readBody(request) {
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_BODY_BYTES) return null;
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) return null;
  return new TextDecoder().decode(bytes);
}

export function createWorker({
  fetchImpl = (input, init) => fetch(input, init),
  now = () => Date.now(),
} = {}) {
  const recentSnapshots = new Map();

  async function fetchMlbJson(path) {
    const response = await fetchImpl(MLBSnapshot.MLB_API + path, {
      headers: { accept: "application/json", "user-agent": "mlb-live-connector/1.0" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cf: { cacheTtl: EDGE_CACHE_SECONDS, cacheEverything: true },
    });
    if (!response.ok)
      throw new Error(`MLB Stats API answered ${response.status} for ${path.split("?")[0]}`);
    return response.json();
  }

  function loadSnapshot(season) {
    const requestedAt = now();
    const cached = recentSnapshots.get(season);
    if (cached && requestedAt - cached.at < SNAPSHOT_REUSE_MS) return cached.promise;
    const promise = MLBSnapshot.fetchSnapshot(fetchMlbJson, season, requestedAt);
    recentSnapshots.set(season, { at: requestedAt, promise });
    promise.catch(() => {
      if (recentSnapshots.get(season)?.promise === promise) recentSnapshots.delete(season);
    });
    return promise;
  }

  function readSeason(value) {
    if (value == null) return MLBSnapshot.easternDay(now()).year;
    const isValid = Number.isInteger(value) && value >= FIRST_SEASON && value <= LAST_SEASON;
    return isValid ? value : null;
  }

  async function callTool(id, params) {
    if (params.name !== TOOL.name)
      return createError(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
    const input = params.arguments ?? {};
    const hasOnlySeason =
      isPlainObject(input) && Object.keys(input).every((key) => key === "season");
    const season = hasOnlySeason ? readSeason(input.season) : null;
    if (season == null)
      return createError(id, INVALID_PARAMS, `${SEASON_RULE}, and nothing else is accepted`);
    // An upstream failure is a tool error, not a protocol error: the request itself was valid.
    try {
      const snapshot = await loadSnapshot(season);
      return createResult(id, {
        content: [{ type: "text", text: JSON.stringify(snapshot) }],
        structuredContent: snapshot,
      });
    } catch (error) {
      return createResult(id, {
        isError: true,
        content: [{ type: "text", text: `Couldn't read MLB: ${describeError(error)}` }],
      });
    }
  }

  function initialize(id, params) {
    const asked = params.protocolVersion;
    return createResult(id, {
      protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        "One read-only tool, get_snapshot, returns the live state of an MLB season as JSON.",
    });
  }

  async function answerRequest(id, method, params) {
    switch (method) {
      case "initialize":
        return initialize(id, params);
      case "ping":
        return createResult(id, {});
      case "tools/list":
        return createResult(id, { tools: [TOOL] });
      case "tools/call":
        return callTool(id, params);
      default:
        return createError(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  async function answerMessage(message) {
    if (!isPlainObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string")
      return createError(message && message.id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request");
    const isNotification = !("id" in message);
    if (isNotification) return null;
    const { id, method } = message;
    const params = message.params ?? {};
    if (!isPlainObject(params)) return createError(id, INVALID_PARAMS, "params must be an object");
    try {
      return await answerRequest(id, method, params);
    } catch (error) {
      return createError(id, INTERNAL_ERROR, describeError(error));
    }
  }

  // Older MCP protocol versions allow JSON-RPC batches.
  async function answerBatch(messages) {
    if (!messages.length)
      return respondJson(createError(null, INVALID_REQUEST, "Empty batch"), 400);
    if (messages.length > MAX_BATCH)
      return respondJson(
        createError(null, INVALID_REQUEST, `A batch holds at most ${MAX_BATCH} messages`),
        400,
      );
    const answers = (await Promise.all(messages.map(answerMessage))).filter(Boolean);
    return answers.length ? respondJson(answers) : respondAccepted();
  }

  async function handleMcp(request) {
    if (request.method !== "POST")
      return respondText("This MCP endpoint takes POST only.\n", 405, { allow: "POST, OPTIONS" });
    const raw = await readBody(request);
    if (raw == null)
      return respondJson(createError(null, INVALID_REQUEST, "Request too large"), 413);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return respondJson(createError(null, PARSE_ERROR, "Body is not valid JSON"), 400);
    }
    if (Array.isArray(body)) return answerBatch(body);
    const answer = await answerMessage(body);
    return answer ? respondJson(answer) : respondAccepted();
  }

  async function serveSnapshot(url) {
    const season = readSeason(
      url.searchParams.has("season") ? Number(url.searchParams.get("season")) : null,
    );
    if (season == null) return respondJson({ error: SEASON_RULE }, 400);
    try {
      return respondJson(await loadSnapshot(season));
    } catch (error) {
      return respondJson({ error: `Couldn't read MLB: ${describeError(error)}` }, 502);
    }
  }

  async function routeRequest(request, env = {}) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const key = env.CONNECTOR_KEY ? `/${env.CONNECTOR_KEY}` : "";
    if (url.pathname === `/mcp${key}`) return handleMcp(request);
    if (url.pathname === `/snapshot${key}` && request.method === "GET") return serveSnapshot(url);
    if (url.pathname === "/" && !key)
      return respondText("MLB Live connector. MCP endpoint: /mcp\n", 200);
    return respondText("Not found\n", 404);
  }

  return { fetch: routeRequest };
}
