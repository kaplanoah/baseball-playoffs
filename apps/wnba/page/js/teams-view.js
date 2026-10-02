import { countDaysBetween, formatClockTime } from "#shared/days.js";
import { html, joinWithSeparator, setHtml } from "#shared/html.js";
import { renderDot } from "./clubs.js";
import { describeDay, readGameDay } from "./days.js";
import { nameTeam, readPlayoffRuns } from "./series.js";
import { ROUNDS } from "./snapshot.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./standings-view.js").StandingsRow} StandingsRow */
/** @typedef {{ seed: number | null, round: number, isOut: boolean, isChampion: boolean }} Run */
/** @typedef {{ team: string, id: number, firstName: string, lastName: string, games: number, points: number, rebounds: number, assists: number }} Leader */
/** @typedef {{ series?: Series[], standings?: StandingsRow[], games?: Game[], leaders?: Leader[] }} Season */

// Phosphor's caret, in the Light weight the app's other icons use.
const CARET = html`<svg class="team-caret" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M212.24,100.24l-80,80a6,6,0,0,1-8.48,0l-80-80a6,6,0,0,1,8.48-8.48L128,167.51l75.76-75.75a6,6,0,0,1,8.48,8.48Z" /></svg>`;

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
 * @param {StandingsRow | undefined} row
 * @param {Run | undefined} run
 */
const renderSlot = (row, run) =>
  html`<span class="team-slot">
    ${row && html`<span class="conference-chip ${row.conference.toLowerCase()}">${row.conference}</span>`}
    ${run?.seed && html`<span class="team-seed">${run.seed} seed</span>`}
  </span>`;

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

/**
 * @param {string} code
 * @param {{ before: number[], now: number[] }} titles
 */
function renderLastTitle(code, titles) {
  const last = titles.now[0] ?? titles.before.at(-1);
  const formerTeam = !titles.now.length && last && TEAMS[code].titlesAs;
  return html`<span class="team-last-title"
    ><span class="team-label">Last title</span><span class="team-title-year tabular"
      >${last ?? "None yet"}</span
    >${formerTeam && html`<span class="team-former">(as ${formerTeam})</span>`}</span
  >`;
}

/** @param {number} margin */
const formatMargin = (margin) => (margin > 0 ? `+${margin.toFixed(1)}` : margin.toFixed(1));

/** @param {StandingsRow | undefined} row */
function renderStats(row) {
  if (!row) return false;
  const stats = [
    ["Points", row.pointsFor?.toFixed(1)],
    ["Allowed", row.pointsAgainst?.toFixed(1)],
    ["Net", row.margin == null ? null : formatMargin(row.margin)],
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

/** @param {Leader | undefined} leader */
const renderTopScorer = (leader) =>
  leader &&
  html`<p class="team-detail">
    <span class="team-label">Top scorer</span>${joinWithSeparator([
      html`<b>${leader.firstName} ${leader.lastName}</b>`,
      html`<span class="tabular">${leader.points.toFixed(1)} pts</span>`,
      html`<span class="tabular">${leader.rebounds.toFixed(1)} reb</span>`,
      html`<span class="tabular">${leader.assists.toFixed(1)} ast</span>`,
    ])}
  </p>`;

/**
 * @param {string} code
 * @param {{ before: number[], now: number[] }} titles
 */
function renderTitles(code, titles) {
  const count = titles.before.length + titles.now.length;
  if (!count) return false;
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
 * @param {string} team
 * @param {{ finished: Game[], next: Game | null }} games
 * @param {boolean} isPlaying
 * @param {number} now
 */
function renderPlayoffs(team, { finished, next }, isPlaying, now) {
  const shownNext = isPlaying && next;
  if (!finished.length && !shownNext) return false;
  return html`<div class="team-playoffs">
    <h3 class="section-label">Playoffs</h3>
    ${finished.map((game) => renderFinishedGame(game, team))}
    ${shownNext && renderNextGame(shownNext, team, now)}
  </div>`;
}

/**
 * Every team, in the order of the league's standings: its conference, seed, record, last title,
 * and how far it got, opening to its season.
 * @param {Season | null} season
 * @param {{ year: number, now: number, openTeams?: Set<string> }} options
 */
export function renderTeams(season, { year, now, openTeams = new Set() }) {
  const rowsByTeam = new Map((season?.standings ?? []).map((row) => [row.team, row]));
  const runs = readPlayoffRuns(season?.series ?? []);
  const place = (code) => rowsByTeam.get(code)?.place ?? Infinity;
  const codes = Object.keys(TEAMS).sort(
    (first, second) => place(first) - place(second) || first.localeCompare(second),
  );
  const items = codes.map((code) => {
    const team = TEAMS[code];
    const row = rowsByTeam.get(code);
    const run = runs.get(code);
    const games = listTeamGames(season ?? {}, code);
    const isPlaying = !!run && !run.isOut && !run.isChampion;
    const chip = describeChip(run, isPlaying ? games.next : null, { hasField: runs.size > 0, now });
    const titles = listTitles(code, run, year);
    const isDone = runs.size > 0 && (!run || run.isOut);
    return html`<details class="team${isDone ? " done" : ""}" data-team="${code}" ${openTeams.has(code) && html`open`}>
      <summary>
        ${renderSlot(row, run)}
        <span class="team-lines">
          <span class="team-heading">${renderDot(code)}<span class="team-full-name">${team.city} ${team.name}</span></span>
          ${row && html`<span class="team-record tabular">${row.wins}-${row.losses}</span>`}
          ${renderLastTitle(code, titles)}
        </span>
        ${renderChip(chip)}${CARET}
      </summary>
      <div class="team-season">
        ${renderStats(row)}${renderTopScorer(findTeamLeaders(season, code)[0])}${renderTitles(code, titles)}
        ${renderPlayoffs(code, games, isPlaying, now)}
      </div>
    </details>`;
  });
  return html`<div class="team-list">${items}</div>`;
}

/**
 * Draws the teams, keeping open the ones the viewer opened, and the keyboard on the one it was on.
 * @param {HTMLElement} wrap
 * @param {Season | null} season
 * @param {{ year: number, now: number }} options
 */
export function drawTeams(wrap, season, options) {
  const openTeams = new Set(
    [...wrap.querySelectorAll("details[open]")].map(
      (details) => /** @type {HTMLElement} */ (details).dataset.team ?? "",
    ),
  );
  const focused = document.activeElement;
  const focusedTeam =
    focused instanceof HTMLElement && wrap.contains(focused)
      ? /** @type {HTMLElement | null} */ (focused.closest("[data-team]"))?.dataset.team
      : null;
  setHtml(wrap, renderTeams(season, { ...options, openTeams }));
  if (focusedTeam)
    /** @type {HTMLElement | null} */ (
      wrap.querySelector(`[data-team="${focusedTeam}"] summary`)
    )?.focus();
}
