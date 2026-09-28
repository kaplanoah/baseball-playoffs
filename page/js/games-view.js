import { isEliminated } from "./bracket.js";
import { rankTag, teamTag } from "./clubs.js";
import { html, setHtml } from "./html.js";
import { describeRace, findStandingsRow, isSeedFinal } from "./race.js";
import { session } from "./session.js";
import { selectTab, wireTabs } from "./tabs.js";

const HALF_INNING_LABELS = { top: "Top", bottom: "Bot" };
const CLINCH_TITLES = {
  z: "Clinched the best record in the league",
  y: "Clinched the division",
  w: "Clinched a wild card spot",
  x: "Clinched a playoff spot",
};
// Trimmed to the drawing, so sized in em its base sits on the text's baseline like a letter.
const SEED_LOCK = html`<svg class="seed-lock" viewBox="1.5 1.3 9 12.4" role="img" aria-label="seed final"><path d="M3.5 7V4.5a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="2.2" y="7.2" width="7.6" height="5.8" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;
const EMPTY_LIST_TEXT = {
  previous: "No earlier games this season.",
  today: "No games today.",
  next: "No games scheduled yet.",
};

let shownList = "today";

const findGameTabs = () =>
  /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll("#view-games [role=tab]")]);

function formatOrdinal(number) {
  const lastTwoDigits = number % 100;
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) return `${number}th`;
  return number + ({ 1: "st", 2: "nd", 3: "rd" }[number % 10] || "th");
}

// Game days are Eastern calendar dates, so they're read as dates, never as instants.
function formatGameDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function describeStart(game) {
  if (game.tbd) return game.doubleheader === 2 ? "After Game 1" : "Time TBD";
  return new Date(game.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function describeInning(game) {
  return [HALF_INNING_LABELS[game.half], formatOrdinal(game.inning || 1)].filter(Boolean).join(" ");
}

function describeStatus(game) {
  if (game.delay) return game.delay;
  if (game.state === "final") return "Final";
  if (game.state === "live") return describeInning(game);
  return "";
}

// Not a .team-name: its clipped overflow cuts off the slant of the italic's last letter in Safari.
function renderClub(id) {
  if (id) return teamTag(id);
  return html`<span class="club"><span class="dot unknown-club"></span><span class="tbd">TBD</span></span>`;
}

function renderNameLine(id) {
  return html`<span class="name-line">${renderClub(id)}${id && rankTag(id)}</span>`;
}

function renderSeed(id) {
  const team = session.state && session.state.teams && session.state.teams[id];
  if (!team || !team.seed) return html``;
  return html`<span class="seed">${team.seed} seed${isSeedFinal(id) && SEED_LOCK}</span>`;
}

function renderRace(row) {
  const race = describeRace(row);
  if (!race || !race.label) return html``;
  const title = race.standing === "clinched" && CLINCH_TITLES[race.label];
  return html`<span class="race ${race.standing}"${title && html` title="${title}"`}>${race.label}</span>`;
}

function renderFacts(id) {
  if (!id) return html``;
  const row = findStandingsRow(id);
  return html`<span class="game-facts">${renderSeed(id)}${row && html`<span class="tabular">${row.w}-${row.l}</span>`}${renderRace(row)}</span>`;
}

function isOut(id) {
  const { state } = session;
  const isOutOfPostseason = Boolean(state && state.teams) && isEliminated(state, id);
  return isOutOfPostseason || describeRace(findStandingsRow(id))?.standing === "out";
}

function renderSide(id, side, hasWon) {
  return html`<span class="game-side ${side} ${hasWon ? "won" : ""} ${isOut(id) ? "out" : ""}">${renderNameLine(id)}${renderFacts(id)}</span>`;
}

function renderScore(game, awayLost, homeLost) {
  const [awayScore, homeScore] = game.score;
  return html`<span class="game-score tabular"><span class="${awayLost ? "lost" : ""}">${awayScore}</span><span class="score-dash">-</span><span class="${homeLost ? "lost" : ""}">${homeScore}</span></span>`;
}

function renderMiddle(game, awayLost, homeLost) {
  const doubleheader =
    game.doubleheader && html`<span class="doubleheader">Game ${game.doubleheader}</span>`;
  const headline = game.score
    ? renderScore(game, awayLost, homeLost)
    : html`<span class="game-time">${game.state === "off" ? game.detail || "Postponed" : describeStart(game)}</span>`;
  return html`<span class="game-middle">${headline}<span class="game-status">${describeStatus(game)}${doubleheader}</span></span>`;
}

function renderGame(game) {
  const [awayScore, homeScore] = game.score || [];
  const isFinal = game.state === "final";
  const awayLost = isFinal && awayScore < homeScore;
  const homeLost = isFinal && homeScore < awayScore;
  const awayWon = isFinal && awayScore > homeScore;
  const homeWon = isFinal && homeScore > awayScore;
  return html`<li class="game-row ${game.state} ${game.delay ? "delayed" : ""}">
    ${renderSide(game.away, "away", awayWon)}
    ${renderMiddle(game, awayLost, homeLost)}
    ${renderSide(game.home, "home", homeWon)}
  </li>`;
}

// A doubleheader's games sit together in game order, since MLB can list game 2 with the earlier start.
function orderDay(games) {
  const isSameMatchup = (game, other) => game.away === other.away && game.home === other.home;
  const findSlot = (game) =>
    Math.min(
      ...games
        .filter((other) => isSameMatchup(game, other))
        .map((other) => Date.parse(other.start)),
    );
  return games
    .map((game) => ({ game, slot: findSlot(game) }))
    .sort(
      (first, second) =>
        first.slot - second.slot ||
        (first.game.doubleheader || 0) - (second.game.doubleheader || 0),
    )
    .map(({ game }) => game);
}

function groupByDay(games, isNewestFirst) {
  const dates = [...new Set(games.map((game) => game.date))].sort();
  if (isNewestFirst) dates.reverse();
  return dates.map((date) => ({
    date,
    games: orderDay(games.filter((game) => game.date === date)),
  }));
}

function listGames(slate, list) {
  if (list === "previous") return slate.previous || [];
  if (list === "next") return slate.next || [];
  const { date, games, postponed = [] } = slate.today;
  return [...games, ...postponed].map((game) => ({ date, ...game }));
}

function describeMissingSlate() {
  if (session.activeYear !== session.currentSeason)
    return "Games show for the current season only.";
  return "Games appear here as soon as the page can reach MLB.";
}

export function renderGameList(slate, list) {
  if (!slate) return html`<p class="stand-empty">${describeMissingSlate()}</p>`;
  const games = listGames(slate, list);
  if (!games.length) return html`<p class="stand-empty">${EMPTY_LIST_TEXT[list]}</p>`;
  return html`${groupByDay(games, list === "previous").map(
    (day) => html`<h3 class="game-day">${formatGameDay(day.date)}</h3>
      <ul class="game-list">${day.games.map(renderGame)}</ul>`,
  )}`;
}

export function renderGames() {
  const slate = session.state && session.state.slate;
  setHtml(document.getElementById("gamesList"), renderGameList(slate, shownList));
}

function showGameList(list) {
  shownList = list;
  selectTab(findGameTabs(), list);
  document.getElementById("gamesList").setAttribute("aria-labelledby", `games-tab-${list}`);
  renderGames();
}

export function wireGameTabs() {
  wireTabs(findGameTabs(), showGameList);
}
