import { countDaysBetween, formatClockTime } from "#shared/days.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { renderDot } from "./clubs.js";
import { describeDay, readGameDay } from "./days.js";
import { nameTeam, readPlayoffRuns } from "./series.js";
import { renderSheetPart } from "./sheet-parts.js";
import { ROUNDS } from "./snapshot.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./standings-view.js").StandingsRow} StandingsRow */
/** @typedef {{ seed: number | null, round: number, isOut: boolean, isChampion: boolean }} Run */
/** @typedef {{ team: string, id: number, firstName: string, lastName: string, games: number, points: number, rebounds: number, assists: number }} Leader */
/** @typedef {{ series?: Series[], standings?: StandingsRow[], games?: Game[], leaders?: Leader[] }} Season */

/**
 * @param {Game} game
 * @param {string} team
 */
const findPlace = (game, team) =>
  game.home.team === team ? "home" : game.away.team === team ? "away" : null;

/**
 * A team's leading scorers, best first.
 * @param {Season | null} season
 * @param {string} team
 */
export const findTeamLeaders = (season, team) =>
  (season?.leaders ?? []).filter((leader) => leader.team === team);

const OTHER_PLACE = { home: "away", away: "home" };

/**
 * A team's playoff games: those it has finished, and the next one it plays, if any. A game left
 * over in a series that's already decided won't be played.
 * @param {Season} season
 * @param {string} team
 */
function listTeamGames(season, team) {
  const decided = new Set(
    (season.series ?? []).filter((series) => series.winner).map((series) => series.id),
  );
  const games = (season.games ?? []).filter((game) => findPlace(game, team));
  const finished = games.filter((game) => game.state === "final");
  const next = games.find((game) => game.state !== "final" && !decided.has(game.series ?? ""));
  return { finished, next: next ?? null };
}

/**
 * @param {Game} game
 * @param {number} now
 */
const isToday = (game, now) => {
  const day = readGameDay(game);
  return !!day && countDaysBetween(new Date(now), day) === 0;
};

/**
 * @param {Game} game
 * @param {number} now
 */
function describeWhen(game, now) {
  if (game.state === "live") return "Live";
  const day = readGameDay(game);
  if (!day) return "";
  const time = game.isTimeSet && game.start ? ` ${formatClockTime(new Date(game.start))}` : "";
  return `${describeDay(day, now)}${time}`;
}

/**
 * @param {Run | undefined} run
 * @param {Game | null} next
 * @param {{ hasField: boolean, now: number }} context
 */
function describeChip(run, next, { hasField, now }) {
  if (!run) return hasField ? { label: "Missed", kind: "missed" } : null;
  const round = ROUNDS[run.round].shortName;
  if (run.isChampion) return { label: "Champions", kind: "champion" };
  if (run.isOut) return { label: `Out ${round}`, kind: "out" };
  if (next?.state === "live") return { label: `${round} live`, kind: "now" };
  if (next && isToday(next, now)) return { label: `${round} today`, kind: "now" };
  return { label: round, kind: "alive" };
}

/** @param {{ label: string, kind: string } | null} chip */
const renderChip = (chip) =>
  chip && html`<span class="status-chip ${chip.kind}">${chip.label}</span>`;

/**
 * The seasons a team won it all: those it had won before, and this one once it has.
 * @param {string} code
 * @param {Run | undefined} run
 * @param {number} year
 */
function listTitles(code, run, year) {
  const before = TEAMS[code].titles.filter((title) => title !== year);
  return { before, now: run?.isChampion ? [year] : [] };
}

/** @param {number} margin */
const formatMargin = (margin) => (margin > 0 ? `+${margin.toFixed(1)}` : margin.toFixed(1));

/** @param {StandingsRow | undefined} row */
function renderStats(row) {
  if (!row) return false;
  const stats = [
    ["PPG", row.pointsFor?.toFixed(1)],
    ["Opp PPG", row.pointsAgainst?.toFixed(1)],
    ["Margin", row.margin == null ? null : formatMargin(row.margin)],
    ["Home", row.home],
    ["Road", row.road],
    ["Last 10", row.lastTen],
  ].filter(([, value]) => value != null);
  if (!stats.length) return false;
  return html`<div class="team-stats">
    ${stats.map(
      ([label, value]) =>
        html`<div class="team-stat">
          <span class="team-label">${label}</span><b class="tabular">${value}</b>
        </div>`,
    )}
  </div>`;
}

/**
 * @param {number} value
 * @param {string} label
 */
const renderAverage = (value, label) =>
  html`<span class="tabular">${value.toFixed(1)} <span class="team-label">${label}</span></span>`;

// The name and the averages each keep to one line, and the averages move under the name together
// when both don't fit.
/** @param {Leader | undefined} leader */
const renderLeadingScorer = (leader) =>
  leader &&
  html`<p class="team-detail team-scorer">
    <span class="team-label">Leading scorer</span><b>${leader.firstName} ${leader.lastName}</b
    ><span class="team-averages">${joinWithSeparator([
      renderAverage(leader.points, "Pts"),
      renderAverage(leader.rebounds, "Reb"),
      renderAverage(leader.assists, "Ast"),
    ])}</span>
  </p>`;

/**
 * @param {string} code
 * @param {{ before: number[], now: number[] }} titles
 */
function renderTitles(code, titles) {
  const count = titles.before.length + titles.now.length;
  if (!count)
    return html`<p class="team-detail"><span class="team-label">Titles</span>None yet</p>`;
  const formerTeam = TEAMS[code].titlesAs;
  const before = titles.before.join(", ") + (formerTeam ? ` (as ${formerTeam})` : "");
  const years = [titles.before.length ? before : "", ...titles.now].filter(Boolean).join(", ");
  return html`<p class="team-detail">
    <span class="team-label">Titles</span>${joinWithSeparator([
      html`<b>${count}</b>`,
      html`<span class="tabular">${years}</span>`,
    ])}
  </p>`;
}

/**
 * @param {Game} game
 * @param {string} team
 */
function describeMatchup(game, team) {
  const place = findPlace(game, team) ?? "home";
  const opponent = game[OTHER_PLACE[place]].team;
  const round = game.round ? ROUNDS[game.round].shortName : "";
  return html`${place === "home" ? "vs" : "at"} ${nameTeam(opponent)}
    <span class="team-round">${round}</span>`;
}

/**
 * @param {Game} game
 * @param {string} team
 */
function renderFinishedGame(game, team) {
  const place = findPlace(game, team) ?? "home";
  const own = game[place].score ?? 0;
  const theirs = game[OTHER_PLACE[place]].score ?? 0;
  const isWin = own > theirs;
  return html`<div class="team-game">
    <span class="team-game-number">G${game.number}</span>
    <span class="team-result ${isWin ? "won" : "lost"}">${isWin ? "W" : "L"}</span>
    <span class="team-matchup">${describeMatchup(game, team)}</span>
    <span class="team-score tabular">${own}-${theirs}</span>
  </div>`;
}

/**
 * @param {Game} game
 * @param {string} team
 * @param {number} now
 */
function renderNextGame(game, team, now) {
  const isSoon = game.state === "live" || isToday(game, now);
  return html`<div class="team-game next${isSoon ? " soon" : ""}">
    <span class="team-game-number">G${game.number}</span>
    <span class="team-result" aria-hidden="true">&rsaquo;</span>
    <span class="team-matchup">${describeMatchup(game, team)}</span>
    <span class="team-when">${describeWhen(game, now)}</span>
  </div>`;
}

/**
 * The team's playoff games under its run so far, or only the run for a team that missed them.
 * @param {string} team
 * @param {{ finished: Game[], next: Game | null }} games
 * @param {{ label: string, kind: string } | null} chip
 * @param {{ isPlaying: boolean, now: number }} context
 */
function renderPlayoffs(team, { finished, next }, chip, { isPlaying, now }) {
  if (!chip) return false;
  const shownNext = isPlaying && next;
  return renderSheetPart(
    "Playoffs",
    html`<div class="team-playoffs">
      ${finished.map((game) => renderFinishedGame(game, team))}
      ${shownNext && renderNextGame(shownNext, team, now)}
    </div>`,
    renderChip(chip),
  );
}

/**
 * @param {StandingsRow | undefined} row
 * @param {Run | undefined} run
 */
const listFacts = (row, run) =>
  [row?.conference, run?.seed && `${run.seed} seed`, row && `${row.wins}-${row.losses}`].filter(
    Boolean,
  );

/**
 * The sheet a team opens: its name, its conference, seed, and record, then its season and how far
 * it got in the playoffs.
 * @param {Season | null} season
 * @param {string} code
 * @param {{ year: number, now: number }} options
 */
export function renderTeamSheet(season, code, { year, now }) {
  const team = TEAMS[code];
  const row = season?.standings?.find((each) => each.team === code);
  const runs = readPlayoffRuns(season?.series ?? []);
  const run = runs.get(code);
  const games = listTeamGames(season ?? {}, code);
  const isPlaying = !!run && !run.isOut && !run.isChampion;
  const chip = describeChip(run, isPlaying ? games.next : null, { hasField: runs.size > 0, now });
  const titles = listTitles(code, run, year);
  return {
    heading: html`${renderDot(code)}<span>${team.city} ${team.name}</span>`,
    note: joinWithSeparator(listFacts(row, run)),
    body: html`${renderSheetPart(
      "Season",
      html`<div class="team-season">
        ${renderStats(row)}${renderLeadingScorer(findTeamLeaders(season, code)[0])}${renderTitles(code, titles)}
      </div>`,
    )}
    ${renderPlayoffs(code, games, chip, { isPlaying, now })}`,
  };
}
