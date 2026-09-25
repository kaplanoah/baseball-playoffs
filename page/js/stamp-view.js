import { findSeriesBetween, isEliminated, seriesLabel } from "./bracket.js";
import { escapeHtml } from "./html.js";
import { session } from "./session.js";
import { stampName, lastStampText, upNextText, stampWhenHtml, stampDay } from "./stamp.js";

function isAliveInStandings(id) {
  const divisions = (session.standings && session.standings.divisions) || {};
  const row = Object.values(divisions)
    .flat()
    .find((candidate) => candidate.id === id);
  return !row || !(row.elim === "E" && row.wce === "E");
}

function describeSeriesAfter(game) {
  const series = findSeriesBetween(session.state, game.away, game.home);
  if (!series) return "";
  const high = Math.max(series.winsA, series.winsB);
  const low = Math.min(series.winsA, series.winsB);
  const leader = series.winsA > series.winsB ? series.teamA : series.teamB;
  if (series.winner)
    return ` \u2014 ${stampName(series.winner)} win the ${seriesLabel(series.id)} ${high}-${low}`;
  if (high === low) return ` \u2014 series even ${high}-${low}`;
  return ` \u2014 ${stampName(leader)} now lead ${high}-${low}`;
}

function buildStampContext() {
  const projected = !session.state || session.state.projected !== false;
  const isAliveInBracket = (id) =>
    !!(session.state.teams && session.state.teams[id]) && !isEliminated(session.state, id);
  return {
    ranking: (session.state && session.state.ranking) || [],
    alive: projected ? isAliveInStandings : isAliveInBracket,
    seriesNote: projected ? () => "" : describeSeriesAfter,
    now: new Date(),
  };
}

function renderStampLine(label, when, why) {
  return `<span>${label} <b>${when}</b>${why ? ` &mdash; ${why}` : ""}</span>`;
}

function renderLiveLines() {
  if (!session.state.slate) return [];
  const context = buildStampContext();
  const latest = lastStampText(session.state.slate, context);
  const lines = latest
    ? [`<span><b class="lead">${stampWhenHtml(new Date(session.live.asOf))}</b>${latest}</span>`]
    : [];
  const next = upNextText(session.state.slate, context);
  if (next) {
    const at = new Date(next.at);
    lines.push(
      renderStampLine("Next first pitch", next.tbd ? stampDay(at) : stampWhenHtml(at), next.text),
    );
  }
  return lines;
}

// Without live scores, only the stored standings say how current the page is.
function renderSavedLines() {
  const savedAt = Date.parse(session.standings && session.standings.updatedAt);
  return Number.isNaN(savedAt) ? [] : [renderStampLine("Saved", stampWhenHtml(new Date(savedAt)))];
}

function renderStampLines() {
  if (!session.state) return [];
  const isLive = session.live && session.live.season === session.activeYear;
  return isLive ? renderLiveLines() : renderSavedLines();
}

export function renderStamp() {
  const stamp = document.getElementById("stamp");
  const problems = [session.liveProblem, session.saveProblem].filter(Boolean);
  const lines = [
    ...renderStampLines(),
    ...problems.map((problem) => `<span class="stamp-err">${escapeHtml(problem)}</span>`),
  ];
  stamp.hidden = !lines.length;
  stamp.innerHTML = lines.join("");
}

// The failure is already on the stamp, so a rejected save needs nothing more here.
export function showSaveResult(saving) {
  return saving.then(renderStamp, () => renderStamp());
}
