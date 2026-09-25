/* The MLB Live connector: a Cloudflare Worker that speaks just enough MCP
   for claude.ai to add it as a custom connector, with one read-only tool,
   `get_snapshot`, that returns what js/snapshot.js builds.

   The page calls that tool through the artifact's `mcp` capability; claude.ai
   relays the call here and the answer back. No model runs anywhere in that
   loop, so a poll costs no tokens -- only one Worker request.

   Deliberately small:
   - Stateless Streamable HTTP. Every request is a POST carrying JSON-RPC and
     gets a plain JSON reply; there are no sessions, no server-sent events
     and nothing to notify, because the tool is a pure read.
   - No dependencies. The build (worker/build.mjs) concatenates
     js/snapshot.js ahead of this file, so the page and the connector run
     the same code and can never disagree about what a snapshot is.
   - No secrets. MLB's API is public. The one setting, CONNECTOR_KEY, is an
     optional path secret that keeps strangers from spending your free-tier
     requests: set it, and the connector lives at /mcp/<key> instead of /mcp.

   This file is a plain script, not a module, so the tests can load it the
   way the page's own scripts are loaded. The build adds the export. */

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
      season: { type: "integer", minimum: 1995, maximum: 2100, description: "Season year, e.g. 2026. Defaults to this year." }
    },
    additionalProperties: false
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
};

/* JSON-RPC's own error codes. */
const PARSE_ERROR = -32700, INVALID_REQUEST = -32600, METHOD_NOT_FOUND = -32601, INVALID_PARAMS = -32602;

const UPSTREAM_TIMEOUT_MS = 8000;
const EDGE_CACHE_SECONDS = 15;     // MLB caches for 20; this keeps us inside that
const SNAPSHOT_REUSE_MS = 10000;   // concurrent and back-to-back calls share one build
const MAX_BODY_BYTES = 64 * 1024;

function createWorker({ fetchImpl = (...a) => fetch(...a), now = () => Date.now() } = {}){
  /* One snapshot per season at a time, reused for a few seconds, so a phone
     and a laptop polling together (or a burst of retries) cost one set of
     upstream requests, not one per caller. A failed build is not reused. */
  const recent = new Map();

  async function getJson(path){
    const res = await fetchImpl(MLBSnapshot.MLB_API + path, {
      headers: { accept: "application/json", "user-agent": "mlb-live-connector/1.0" },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cf: { cacheTtl: EDGE_CACHE_SECONDS, cacheEverything: true }
    });
    if(!res.ok) throw new Error(`MLB Stats API answered ${res.status} for ${path.split("?")[0]}`);
    return res.json();
  }

  function snapshotFor(season){
    const t = now();
    const hit = recent.get(season);
    if(hit && t - hit.at < SNAPSHOT_REUSE_MS) return hit.promise;
    const promise = MLBSnapshot.fetchSnapshot(getJson, season, t);
    recent.set(season, { at: t, promise });
    promise.catch(() => { if(recent.get(season) && recent.get(season).promise === promise) recent.delete(season); });
    return promise;
  }

  function seasonArg(args){
    const thisYear = MLBSnapshot.easternDay(now()).year;
    if(args == null || args.season == null) return thisYear;
    const s = args.season;
    const { minimum, maximum } = TOOL.inputSchema.properties.season;
    if(!Number.isInteger(s) || s < minimum || s > maximum) return null;
    return s;
  }

  /* ---------- JSON-RPC ---------- */
  const reply = (id, result) => ({ jsonrpc: "2.0", id, result });
  const failure = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  async function call(msg){
    if(!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
      return failure(msg && msg.id, INVALID_REQUEST, "Not a JSON-RPC 2.0 request");
    }
    const isNotification = !("id" in msg);
    if(isNotification) return null;   // initialized, cancelled: nothing to do or say
    const { id, method, params = {} } = msg;

    switch(method){
      case "initialize": {
        const asked = params.protocolVersion;
        return reply(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: "One read-only tool, get_snapshot, returns the live state of an MLB season as JSON."
        });
      }
      case "ping":
        return reply(id, {});
      case "tools/list":
        return reply(id, { tools: [TOOL] });
      case "tools/call": {
        if(params.name !== TOOL.name) return failure(id, INVALID_PARAMS, `Unknown tool: ${params.name}`);
        const extra = Object.keys(params.arguments || {}).filter(k => k !== "season");
        const season = seasonArg(params.arguments);
        if(extra.length || season == null){
          return failure(id, INVALID_PARAMS, "season must be a whole year between 1995 and 2100, and nothing else is accepted");
        }
        /* A failure upstream is the tool's result, not a protocol error:
           the caller asked correctly, and MLB didn't answer. */
        try{
          const snapshot = await snapshotFor(season);
          return reply(id, { content: [{ type: "text", text: JSON.stringify(snapshot) }], structuredContent: snapshot });
        }catch(e){
          return reply(id, { isError: true, content: [{ type: "text", text: `Couldn't read MLB: ${e && e.message || e}` }] });
        }
      }
      default:
        return failure(id, METHOD_NOT_FOUND, `Method not found: ${method}`);
    }
  }

  /* ---------- HTTP ---------- */
  const CORS = {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, accept, mcp-protocol-version, mcp-session-id"
  };
  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS }
  });
  const text = (body, status, extra = {}) => new Response(body, { status, headers: { "content-type": "text/plain", ...CORS, ...extra } });

  async function handleMcp(request){
    if(request.method !== "POST") return text("This MCP endpoint takes POST only.\n", 405, { allow: "POST, OPTIONS" });
    const raw = await request.text();
    if(raw.length > MAX_BODY_BYTES) return json(failure(null, INVALID_REQUEST, "Request too large"), 413);
    let body;
    try{ body = JSON.parse(raw); }
    catch{ return json(failure(null, PARSE_ERROR, "Body is not valid JSON"), 400); }

    // Older clients may batch; answer each request, skip each notification.
    if(Array.isArray(body)){
      if(!body.length) return json(failure(null, INVALID_REQUEST, "Empty batch"), 400);
      const out = (await Promise.all(body.map(call))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202, headers: CORS });
    }
    const out = await call(body);
    return out ? json(out) : new Response(null, { status: 202, headers: CORS });
  }

  async function fetchHandler(request, env = {}){
    const url = new URL(request.url);
    if(request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const key = env.CONNECTOR_KEY ? `/${env.CONNECTOR_KEY}` : "";
    const mcpPath = `/mcp${key}`, snapshotPath = `/snapshot${key}`;

    if(url.pathname === mcpPath) return handleMcp(request);
    if(url.pathname === snapshotPath && request.method === "GET"){
      // The same answer over plain HTTP, for a browser tab or curl.
      const season = seasonArg({ season: url.searchParams.has("season") ? Number(url.searchParams.get("season")) : null });
      if(season == null) return json({ error: "season must be a whole year between 1995 and 2100" }, 400);
      try{ return json(await snapshotFor(season)); }
      catch(e){ return json({ error: `Couldn't read MLB: ${e && e.message || e}` }, 502); }
    }
    if(url.pathname === "/" && !key) return text("MLB Live connector. MCP endpoint: /mcp\n", 200);
    return text("Not found\n", 404);
  }

  return { fetch: fetchHandler };
}
