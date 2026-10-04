import { isSameJson } from "#shared/compare.js";
import { redrawEased } from "#shared/eased-redraw.js";
import { describeLiveError } from "#shared/live-errors.js";
import { fetchLive, isReadableLive } from "./live-fetch.js";
import { renderAll } from "./render.js";
import { reloadIfReplaced } from "#shared/resume.js";
import { session, composeState } from "./session.js";
import { renderStamp } from "./stamp-view.js";

// The Worker keeps the current season's live scores in the store as it reads MLB, and pushes each
// change to the page. A season it never kept them for, or a page whose store didn't load, reads
// them from the Worker once.

let liveError = null;
let liveWarning = null;
let statusProblem = null;
/** @type {(() => void) | null} */
let unwatchLive = null;

function describeMissingFields(missing) {
  if (!missing.length) return null;
  return `MLB stopped sending ${missing.join(", ")}, so some details may be blank.`;
}

function updateLiveProblem() {
  session.liveProblem = liveError ? liveError.message : (statusProblem ?? liveWarning);
}

function renderUnlessReordering() {
  if (!session.isReordering) renderAll();
}

function applyLive(snapshot) {
  const previous = session.live;
  session.live = snapshot;
  const { asOf: _asOf, ...current } = snapshot;
  const { asOf: _previousAsOf, ...before } = previous || {};
  composeState();
  if (previous && isSameJson(current, before)) renderStamp();
  else redrawEased(renderUnlessReordering);
}

// A page older than the Worker can't read what it sends, so it reloads once a deploy has
// replaced it.
function recordLiveFailure(error) {
  liveError = describeLiveError(error);
  updateLiveProblem();
  renderStamp();
  if (!liveError.retry) reloadIfReplaced();
}

function acceptLiveSnapshot(snapshot) {
  if (!isReadableLive(snapshot, session.activeYear)) {
    recordLiveFailure({ code: "bad_payload" });
    return;
  }
  liveError = null;
  liveWarning = describeMissingFields(snapshot.missing || []);
  updateLiveProblem();
  applyLive(snapshot);
}

/** @param {number} season */
async function loadUnkeptLive(season) {
  try {
    const snapshot = await fetchLive(season);
    if (season === session.activeYear) acceptLiveSnapshot(snapshot);
  } catch (error) {
    if (season === session.activeYear) recordLiveFailure(error);
  }
}

// Scores the page already shows for this season stay until the store sends newer ones, so a
// redraw meanwhile doesn't drop them.
export function startLive() {
  if (session.live?.season !== session.activeYear) session.live = null;
  liveError = null;
  liveWarning = null;
  updateLiveProblem();
  unwatchLive?.();
  unwatchLive = null;
  const season = session.activeYear;
  if (!session.db) {
    loadUnkeptLive(season);
    return;
  }
  let isUnkeptLoading = false;
  unwatchLive = session.db.doc(`live/${season}`).onSnapshot((snapshot) => {
    if (season !== session.activeYear) return;
    if (snapshot.exists) acceptLiveSnapshot(snapshot.data());
    else if (!isUnkeptLoading) {
      isUnkeptLoading = true;
      loadUnkeptLive(season);
    }
  });
}

// The Worker saves why its last read of MLB failed, so while it can't reach MLB, the page says
// so over the scores the Worker last had.
export function watchLiveStatus() {
  session.db?.doc("live/status").onSnapshot((snapshot) => {
    const status = snapshot.exists ? snapshot.data() : null;
    statusProblem =
      status?.error === "upstream_error" ? describeLiveError({ code: status.error }).message : null;
    updateLiveProblem();
    renderStamp();
  });
}
