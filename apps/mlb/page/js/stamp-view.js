import { findSeriesBetween, isEliminated, nameSeries } from "./bracket.js";
import { nameDay } from "#shared/days.js";
import { html } from "#shared/html.js";
import { fillStamp, renderStampLine, renderStampWhen } from "#shared/stamp.js";
import { findStandingsRow } from "./race.js";
import { session } from "./session.js";
import { formatStampName, describeLastStamp, describeUpNextGame } from "./stamp.js";

function isAliveInStandings(id) {
  const row = findStandingsRow(id);
  return !row || !(row.elim === "E" && row.wce === "E");
}

function describeSeriesAfter(game) {
  const series = findSeriesBetween(session.state, game.away, game.home);
  if (!series) return "";
  const high = Math.max(series.winsA, series.winsB);
  const low = Math.min(series.winsA, series.winsB);
  const leader = series.winsA > series.winsB ? series.teamA : series.teamB;
  if (series.winner)
    return ` \u2014 ${formatStampName(series.winner)} win the ${nameSeries(series.id)} ${high}-${low}`;
  if (high === low) return ` \u2014 series even ${high}-${low}`;
  return ` \u2014 ${formatStampName(leader)} now lead ${high}-${low}`;
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

function renderLiveLines() {
  if (!session.state.slate) return [];
  const context = buildStampContext();
  const latest = describeLastStamp(session.state.slate, context);
  const lines = latest ? [html`<span>${latest}</span>`] : [];
  const next = describeUpNextGame(session.state.slate, context);
  if (next) {
    const at = new Date(next.at);
    lines.push(
      renderStampLine(
        "Next first pitch",
        next.tbd ? nameDay(at, context.now) : renderStampWhen(at, context.now),
        next.text,
      ),
    );
  }
  return lines;
}

// Without live scores, only the stored standings say how current the page is.
function renderSavedLines() {
  const savedAt = Date.parse(session.standings && session.standings.updatedAt);
  return Number.isNaN(savedAt)
    ? []
    : [renderStampLine("Saved", renderStampWhen(new Date(savedAt)))];
}

function renderStampLines() {
  if (!session.state) return [];
  const isLive = session.live && session.live.season === session.activeYear;
  return isLive ? renderLiveLines() : renderSavedLines();
}

export function renderStamp() {
  const problems = [session.liveProblem, session.saveProblem].filter(Boolean);
  fillStamp(document.getElementById("stamp"), renderStampLines(), problems);
}

// The failure is already on the stamp, so a rejected save needs nothing more here.
export function showSaveResult(saving) {
  return saving.then(renderStamp, () => renderStamp());
}
