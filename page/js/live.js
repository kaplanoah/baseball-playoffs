import * as MLBSnapshot from "./snapshot.js";
import { sameJson } from "./compare.js";
import { describeLiveError } from "./live-errors.js";
import { fetchLive, findLiveSource } from "./live-fetch.js";
import { reportStatus, saveLive } from "./live-store.js";
import { renderAll } from "./render.js";
import { session, composeState } from "./session.js";
import { renderStamp } from "./stamp-view.js";

const RETRY_MS = [30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3];

let liveError = null;
let liveWarning = null;
let liveTimer;
let liveDueAt = Infinity;
let liveSequence = 0;
let liveFailures = 0;

function scheduleLive(ms) {
  clearTimeout(liveTimer);
  liveDueAt = ms == null ? Infinity : Date.now() + ms;
  if (ms != null) liveTimer = setTimeout(refreshLive, ms);
}

// The fix is in claude.ai, usually in another tab, so retry when this one is shown again.
function waitForVisibility() {
  clearTimeout(liveTimer);
  liveDueAt = Date.now();
}

function describeMissingFields(missing) {
  if (!missing.length) return null;
  return `MLB stopped sending ${missing.join(", ")}, so some details may be blank.`;
}

function updateLiveProblem() {
  session.liveProblem = liveError ? liveError.message : liveWarning;
}

function renderUnlessReordering() {
  if (!session.isReordering) renderAll();
}

function applyLive(snapshot) {
  if (snapshot.season !== session.activeYear) return;
  const previous = session.live;
  session.live = snapshot;
  const { asOf: _asOf, ...current } = snapshot;
  const { asOf: _previousAsOf, ...before } = previous || {};
  composeState();
  if (previous && sameJson(current, before)) renderStamp();
  else renderUnlessReordering();
  saveLive(snapshot);
}

function handleLiveSnapshot(snapshot, source) {
  liveError = null;
  liveFailures = 0;
  const missing = snapshot.missing || [];
  liveWarning = describeMissingFields(missing);
  updateLiveProblem();
  applyLive(snapshot);
  reportStatus({
    source,
    error: missing.length ? "mlb_fields_missing" : "",
    detail: missing.join(", "),
  });
  scheduleLive(MLBSnapshot.pollDelay(snapshot));
}

function handleLiveFailure(error) {
  liveError = describeLiveError(error);
  updateLiveProblem();
  if (liveError.retract && session.live) {
    session.live = null;
    composeState();
    renderUnlessReordering();
  } else {
    renderStamp();
  }
  reportStatus({
    source: findLiveSource(),
    error: liveError.code,
    detail: liveError.detail,
  });
  if (liveError.retry) scheduleLive(RETRY_MS[Math.min(liveFailures++, RETRY_MS.length - 1)]);
  else waitForVisibility();
}

async function refreshLive() {
  clearTimeout(liveTimer);
  if (document.hidden) {
    liveDueAt = Math.min(liveDueAt, Date.now());
    return;
  }
  const season = session.activeYear;
  const sequence = ++liveSequence;
  try {
    const { snapshot, source } = await fetchLive(season);
    if (sequence === liveSequence) handleLiveSnapshot(snapshot, source);
  } catch (error) {
    if (sequence === liveSequence) handleLiveFailure(error);
  }
}

export function startLive() {
  session.live = null;
  liveError = null;
  liveWarning = null;
  updateLiveProblem();
  liveFailures = 0;
  refreshLive();
}

export function watchPageVisibility() {
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() >= liveDueAt) refreshLive();
  });
  addEventListener("online", () => {
    if (liveDueAt !== Infinity) refreshLive();
  });
}
