import { teamTag } from "./clubs.js";
import { html, setHtml } from "./html.js";
import { session } from "./session.js";
import { selectTab, wireTabs } from "./tabs.js";

const HALF_INNING_LABELS = { top: "Top", bottom: "Bot" };
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
  switch (game.state) {
    case "final":
      return "Final";
    case "live":
      return describeInning(game);
    case "off":
      return game.detail || "Postponed";
    default:
      return describeStart(game);
  }
}

function renderClub(id) {
  if (id) return teamTag(id);
  return html`<span class="club tbd"><span class="dot"></span><span class="team-name">TBD</span></span>`;
}

function renderSide(id, score, hasLost) {
  const lostClass = hasLost ? "lost" : "";
  return html`<span class="game-club ${lostClass}">${renderClub(id)}</span><span class="game-score tabular ${lostClass}">${score ?? ""}</span>`;
}

function renderGame(game) {
  const [awayScore, homeScore] = game.score || [];
  const isFinal = game.state === "final";
  return html`<li class="game-row ${game.state}">
    ${renderSide(game.away, awayScore, isFinal && awayScore < homeScore)}
    <span class="game-status">${describeStatus(game)}${game.doubleheader && html`<span class="doubleheader">Game ${game.doubleheader}</span>`}</span>
    ${renderSide(game.home, homeScore, isFinal && homeScore < awayScore)}
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
