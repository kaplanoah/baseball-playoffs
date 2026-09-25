/* Live data: the page keeps itself current from MLB, and says how current
   it is in the stamp under the title.

   Where it comes from. A snapshot (js/snapshot.js) is built from three MLB
   Stats API responses. The page tries to fetch them itself first; an
   artifact is normally not allowed to reach other sites, so when that fails
   it asks the MLB Live connector (worker/) instead, through the artifact's
   `mcp` capability. Either way no model runs: a snapshot costs one request.

   When. Only baseball moves this data, so the page asks every 30 seconds
   while a game is on, sleeps until the next first pitch otherwise, and looks
   at the schedule at least hourly in case it changed (MLBSnapshot.pollDelay).
   Nothing is fetched while the tab is hidden; on return, a check that fell
   due in the meantime runs at once.

   What it touches. The snapshot supplies the field, the series, the
   standings and the day's games -- everything MLB decides. Your ranking and
   what you have dismissed stay in the season document, which is yours. The
   page also writes MLB's side back to the store, for three reasons: the
   next snapshot is compared against it to find what moved (js/changes.js);
   a view that can't reach MLB still shows the last known state; and a past
   season's champion is remembered (lastTitle in app.js). */

const LIVE_SERVER = "MLB Live";            // the connector's name in claude.ai
const LIVE_TOOL = "get_snapshot";
const LIVE_CACHE_MS = 15 * 1000;           // two calls this close share one answer
const FRESH_FINAL_MS = 10 * 60 * 1000;     // a final this new leads the stamp
const RETRY_MS = [30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3];

let live = null;            // the latest snapshot for the season on screen
let liveError = null;       // why the last attempt failed: { code, message, retry }
let liveTimer = 0;
let liveDueAt = Infinity;   // when the next check is due; Infinity = none
let liveSeq = 0;            // bumped per attempt, so a stale answer is dropped
let liveFailures = 0;
let directBlocked = false;  // this page can't fetch MLB itself; use the connector
let mcp;                    // the mcp namespace; undefined until first asked
let writesBlocked = false;  // this viewer can't write the store
let writing = Promise.resolve();
let reported = "";          // the status last written to live/status
let status = { source: "", error: "", detail: "", write: "" };

/* ---------- getting a snapshot ---------- */

class LiveError extends Error {
  constructor(code, message){ super(message); this.code = code; }
}

async function fetchDirect(season){
  return MLBSnapshot.fetchSnapshot(async path => {
    const res = await fetch(MLBSnapshot.MLB_API + path);
    if(!res.ok) throw new LiveError("upstream_error", `MLB answered ${res.status}`);
    return res.json();
  }, season);
}

async function fetchViaConnector(season){
  if(mcp === undefined){
    try{ mcp = await window.claude?.use?.("mcp"); }catch(e){ mcp = null; }
  }
  if(!mcp) throw new LiveError("no_mcp", "no connector access in this view");
  let result;
  try{
    result = await mcp.callTool(LIVE_SERVER, LIVE_TOOL, { season }, { cache: { staleTime: LIVE_CACHE_MS } });
  }catch(e){
    throw (await connectorMissing()) ? new LiveError("server_not_connected", `${e && e.code}: not added`) : e;
  }
  const snap = result && result.payload;
  if(!snap || snap.version !== 1 || snap.season !== season) throw new LiveError("bad_payload", "unexpected answer");
  return snap;
}

/* Whether the viewer has no MLB Live connector at all. A call can fail with
   a vague code (`upstream_error`) when the connector was never added, and
   "add it" is the one instruction that fixes that, so ask: a connector the
   viewer hasn't connected lists with no tools, or not at all. */
async function connectorMissing(){
  try{
    const { servers } = await mcp.listTools(LIVE_SERVER);
    const mine = (servers || []).find(x => x.server === LIVE_SERVER);
    return !mine || !(mine.tools || []).length;
  }catch(e){
    return false;
  }
}

/* The page's own fetch first: it needs nothing set up. A TypeError while
   the browser is online is the request being refused -- the artifact isn't
   allowed to reach MLB -- so from then on this page load goes straight to
   the connector. Offline, it's just offline, and the next try is direct. */
async function fetchLive(season){
  if(!directBlocked){
    try{ return { snap: await fetchDirect(season), source: "direct" }; }
    catch(e){
      if(!(e instanceof TypeError) || navigator.onLine === false) throw e;
      directBlocked = true;
    }
  }
  return { snap: await fetchViaConnector(season), source: "connector" };
}

/* What to tell the viewer, and whether trying again by itself can help.
   Codes are the mcp capability's; each one that has a fix names it. */
function describeLiveError(e){
  const code = (e && e.code) || "upstream_error";
  const where = "claude.ai's connector settings";
  const says = {
    server_not_connected: `Live scores need the ${LIVE_SERVER} connector: add it in ${where}.`,
    needs_reauth:         `Reconnect ${LIVE_SERVER} in ${where} for live scores.`,
    selection_required:   `Choose which ${LIVE_SERVER} connector this page should use.`,
    not_in_manifest:      "Live scores are turned off for this page. Reload to be asked again.",
    blocked_by_policy:    `Your organization doesn't allow ${LIVE_SERVER} here.`,
    approval_required:    `Your organization requires approval for ${LIVE_SERVER}.`,
    no_mcp:               "Live scores aren't available in this view.",
    not_granted:          "Live scores aren't available in this view.",
    capability_disabled:  "Live scores aren't available in this view.",
    bad_payload:          `${LIVE_SERVER} answered with something unexpected. Is it up to date?`,
    tool_error:           `MLB didn't answer (${e && e.message || "no reason given"}). Trying again shortly.`
  };
  const permanent = ["server_not_connected", "needs_reauth", "selection_required", "not_in_manifest",
    "blocked_by_policy", "approval_required", "no_mcp", "not_granted", "capability_disabled", "bad_payload", "bad_request"];
  /* Access withdrawn: what the connector showed before goes too. */
  const denied = ["server_not_connected", "needs_reauth", "not_in_manifest", "blocked_by_policy", "approval_required"];
  return {
    code,
    message: says[code] || "Couldn't reach live scores. Trying again shortly.",
    retry: !permanent.includes(code),
    retract: denied.includes(code),
    detail: String((e && e.message) || "").slice(0, 200)
  };
}

/* ---------- when ---------- */

function scheduleLive(ms){
  clearTimeout(liveTimer);
  liveDueAt = ms == null ? Infinity : Date.now() + ms;
  if(ms != null) liveTimer = setTimeout(refreshLive, ms);
}

async function refreshLive(){
  clearTimeout(liveTimer);
  // Hidden: leave the check due, and run it when the page is looked at again.
  if(document.hidden){ liveDueAt = Math.min(liveDueAt, Date.now()); return; }
  const season = activeYear, seq = ++liveSeq;
  try{
    const { snap, source } = await fetchLive(season);
    if(seq !== liveSeq) return;
    liveError = null;
    liveFailures = 0;
    applyLive(snap);
    report({ source, error: "", detail: "" });
    scheduleLive(MLBSnapshot.pollDelay(snap));
  }catch(e){
    if(seq !== liveSeq) return;
    liveError = describeLiveError(e);
    if(liveError.retract && live){
      live = null;
      composeState();
      if(!reordering) renderAll();
    } else {
      renderStamp();
    }
    report({ source: directBlocked ? "connector" : "direct", error: liveError.code, detail: liveError.detail });
    if(liveError.retry){
      scheduleLive(RETRY_MS[Math.min(liveFailures++, RETRY_MS.length - 1)]);
    } else {
      /* Nothing will change by itself -- the fix is in claude.ai, usually in
         another tab -- so try again when the viewer comes back to this one. */
      clearTimeout(liveTimer);
      liveDueAt = Date.now();
    }
  }
}

/* A new season on screen: forget the old one's snapshot and start again. */
function startLive(){
  live = null;
  liveError = null;
  liveFailures = 0;
  refreshLive();
}

document.addEventListener("visibilitychange", () => {
  if(!document.hidden && Date.now() >= liveDueAt) refreshLive();
});
addEventListener("online", () => { if(liveDueAt !== Infinity) refreshLive(); });

/* ---------- showing it ---------- */

/* The season document as the views see it: yours (ranking, dismissals) as
   stored, MLB's (field, series, the day's games) from the latest snapshot,
   and the log with this snapshot's postseason games added. */
function withLive(doc){
  if(!live || live.season !== activeYear) return doc;
  const slate = live.slate && {
    ...live.slate,
    since: new Date(Date.parse(live.asOf) - FRESH_FINAL_MS).toISOString()
  };
  return { ...doc, teams: live.teams, series: live.series, projected: live.projected, slate,
    log: LogChanges.merge(doc.log, live.log) };
}

/* Rebuild what the views read from the stored documents and the snapshot. */
function composeState(){
  state = withLive(seasonDoc);
  standings = (live && live.season === activeYear && live.standings) || storedStandings;
}

/* Equal as data, whatever order the keys are in: the store hands documents
   back with their keys sorted, so a plain JSON comparison would call every
   stored copy changed and rewrite it on every poll. */
function canonical(x){
  if(Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if(x && typeof x === "object"){
    return `{${Object.keys(x).sort().filter(k => x[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}`;
  }
  return JSON.stringify(x === undefined ? null : x);
}
const sameJson = (a, b) => canonical(a) === canonical(b);

function applyLive(snap){
  if(snap.season !== activeYear) return;
  const was = live;
  live = snap;
  // Every answer moves the stamp's clock; only a changed one redraws the rest.
  const { asOf: _a, ...now } = snap, { asOf: _b, ...before } = was || {};
  composeState();
  if(was && sameJson(now, before)) renderStamp();
  else if(!reordering) renderAll();
  saveLive(snap);
}

/* ---------- the stamp ---------- */

/* What stamp.js needs to choose which game to name: the user's ranking, and
   whether a club is still alive. In September a club is out only when it is
   eliminated from both its division and the wild card; in October, once it
   has lost a series (or never made the field). In October a final also says
   what it did to its series. */
function stampContext(){
  const projected = !state || state.projected !== false;
  const rows = standings && standings.divisions ? Object.values(standings.divisions).flat() : [];
  const alive = id => {
    if(!projected) return !!(state.teams && state.teams[id]) && !teamEliminated(state, id);
    const r = rows.find(x => x.id === id);
    return !r || !(r.elim === "E" && r.wce === "E");
  };
  const seriesNote = g => {
    if(projected) return "";
    const br = fullBracket(state);
    const all = [br.al, br.nl].filter(Boolean).flatMap(b => [...b.wc, ...b.ds, ...b.cs]).concat(br.ws ? [br.ws] : []);
    const s = all.find(x => x.teamA && x.teamB &&
      [x.teamA, x.teamB].sort().join() === [g.away, g.home].sort().join());
    if(!s) return "";
    const hi = Math.max(s.winsA, s.winsB), lo = Math.min(s.winsA, s.winsB);
    const lead = s.winsA > s.winsB ? s.teamA : s.teamB;
    if(s.winner) return ` — ${stampName(s.winner)} win the ${seriesLabel(s.id)} ${hi}-${lo}`;
    if(hi === lo) return ` — series even ${hi}-${lo}`;
    return ` — ${stampName(lead)} now lead ${hi}-${lo}`;
  };
  return { ranking: (state && state.ranking) || [], alive, seriesNote, now: new Date() };
}

/* .stamp is a flex column, so each line is an element of its own. */
function stampLine(label, when, why){
  return `<span>${label} <b>${when}</b>${why ? ` &mdash; ${why}` : ""}</span>`;
}

/* Two lines: when the data is from and the newest baseball in it, then --
   while nothing is on -- the next first pitch. A season that is over has
   neither. Without live data, the saved copy's time and games instead. */
function stampLines(){
  const ctx = stampContext();
  if(live && live.season === activeYear){
    if(!state.slate) return [];
    const lines = [stampLine("Updated", stampWhen(new Date(live.asOf)), lastStampText(state.slate, ctx))];
    const next = upNextText(state.slate, ctx);
    if(next){
      const at = new Date(next.at);
      lines.push(stampLine("Next first pitch", next.tbd ? stampDay(at) : stampWhen(at), next.text));
    }
    return lines;
  }
  const saved = [state && state.updatedAt, standings && standings.updatedAt]
    .map(t => Date.parse(t)).filter(n => !isNaN(n));
  if(!saved.length) return [];
  return [stampLine("Saved", stampWhen(new Date(Math.max(...saved))), state.slate ? lastStampText(state.slate, ctx) : "")];
}

function renderStamp(){
  const el = document.getElementById("stamp");
  const lines = state ? stampLines() : [];
  if(liveError) lines.push(`<span class="stamp-err">${liveError.message}</span>`);
  el.hidden = !lines.length;
  el.innerHTML = lines.join("");
}

/* Day words and "Updated" times turn over on the clock, not on new data. */
setInterval(() => { try{ renderStamp(); }catch(e){} }, 60 * 1000);

/* ---------- writing MLB's side back ---------- */

/* One write at a time, in order; a viewer who can't write stops trying. */
function saveLive(snap){
  if(!db || writesBlocked) return;
  writing = writing.then(() => writeLive(snap)).then(() => {
    report({ write: "" });
  }, e => {
    const code = (e && e.code) || "error";
    if(["not_granted", "capability_disabled", "revoked", "invalid_argument", "quota_exceeded"].includes(code)) writesBlocked = true;
    report({ write: `${(e && e.step) || "write"}: ${code}: ${String((e && e.message) || "").slice(0, 160)}` });
  });
}

/* Which save a failure came from, for live/status. */
async function step(name, write){
  try{ return await write(); }
  catch(e){
    throw Object.assign(e && typeof e === "object" ? e : new Error(String(e)), { step: name });
  }
}

/* Does `now` lack a key that `was` has, at any depth? update() merges
   objects key by key, so a key can't be removed by leaving it out. */
function losesKeys(was, now){
  if(!was || typeof was !== "object" || Array.isArray(was)) return false;
  if(!now || typeof now !== "object" || Array.isArray(now)) return true;
  return Object.keys(was).some(k => !(k in now) || losesKeys(was[k], now[k]));
}

/* The season document first, with the log entries for what moved, then the
   standings -- the baseline those entries were found against. In that order,
   a write that fails between the two leaves the old baseline in place, the
   same change is found again next time, and the log's keys keep it single. */
async function writeLive(snap){
  if(snap.season !== activeYear) return;
  const year = snap.season;
  const doc = seasonDoc;
  const news = LogChanges.between({ teams: doc.teams, projected: doc.projected, standings: storedStandings }, snap);
  const log = LogChanges.merge(doc.log, [...snap.log, ...news]);

  const fields = {};
  if(!sameJson(doc.teams, snap.teams)) fields.teams = snap.teams;
  if(!sameJson(doc.series, snap.series)) fields.series = snap.series;
  if(doc.projected !== snap.projected) fields.projected = snap.projected;
  if(!sameJson(doc.log, log)) fields.log = log;

  if(Object.keys(fields).length){
    const ref = db.doc(`seasons/${year}`);
    const exists = (await step("season read", () => ref.get())).exists;
    if(!exists){
      await step("season create", () => ref.set({ year, ranking: [], ...fields }));
    } else {
      // A club that left the field would otherwise stay in `teams`.
      const cleared = Object.keys(fields).filter(k => losesKeys(doc[k], fields[k]));
      if(cleared.length) await step("season clear", () => ref.update(Object.fromEntries(cleared.map(k => [k, null]))));
      await step("season", () => ref.update(fields));
    }
    /* Ahead of the store's echo, so the next snapshot compares against what
       was just written. The echo then matches and redraws nothing, so the
       one view the log feeds is redrawn here. */
    Object.assign(seasonDoc, fields);
    if(fields.log){
      composeState();
      renderUpdates();
    }
  }

  if(snap.standings && !sameJson(storedStandings && storedStandings.divisions, snap.standings.divisions)){
    const table = { ...snap.standings, updatedAt: snap.asOf };
    await step("standings", () => db.doc(`standings/${year}`).set(table));
    storedStandings = table;
  }
}

/* Where live data came from on this view, what went wrong fetching it,
   and the last save that failed, kept in the store so the owner (or
   Claude, with the ArtifactData tool) can see why a page isn't updating
   without opening a browser console. Written only when it changes, never
   on a timer, and even after saves are blocked: it may be the only thing
   that says why. */
function report(change){
  Object.assign(status, change);
  const key = [status.source, status.error, status.write].join("|");
  if(!db || key === reported) return;
  reported = key;
  const doc = { ...status, at: new Date().toISOString() };
  writing = writing.then(() => db.doc("live/status").set(doc)).catch(() => {});
}
