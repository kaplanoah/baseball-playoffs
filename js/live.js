const LIVE_SERVER = "MLB Live";
const LIVE_TOOL = "get_snapshot";
const LIVE_CACHE_MS = 15 * 1000;
const FRESH_FINAL_MS = 10 * 60 * 1000;
const RETRY_MS = [30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3];

let live = null;
let liveError = null;
let liveTimer = 0;
let liveDueAt = Infinity;
let liveSeq = 0;
let liveFailures = 0;
let directBlocked = false;
let mcp;
let writesBlocked = false;
let writing = Promise.resolve();
let reported = "";
let liveStatus = { source: "", error: "", detail: "", write: "" };

class LiveError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

async function fetchDirect(season) {
  return MLBSnapshot.fetchSnapshot(async (path) => {
    const res = await fetch(MLBSnapshot.MLB_API + path);
    if (!res.ok) throw new LiveError("upstream_error", `MLB answered ${res.status}`);
    return res.json();
  }, season);
}

async function fetchViaConnector(season) {
  if (mcp === undefined) {
    try {
      mcp = await window.claude?.use?.("mcp");
    } catch {
      mcp = null;
    }
  }
  if (!mcp) throw new LiveError("no_mcp", "no connector access in this view");
  let result;
  try {
    result = await mcp.callTool(
      LIVE_SERVER,
      LIVE_TOOL,
      { season },
      { cache: { staleTime: LIVE_CACHE_MS } },
    );
  } catch (e) {
    throw (await connectorMissing())
      ? new LiveError("server_not_connected", `${e && e.code}: not added`)
      : e;
  }
  const snap = result && result.payload;
  if (!snap || snap.version !== 1 || snap.season !== season)
    throw new LiveError("bad_payload", "unexpected answer");
  return snap;
}

// A never-added connector fails calls with a vague code, and lists with no tools or not at all.
async function connectorMissing() {
  try {
    const { servers } = await mcp.listTools(LIVE_SERVER);
    const mine = (servers || []).find((x) => x.server === LIVE_SERVER);
    return !mine || !(mine.tools || []).length;
  } catch {
    return false;
  }
}

// A TypeError while online means the sandbox refused the request, so use the connector from then on.
async function fetchLive(season) {
  if (!directBlocked) {
    try {
      return { snap: await fetchDirect(season), source: "direct" };
    } catch (e) {
      if (!(e instanceof TypeError) || navigator.onLine === false) throw e;
      directBlocked = true;
    }
  }
  return { snap: await fetchViaConnector(season), source: "connector" };
}

function describeLiveError(e) {
  const code = (e && e.code) || "upstream_error";
  const where = "claude.ai's connector settings";
  const says = {
    server_not_connected: `Live scores need the ${LIVE_SERVER} connector: add it in ${where}.`,
    needs_reauth: `Reconnect ${LIVE_SERVER} in ${where} for live scores.`,
    selection_required: `Choose which ${LIVE_SERVER} connector this page should use.`,
    not_in_manifest: "Live scores are turned off for this page. Reload to be asked again.",
    blocked_by_policy: `Your organization doesn't allow ${LIVE_SERVER} here.`,
    approval_required: `Your organization requires approval for ${LIVE_SERVER}.`,
    no_mcp: "Live scores aren't available in this view.",
    not_granted: "Live scores aren't available in this view.",
    capability_disabled: "Live scores aren't available in this view.",
    bad_payload: `${LIVE_SERVER} answered with something unexpected. Is it up to date?`,
    tool_error: `MLB didn't answer (${(e && e.message) || "no reason given"}). Trying again shortly.`,
  };
  const permanent = [
    "server_not_connected",
    "needs_reauth",
    "selection_required",
    "not_in_manifest",
    "blocked_by_policy",
    "approval_required",
    "no_mcp",
    "not_granted",
    "capability_disabled",
    "bad_payload",
    "bad_request",
  ];
  const denied = [
    "server_not_connected",
    "needs_reauth",
    "not_in_manifest",
    "blocked_by_policy",
    "approval_required",
  ];
  return {
    code,
    message: says[code] || "Couldn't reach live scores. Trying again shortly.",
    retry: !permanent.includes(code),
    retract: denied.includes(code),
    detail: String((e && e.message) || "").slice(0, 200),
  };
}

function scheduleLive(ms) {
  clearTimeout(liveTimer);
  liveDueAt = ms == null ? Infinity : Date.now() + ms;
  if (ms != null) liveTimer = setTimeout(refreshLive, ms);
}

async function refreshLive() {
  clearTimeout(liveTimer);
  if (document.hidden) {
    liveDueAt = Math.min(liveDueAt, Date.now());
    return;
  }
  const season = activeYear,
    seq = ++liveSeq;
  try {
    const { snap, source } = await fetchLive(season);
    if (seq !== liveSeq) return;
    liveError = null;
    liveFailures = 0;
    applyLive(snap);
    report({ source, error: "", detail: "" });
    scheduleLive(MLBSnapshot.pollDelay(snap));
  } catch (e) {
    if (seq !== liveSeq) return;
    liveError = describeLiveError(e);
    if (liveError.retract && live) {
      live = null;
      composeState();
      if (!reordering) renderAll();
    } else {
      renderStamp();
    }
    report({
      source: directBlocked ? "connector" : "direct",
      error: liveError.code,
      detail: liveError.detail,
    });
    if (liveError.retry) {
      scheduleLive(RETRY_MS[Math.min(liveFailures++, RETRY_MS.length - 1)]);
    } else {
      // The fix is in claude.ai, usually in another tab, so retry when this one is shown again.
      clearTimeout(liveTimer);
      liveDueAt = Date.now();
    }
  }
}

function startLive() {
  live = null;
  liveError = null;
  liveFailures = 0;
  refreshLive();
}

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() >= liveDueAt) refreshLive();
});
addEventListener("online", () => {
  if (liveDueAt !== Infinity) refreshLive();
});

function withLive(doc) {
  if (!live || live.season !== activeYear) return doc;
  const slate = live.slate && {
    ...live.slate,
    since: new Date(Date.parse(live.asOf) - FRESH_FINAL_MS).toISOString(),
  };
  return {
    ...doc,
    teams: live.teams,
    series: live.series,
    projected: live.projected,
    slate,
    log: LogChanges.merge(doc.log, live.log),
  };
}

function composeState() {
  state = withLive(seasonDoc);
  standings = (live && live.season === activeYear && live.standings) || storedStandings;
}

// The store hands documents back with their keys sorted, so key order must not count as a change.
function canonical(x) {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") {
    return `{${Object.keys(x)
      .sort()
      .filter((k) => x[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x === undefined ? null : x);
}
const sameJson = (a, b) => canonical(a) === canonical(b);

function applyLive(snap) {
  if (snap.season !== activeYear) return;
  const was = live;
  live = snap;
  const { asOf: _a, ...now } = snap,
    { asOf: _b, ...before } = was || {};
  composeState();
  if (was && sameJson(now, before)) renderStamp();
  else if (!reordering) renderAll();
  saveLive(snap);
}

function stampContext() {
  const projected = !state || state.projected !== false;
  const rows = standings && standings.divisions ? Object.values(standings.divisions).flat() : [];
  const alive = (id) => {
    if (!projected) return !!(state.teams && state.teams[id]) && !teamEliminated(state, id);
    const r = rows.find((x) => x.id === id);
    return !r || !(r.elim === "E" && r.wce === "E");
  };
  const seriesNote = (g) => {
    if (projected) return "";
    const br = fullBracket(state);
    const all = [br.al, br.nl]
      .filter(Boolean)
      .flatMap((b) => [...b.wc, ...b.ds, ...b.cs])
      .concat(br.ws ? [br.ws] : []);
    const s = all.find(
      (x) =>
        x.teamA && x.teamB && [x.teamA, x.teamB].sort().join() === [g.away, g.home].sort().join(),
    );
    if (!s) return "";
    const hi = Math.max(s.winsA, s.winsB),
      lo = Math.min(s.winsA, s.winsB);
    const lead = s.winsA > s.winsB ? s.teamA : s.teamB;
    if (s.winner) return ` — ${stampName(s.winner)} win the ${seriesLabel(s.id)} ${hi}-${lo}`;
    if (hi === lo) return ` — series even ${hi}-${lo}`;
    return ` — ${stampName(lead)} now lead ${hi}-${lo}`;
  };
  return { ranking: (state && state.ranking) || [], alive, seriesNote, now: new Date() };
}

function stampLine(label, when, why) {
  return `<span>${label} <b>${when}</b>${why ? ` &mdash; ${why}` : ""}</span>`;
}

function stampLines() {
  const ctx = stampContext();
  if (live && live.season === activeYear) {
    if (!state.slate) return [];
    const latest = lastStampText(state.slate, ctx);
    const lines = latest
      ? [`<span><b class="lead">${stampWhenHtml(new Date(live.asOf))}</b>${latest}</span>`]
      : [];
    const next = upNextText(state.slate, ctx);
    if (next) {
      const at = new Date(next.at);
      lines.push(
        stampLine("Next first pitch", next.tbd ? stampDay(at) : stampWhenHtml(at), next.text),
      );
    }
    return lines;
  }
  const saved = [state && state.updatedAt, standings && standings.updatedAt]
    .map((t) => Date.parse(t))
    .filter((n) => !isNaN(n));
  if (!saved.length) return [];
  return [
    stampLine(
      "Saved",
      stampWhenHtml(new Date(Math.max(...saved))),
      state.slate ? lastStampText(state.slate, ctx) : "",
    ),
  ];
}

function renderStamp() {
  const el = document.getElementById("stamp");
  const lines = state ? stampLines() : [];
  if (liveError) lines.push(`<span class="stamp-err">${liveError.message}</span>`);
  el.hidden = !lines.length;
  el.innerHTML = lines.join("");
}

setInterval(() => {
  try {
    renderStamp();
  } catch {
    /* try again next minute */
  }
}, 60 * 1000);

function saveLive(snap) {
  if (!db || writesBlocked) return;
  writing = writing
    .then(() => writeLive(snap))
    .then(
      () => {
        report({ write: "" });
      },
      (e) => {
        const code = (e && e.code) || "error";
        if (
          [
            "not_granted",
            "capability_disabled",
            "revoked",
            "invalid_argument",
            "quota_exceeded",
          ].includes(code)
        )
          writesBlocked = true;
        report({
          write: `${(e && e.step) || "write"}: ${code}: ${String((e && e.message) || "").slice(0, 160)}`,
        });
      },
    );
}

async function step(name, write) {
  try {
    return await write();
  } catch (e) {
    throw Object.assign(e && typeof e === "object" ? e : new Error(String(e)), { step: name });
  }
}

// update() merges objects key by key, so a key can't be removed by leaving it out.
function losesKeys(was, now) {
  if (!was || typeof was !== "object" || Array.isArray(was)) return false;
  if (!now || typeof now !== "object" || Array.isArray(now)) return true;
  return Object.keys(was).some((k) => !(k in now) || losesKeys(was[k], now[k]));
}

// Season before standings: if the standings write fails, the old baseline finds the same changes
// again next time, and the log's keys keep them single.
async function writeLive(snap) {
  if (snap.season !== activeYear) return;
  const year = snap.season;
  const doc = seasonDoc;
  const news = LogChanges.between(
    { teams: doc.teams, projected: doc.projected, standings: storedStandings },
    snap,
  );
  const log = LogChanges.merge(doc.log, [...snap.log, ...news]);

  const fields = {};
  if (!sameJson(doc.teams, snap.teams)) fields.teams = snap.teams;
  if (!sameJson(doc.series, snap.series)) fields.series = snap.series;
  if (doc.projected !== snap.projected) fields.projected = snap.projected;
  if (!sameJson(doc.log, log)) fields.log = log;

  if (Object.keys(fields).length) {
    const ref = db.doc(`seasons/${year}`);
    const exists = (await step("season read", () => ref.get())).exists;
    if (!exists) {
      await step("season create", () => ref.set({ year, ranking: [], ...fields }));
    } else {
      const cleared = Object.keys(fields).filter((k) => losesKeys(doc[k], fields[k]));
      if (cleared.length)
        await step("season clear", () =>
          ref.update(Object.fromEntries(cleared.map((k) => [k, null]))),
        );
      await step("season", () => ref.update(fields));
    }
    // Applied before the store echoes it back; the echo then redraws nothing, so the log is redrawn here.
    Object.assign(seasonDoc, fields);
    if (fields.log) {
      composeState();
      renderUpdates();
    }
  }

  if (
    snap.standings &&
    !sameJson(storedStandings && storedStandings.divisions, snap.standings.divisions)
  ) {
    const table = { ...snap.standings, updatedAt: snap.asOf };
    await step("standings", () => db.doc(`standings/${year}`).set(table));
    storedStandings = table;
  }
}

// Stored so a page that stops updating can be diagnosed without its browser console.
function report(change) {
  Object.assign(liveStatus, change);
  const key = [liveStatus.source, liveStatus.error, liveStatus.write].join("|");
  if (!db || key === reported) return;
  reported = key;
  const doc = { ...liveStatus, at: new Date().toISOString() };
  writing = writing.then(() => db.doc("live/status").set(doc)).catch(() => {});
}
