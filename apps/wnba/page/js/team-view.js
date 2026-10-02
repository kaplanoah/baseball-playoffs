import { countDaysBetween, formatClockTime } from "#shared/days.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderTapeRow } from "#shared/tape.js";
import { renderDot, renderTeamName } from "./clubs.js";
import { describeDay, readGameDay } from "./days.js";
import { nameTeam, readPlayoffRuns } from "./series.js";
import { formatTeamColors } from "./sheet-colors.js";
import { describeNumbers, describeRecords } from "./sheet-parts.js";
import { ROUNDS } from "./snapshot.js";
import { renderStreak } from "./standings-view.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./standings-view.js").StandingsRow} StandingsRow */
/** @typedef {{ seed: number | null, round: number, isOut: boolean, isChampion: boolean }} Run */
/** @typedef {{ team: string, id: number, firstName: string, lastName: string, games: number, points: number, rebounds: number, assists: number }} Leader */
/** @typedef {{ series?: Series[], standings?: StandingsRow[], games?: Game[], leaders?: Leader[] }} Season */
/** @typedef {{ record: string | null, pointsFor: number | null, pointsAgainst: number | null, margin: number | null, home: string | null, road: string | null }} PhaseStats */

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

/** @param {number} value */
const formatAverage = (value) => value.toFixed(1);

/**
 * A table of players' averages a game, under a heading over their names.
 * @param {import("#shared/html.js").Markup | string} heading
 * @param {Leader[]} leaders
 */
export const renderLeaderTable = (heading, leaders) =>
  html`<table class="players tabular">
    <thead>
      <tr>
        <th scope="col">${heading}</th>
        <th scope="col" title="Points per game">Pts</th>
        <th scope="col" title="Rebounds per game">Reb</th>
        <th scope="col" title="Assists per game">Ast</th>
      </tr>
    </thead>
    <tbody>
      ${leaders.map(
        (leader) => html`<tr>
          <th scope="row"><span class="first-name">${leader.firstName}</span> ${leader.lastName}</th>
          <td>${formatAverage(leader.points)}</td>
          <td>${formatAverage(leader.rebounds)}</td>
          <td>${formatAverage(leader.assists)}</td>
        </tr>`,
      )}
    </tbody>
  </table>`;

/** @param {Leader[]} leaders */
const renderLeadingScorers = (leaders) =>
  leaders.length > 0 && renderLeaderTable("Leading scorers", leaders);

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
 * The chip beside a team's Playoffs: its round while it's still in, how far it got once out, or
 * that it missed them once the field is set.
 * @param {Run | undefined} run
 * @param {{ hasField: boolean }} context
 */
function describeChip(run, { hasField }) {
  if (!run) return hasField ? { label: "Missed", kind: "missed" } : null;
  const round = ROUNDS[run.round].shortName;
  if (run.isChampion) return { label: "Champions", kind: "champion" };
  if (run.isOut) return { label: `Out ${round}`, kind: "out" };
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
function formatMargin(margin) {
  const shown = margin.toFixed(1);
  if (Number(shown) === 0) return "0.0";
  return margin > 0 ? `+${shown}` : shown;
}

/** @param {boolean[]} results each game's, true for a win */
function formatRecord(results) {
  const wins = results.filter(Boolean).length;
  return `${wins}-${results.length - wins}`;
}

/** @param {StandingsRow} row */
const readRegularSeason = (row) => ({
  record: `${row.wins}-${row.losses}`,
  pointsFor: row.pointsFor ?? null,
  pointsAgainst: row.pointsAgainst ?? null,
  margin: row.margin ?? null,
  home: row.home ?? null,
  road: row.road ?? null,
});

/**
 * A team's numbers through the playoff games it has finished, or null before its first.
 * @param {Game[]} finished
 * @param {string} team
 * @returns {PhaseStats | null}
 */
function readPlayoffs(finished, team) {
  if (!finished.length) return null;
  const games = finished.map((game) => {
    const place = findPlace(game, team) ?? "home";
    const own = game[place].score ?? 0;
    const theirs = game[OTHER_PLACE[place]].score ?? 0;
    return { place, own, theirs, isWin: own > theirs };
  });
  const results = games.map((game) => game.isWin);
  const average = (points) => points.reduce((sum, each) => sum + each, 0) / games.length;
  const pointsFor = average(games.map((game) => game.own));
  const pointsAgainst = average(games.map((game) => game.theirs));
  const recordAt = (place) =>
    formatRecord(games.filter((game) => game.place === place).map((game) => game.isWin));
  return {
    record: formatRecord(results),
    pointsFor,
    pointsAgainst,
    margin: pointsFor - pointsAgainst,
    home: recordAt("home"),
    road: recordAt("away"),
  };
}

/** @param {number[]} values */
const averageOf = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Wins and losses added up across records like 15-7.
 * @param {string[]} records
 */
function addRecords(records) {
  const totals = records
    .map((record) => record.split("-").map(Number))
    .reduce(([wins, losses], [won, lost]) => [wins + won, losses + lost], [0, 0]);
  return `${totals[0]}-${totals[1]}`;
}

/**
 * The league's regular season, as one side to measure a team against: its teams' average points
 * scored, allowed, and margin, and every team's home and road games added up.
 * @param {StandingsRow[]} standings
 * @returns {PhaseStats}
 */
function readLeagueRegularSeason(standings) {
  /** @param {(row: StandingsRow) => number | null | undefined} read */
  const averageAll = (read) => {
    const values = standings.map(read).filter((value) => value != null);
    return values.length ? averageOf(/** @type {number[]} */ (values)) : null;
  };
  /** @param {(row: StandingsRow) => string | null | undefined} read */
  const addAll = (read) => {
    const records = standings.map(read).filter(Boolean);
    return records.length ? addRecords(/** @type {string[]} */ (records)) : null;
  };
  return {
    record: null,
    pointsFor: averageAll((row) => row.pointsFor),
    pointsAgainst: averageAll((row) => row.pointsAgainst),
    margin: averageAll((row) => row.margin),
    home: addAll((row) => row.home),
    road: addAll((row) => row.road),
  };
}

/**
 * The playoffs so far, as one side to measure a team against: the points each team scored a game,
 * and how home teams and road teams have done, or null before the first game ends.
 * @param {Game[]} games
 * @returns {PhaseStats | null}
 */
function readLeaguePlayoffs(games) {
  const finished = games.filter((game) => game.state === "final");
  if (!finished.length) return null;
  const points = averageOf(
    finished.flatMap((game) => [game.home.score ?? 0, game.away.score ?? 0]),
  );
  const homeWins = finished.filter((game) => (game.home.score ?? 0) > (game.away.score ?? 0));
  const homeRecord = `${homeWins.length}-${finished.length - homeWins.length}`;
  const roadRecord = `${finished.length - homeWins.length}-${homeWins.length}`;
  return {
    record: null,
    pointsFor: points,
    pointsAgainst: points,
    margin: 0,
    home: homeRecord,
    road: roadRecord,
  };
}

/**
 * A measure the league has no side of, a record, keeps its number without a bar: a bar's
 * brightness says which side is ahead, and alone the team is neither.
 * @param {import("#shared/tape.js").TapeRow} row
 */
const dropUnmatchedBar = (row) =>
  row.home || !row.away ? row : { ...row, away: { ...row.away, bar: null } };

/**
 * The team across from the league, measure by measure, leaving out a measure the team doesn't
 * have. The league has no record, so the team's shows alone, without a bar.
 * @param {PhaseStats} team
 * @param {PhaseStats | null} league
 */
function describeStatRows(team, league) {
  /** @param {keyof PhaseStats} measure */
  const pick = (measure) =>
    /** @type {[any, any]} */ ([team[measure] ?? null, league?.[measure] ?? null]);
  const rows = [
    describeRecords("Record", pick("record")),
    describeNumbers("PPG", pick("pointsFor"), { format: formatAverage }),
    describeNumbers("Opp PPG", pick("pointsAgainst"), {
      format: formatAverage,
      isLowerBetter: true,
    }),
    describeNumbers("Margin", pick("margin"), { format: formatMargin }),
    describeRecords("Home", pick("home")),
    describeRecords("Road", pick("road")),
  ];
  return rows.filter((row) => row.away).map(dropUnmatchedBar);
}

/**
 * A team's numbers across from the league's, in the game preview's tape: the team on the left in
 * its color, named without its dot, which the sheet's title already shows, and the league on the
 * right.
 * @param {string} code
 * @param {PhaseStats} team
 * @param {PhaseStats | null} league
 * @param {string} leagueName what the league's side is called
 */
const renderAgainstLeague = (code, team, league, leagueName) =>
  html`<div class="team-tape" style="${formatTeamColors(code)}">
    <div class="tape-teams"><span class="club">${nameTeam(code)}</span><span class="club">${leagueName}</span></div>
    <div class="tape">${describeStatRows(team, league).map(renderTapeRow)}</div>
  </div>`;

/**
 * How the team ended the regular season: its last ten games and its streak, as the standings
 * show them, each on its own line with its name and number set like the measures above, or
 * nothing while it has neither.
 * @param {StandingsRow} row
 */
function renderRecentForm(row) {
  /** @type {[string, import("#shared/html.js").Markup | string | null][]} */
  const facts = [
    ["Last 10", row.lastTen],
    ["Streak", row.streak && renderStreak(row.streak)],
  ];
  const shown = facts.filter(([, value]) => value);
  return (
    shown.length > 0 &&
    html`<dl class="team-form">
      ${shown.map(
        ([label, value]) =>
          html`<dt class="tape-label">${label}</dt><dd class="tape-value tabular">${value}</dd>`,
      )}
    </dl>`
  );
}

/**
 * The team's regular season across from the league's, from the standings, then its last ten and
 * its streak, then its leading scorers.
 * @param {string} code
 * @param {StandingsRow[]} standings
 * @param {Leader[]} leaders
 */
function renderRegularSeason(code, standings, leaders) {
  const row = standings.find((each) => each.team === code);
  if (!row && !leaders.length) return false;
  const numbers =
    row &&
    renderAgainstLeague(code, readRegularSeason(row), readLeagueRegularSeason(standings), "League");
  return renderSheetPart(
    "Regular season",
    html`<div class="team-season">
      ${numbers}${row && renderRecentForm(row)}${renderLeadingScorers(leaders)}
    </div>`,
  );
}

/**
 * @param {string} code
 * @param {{ before: number[], now: number[] }} titles
 */
function renderTitles(code, titles) {
  const count = titles.before.length + titles.now.length;
  const formerTeam = TEAMS[code].titlesAs;
  const before = titles.before.join(", ") + (formerTeam ? ` (as ${formerTeam})` : "");
  const years = [titles.before.length ? before : "", ...titles.now].filter(Boolean).join(", ");
  const body = count
    ? joinWithSeparator([html`<b>${count}</b>`, html`<span class="tabular">${years}</span>`])
    : "None yet";
  return renderSheetPart("Titles", html`<p class="team-titles">${body}</p>`);
}

/**
 * @param {Game} game
 * @param {string} team
 */
function describeMatchup(game, team) {
  const place = findPlace(game, team) ?? "home";
  const opponent = game[OTHER_PLACE[place]].team;
  const round = game.round ? ROUNDS[game.round].shortName : "";
  return html`${place === "home" ? "vs" : "at"} ${renderTeamName(opponent)}
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
 * The team's playoff games under its run so far, then its numbers across from the whole playoff
 * field's, or only the run for a team that missed them. The games come first, so the run's chip
 * heads them rather than the field's side of the numbers.
 * @param {string} team
 * @param {{ finished: Game[], next: Game | null }} games
 * @param {{ label: string, kind: string } | null} chip
 * @param {{ isPlaying: boolean, field: PhaseStats | null, now: number }} context
 */
function renderPlayoffs(team, { finished, next }, chip, { isPlaying, field, now }) {
  if (!chip) return false;
  const stats = readPlayoffs(finished, team);
  const shownNext = isPlaying && next;
  return renderSheetPart(
    "Playoffs",
    html`<div class="team-season">
      <div class="team-playoffs">
        ${finished.map((game) => renderFinishedGame(game, team))}
        ${shownNext && renderNextGame(shownNext, team, now)}
      </div>
      ${stats && renderAgainstLeague(team, stats, field, "Playoff field")}
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
 * The sheet a team opens: its name, its conference, seed, and record, then its regular season and
 * its playoffs, the playoffs first for a team that made them, then its titles.
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
  const chip = describeChip(run, { hasField: runs.size > 0 });
  const titles = listTitles(code, run, year);
  const regularSeason = renderRegularSeason(
    code,
    season?.standings ?? [],
    findTeamLeaders(season, code),
  );
  const playoffs = renderPlayoffs(code, games, chip, {
    isPlaying,
    field: readLeaguePlayoffs(season?.games ?? []),
    now,
  });
  return {
    heading: html`${renderDot(code)}<span>${team.city} ${team.name}</span>`,
    note: joinWithSeparator(listFacts(row, run)),
    body: html`${run ? html`${playoffs}${regularSeason}` : html`${regularSeason}${playoffs}`}
    ${renderTitles(code, titles)}`,
  };
}
