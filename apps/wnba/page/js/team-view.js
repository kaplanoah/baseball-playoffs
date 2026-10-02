import { countDaysBetween, formatClockTime } from "#shared/days.js";
import { html, joinWithSeparator } from "#shared/html.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderTapeRow } from "#shared/tape.js";
import { renderTeamDetail } from "#shared/team-sheet.js";
import { renderDot, renderTeamName } from "./clubs.js";
import { describeDay, readGameDay } from "./days.js";
import { readPlayoffRuns } from "./series.js";
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
/** @typedef {{ record: string, pointsFor: number | null, pointsAgainst: number | null, margin: number | null, home: string | null, road: string | null, lastTen: string | null, streak: string | null }} PhaseStats */

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

/** @param {boolean[]} results each game's, oldest first, true for a win */
function formatRecord(results) {
  const wins = results.filter(Boolean).length;
  return `${wins}-${results.length - wins}`;
}

/** @param {boolean[]} results each game's, oldest first, true for a win */
function formatStreak(results) {
  const last = results.at(-1);
  const length = results.length - results.findLastIndex((isWin) => isWin !== last) - 1;
  return `${last ? "W" : "L"} ${length}`;
}

/** @param {StandingsRow} row */
const readRegularSeason = (row) => ({
  record: `${row.wins}-${row.losses}`,
  pointsFor: row.pointsFor ?? null,
  pointsAgainst: row.pointsAgainst ?? null,
  margin: row.margin ?? null,
  home: row.home ?? null,
  road: row.road ?? null,
  lastTen: row.lastTen,
  streak: row.streak,
});

/** @param {Game[]} games */
const sortByStart = (games) =>
  games.toSorted((first, second) => (first.start ?? "").localeCompare(second.start ?? ""));

/**
 * A team's numbers through the playoff games it has finished, or null before its first.
 * @param {Game[]} finished
 * @param {string} team
 * @returns {PhaseStats | null}
 */
function readPlayoffs(finished, team) {
  if (!finished.length) return null;
  const games = sortByStart(finished).map((game) => {
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
    lastTen: formatRecord(results.slice(-10)),
    streak: formatStreak(results),
  };
}

/**
 * A row for a streak, which has no bar, since a winning streak and a losing one don't compare by
 * length.
 * @param {(string | null)[]} streaks
 * @returns {import("#shared/tape.js").TapeRow}
 */
function describeStreaks(streaks) {
  const [away, home] = streaks.map((streak) => (streak ? { value: renderStreak(streak) } : null));
  return { label: "Streak", away, home, leader: null };
}

/**
 * The regular season across from the playoffs, measure by measure, leaving out a measure neither
 * has.
 * @param {PhaseStats | null} regular
 * @param {PhaseStats | null} playoffs
 */
function describeStatRows(regular, playoffs) {
  /** @param {keyof PhaseStats} measure */
  const pick = (measure) =>
    /** @type {[any, any]} */ ([regular?.[measure] ?? null, playoffs?.[measure] ?? null]);
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
    describeRecords("Last 10", pick("lastTen")),
    describeStreaks(pick("streak")),
  ];
  return rows.filter((row) => row.away || row.home);
}

/**
 * The team's stats in the game preview's tape: the regular season on the left and the playoffs
 * on the right, each named over its side, or the regular season alone before the team's first
 * playoff game.
 * @param {string} code
 * @param {StandingsRow | undefined} row
 * @param {PhaseStats | null} playoffs
 */
function renderStats(code, row, playoffs) {
  const regular = row ? readRegularSeason(row) : null;
  const rows = describeStatRows(regular, playoffs);
  if (!rows.length) return false;
  const heads = [regular && "Regular season", playoffs && "Playoffs"].filter(Boolean);
  return html`<div class="team-tape${playoffs ? "" : " solo"}" style="${formatTeamColors(code)}">
    <div class="tape-teams">${heads.map((head) => html`<span class="team-label">${head}</span>`)}</div>
    <div class="tape">${rows.map(renderTapeRow)}</div>
  </div>`;
}

/**
 * @param {string} code
 * @param {{ before: number[], now: number[] }} titles
 */
function renderTitles(code, titles) {
  const count = titles.before.length + titles.now.length;
  if (!count) return renderTeamDetail("Titles", "None yet");
  const formerTeam = TEAMS[code].titlesAs;
  const before = titles.before.join(", ") + (formerTeam ? ` (as ${formerTeam})` : "");
  const years = [titles.before.length ? before : "", ...titles.now].filter(Boolean).join(", ");
  return renderTeamDetail(
    "Titles",
    joinWithSeparator([html`<b>${count}</b>`, html`<span class="tabular">${years}</span>`]),
  );
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
 * it got in the playoffs, the playoffs first for a team that made them.
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
  const seasonPart = renderSheetPart(
    "Season",
    html`<div class="team-season">
      ${renderStats(code, row, readPlayoffs(games.finished, code))}${renderLeadingScorers(findTeamLeaders(season, code))}${renderTitles(code, titles)}
    </div>`,
  );
  const playoffsPart = renderPlayoffs(code, games, chip, { isPlaying, now });
  return {
    heading: html`${renderDot(code)}<span>${team.city} ${team.name}</span>`,
    note: joinWithSeparator(listFacts(row, run)),
    body: run ? html`${playoffsPart}${seasonPart}` : html`${seasonPart}${playoffsPart}`,
  };
}
