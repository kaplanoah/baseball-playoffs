import * as MLBSnapshot from "./snapshot.js";
import { isSameJson } from "#shared/compare.js";
import { describeLiveError } from "#shared/live-errors.js";
import { fetchLive } from "./live-fetch.js";
import { renderAll } from "./render.js";
import { reloadIfReplaced } from "#shared/resume.js";
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

// A page older than the Worker needs a reload, so it reloads if a deploy has replaced it, and
// otherwise tries again only when it is shown again.
function waitForReplacement() {
  clearTimeout(liveTimer);
  liveDueAt = Date.now();
  reloadIfReplaced();
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
  if (previous && isSameJson(current, before)) renderStamp();
  else renderUnlessReordering();
}

function acceptLiveSnapshot(snapshot) {
  liveError = null;
  liveFailures = 0;
  const missing = snapshot.missing || [];
  liveWarning = describeMissingFields(missing);
  updateLiveProblem();
  applyLive(snapshot);
  scheduleLive(MLBSnapshot.choosePollDelay(snapshot));
}

function recordLiveFailure(error) {
  liveError = describeLiveError(error);
  updateLiveProblem();
  renderStamp();
  if (liveError.retry) scheduleLive(RETRY_MS[Math.min(liveFailures++, RETRY_MS.length - 1)]);
  else waitForReplacement();
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
    const snapshot = await fetchLive(season);
    if (sequence === liveSequence) acceptLiveSnapshot(snapshot);
  } catch (error) {
    if (sequence === liveSequence) recordLiveFailure(error);
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
