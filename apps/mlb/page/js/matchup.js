// The matchup sheet a game with named starters opens: the two starters face to face, where each
// ranks among the season's starters, what each throws, and their last starts. A club yet to name
// its starter shows who started its last games instead, and how rested each would be. Until each
// side loads, placeholders hold its shape.
// Phones show it as a sheet from the bottom that a swipe down closes, wider screens as a modal,
// like Settings.

import { nameTeam, renderTeamTag } from "./clubs.js";
import { describeStart, formatGameDay, renderArm } from "./games-view.js";
import { formatShortDate, readCalendarDate } from "#shared/days.js";
import { watchGameOpens } from "#shared/game-row.js";
import { html, joinWithSeparator, setHtml } from "#shared/html.js";
import { renderPlaceholder } from "#shared/placeholder.js";
import { renderPendingPitchColumns, renderPitchColumns } from "./pitch-columns.js";
import { fetchPitcher, fetchRotation } from "./pitcher-fetch.js";
import { session } from "./session.js";
import { redrawSheet } from "#shared/sheet-resize.js";
import { closeOnSwipeDown } from "#shared/sheet-swipe.js";
import { PENDING_TAPE_SIDE, renderTapeRow } from "#shared/tape.js";

const SIDES = ["away", "home"];
const USUAL_REST_DAYS = 4;
// The Worker sends a starter's last three starts, and a club's last five starters.
const PENDING_STARTS = 3;
const PENDING_ROTATION = 5;
const TAPE = [
  { key: "era", label: "ERA", format: (line) => line.era },
  { key: "k9", label: "K/9", format: (line) => line.k9.toFixed(1) },
  { key: "bb9", label: "BB/9", format: (line) => line.bb9.toFixed(1) },
  { key: "speed", label: "Fastball mph", format: (line) => line.speed.toFixed(1) },
];

// Each opening counts, so a sheet reopened on another game ignores the first one's answers.
let opening = 0;

const findDialog = () =>
  /** @type {HTMLDialogElement} */ (document.getElementById("matchupDialog"));
const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const readLastName = (side) => side.starter?.name || "TBD";

function renderTitle(sides) {
  return html`${readLastName(sides[0])} vs ${readLastName(sides[1])}`;
}

function renderWhen(game) {
  return joinWithSeparator([formatGameDay(game.date), describeStart(game)]);
}

const isLoadingPitcher = (side) => Boolean(side.starter?.name) && !side.pitcher && !side.failed;

function renderBio(side) {
  const { pitcher } = side;
  if (isLoadingPitcher(side))
    return html`<span class="pitcher-bio">${renderPlaceholder("R Age 00")}</span>`;
  if (!pitcher) return html``;
  const age = pitcher.age && html`<span>Age ${pitcher.age}</span>`;
  return html`<span class="pitcher-bio">${renderArm(pitcher.hand)}${age}</span>`;
}

function renderFirstName(side) {
  if (isLoadingPitcher(side))
    return html`<span class="pitcher-first">${renderPlaceholder("Firstname")}</span>`;
  const first = side.pitcher?.firstName;
  return first ? html`<span class="pitcher-first">${first}</span>` : html``;
}

// Until his numbers load, a starter has only the last name the game row shows.
function renderName(side) {
  const { starter, pitcher } = side;
  const last = pitcher?.lastName || starter?.name || (starter ? "Not named yet" : "Still TBD");
  return html`<span class="pitcher-name">${renderFirstName(side)}<span class="pitcher-last">${last}</span></span>`;
}

function renderPitcherId(side) {
  const { club } = side;
  return html`<div class="pitcher-id ${side.key}">
    ${renderName(side)}
    ${club ? renderTeamTag(club) : html``}
    ${renderBio(side)}
  </div>`;
}

// A bar's length is the share of the other starters he beats: full for the best, empty for the worst.
function measureBeaten(rank) {
  if (!rank || rank.of < 2) return null;
  return Math.round(((rank.of - rank.rank) / (rank.of - 1)) * 100);
}

function findLeader(sides, key) {
  const [away, home] = sides.map((side) => side.pitcher?.ranks?.[key]?.rank);
  if (!away || !home || away === home) return null;
  return away < home ? "away" : "home";
}

function describeTapeSide(side, measure) {
  if (isLoadingPitcher(side)) return PENDING_TAPE_SIDE;
  const line = side.pitcher?.line;
  if (line?.[measure.key] == null) return null;
  return { value: measure.format(line), bar: measureBeaten(side.pitcher.ranks?.[measure.key]) };
}

const isUnranked = (side) => Boolean(side.pitcher?.line && !side.pitcher.ranks);

function describeUnranked({ pitcher }) {
  const starts = pitcher.line.starts === 1 ? "1 start is" : `${pitcher.line.starts} starts are`;
  return `${pitcher.lastName}'s ${starts} too few to rank him among this season's starters`;
}

function renderTapeNotes(sides, counted) {
  const barsNote =
    sides.some((side) => side.pitcher?.ranks) &&
    html`<p class="tape-note">Bars are the share of this season's ${counted.count} starters, pitchers with ${counted.minimum} or more starts, he beats</p>`;
  const unrankedNotes = sides
    .filter(isUnranked)
    .map((side) => html`<p class="tape-note">${describeUnranked(side)}</p>`);
  return html`${barsNote}${unrankedNotes}`;
}

function renderTape(sides) {
  const counted = sides.find((side) => side.pitcher?.line)?.pitcher.starters;
  if (!counted && !sides.some(isLoadingPitcher)) return html``;
  const rows = TAPE.map((measure) =>
    renderTapeRow({
      label: measure.label,
      away: describeTapeSide(sides[0], measure),
      home: describeTapeSide(sides[1], measure),
      leader: findLeader(sides, measure.key),
    }),
  );
  const notes = counted
    ? renderTapeNotes(sides, counted)
    : html`<p class="tape-note">${renderPlaceholder("Bars are the share of this season's starters he beats")}</p>`;
  return html`<div class="tape">
    ${rows}
    ${notes}
  </div>`;
}

// MLB counts innings in thirds after the point: 5.2 is five and two thirds.
function formatInnings(innings) {
  const [whole, thirds] = String(innings).split(".");
  return thirds && thirds !== "0" ? `${whole} ${thirds}/3` : whole;
}

const formatStartDay = (date) => formatShortDate(readCalendarDate(date));

// A start in the game under way is still adding up, so it says so instead of giving its date.
const isUnderWay = (start, side, game) =>
  game.state === "live" && start.date === game.date && start.opp === side.opponent;

function renderStart(start, isNow) {
  const opponent = start.opp ? `${start.home ? "vs" : "@"} ${nameTeam(start.opp)}` : "";
  const line = `${formatInnings(start.ip)} IP, ${start.runs} R, ${start.k} K`;
  const day = isNow
    ? html`<span class="start-now">Now</span>`
    : html`<span class="tabular">${formatStartDay(start.date)}</span>`;
  return html`<li>${day}<span>${opponent}</span><span class="tabular">${line}</span></li>`;
}

function describeRest(rest) {
  if (rest === 1) return "1 day's rest";
  return `${rest} days' rest`;
}

function renderRotationStarter(starter) {
  const { start } = starter;
  const pitches = start.pitches != null ? `, ${start.pitches} pitches` : "";
  const isRested = starter.rest >= USUAL_REST_DAYS;
  return html`<li class="${isRested ? "rested" : ""}">
    <span class="rotation-name"><span>${starter.name}</span>${renderArm(starter.hand)}</span>
    <span class="tabular">${formatInnings(start.ip)} IP${pitches}</span>
    <span class="tabular">${describeRest(starter.rest)}</span>
  </li>`;
}

const renderPendingRotationStarter = () =>
  html`<li>
    <span class="rotation-name">${renderPlaceholder("Lastname")}</span>
    <span>${renderPlaceholder("6 1/3 IP, 98 pitches")}</span>
    <span>${renderPlaceholder("4 days' rest")}</span>
  </li>`;

const isLoadingRotation = (side) => !side.rotation && !side.failed;

function describeRotationNote(side, game) {
  if (side.failed) return "Couldn't load who started lately. Close and try again in a minute.";
  if (isLoadingRotation(side))
    return renderPlaceholder("No starter named yet. Each recent starter");
  if (!side.rotation.starters.length) return "No starts in the last two weeks to go by";
  return `No starter named yet. Each recent starter's last start, and the rest he'd have on ${formatStartDay(game.date)}.`;
}

function renderRotationStarters(side) {
  if (isLoadingRotation(side))
    return Array.from({ length: PENDING_ROTATION }, renderPendingRotationStarter);
  return (side.rotation?.starters || []).map(renderRotationStarter);
}

function renderRotation(side, game) {
  const starters = renderRotationStarters(side);
  const list =
    starters.length > 0 &&
    html`<ul class="rotation">${starters}</ul>
      <p class="tape-note">Gold is a starter's usual rest, ${USUAL_REST_DAYS} days or more</p>`;
  return html`<section class="scout">
    <h3>${nameTeam(side.club)}<span>Who's rested</span></h3>
    <p class="scout-note">${describeRotationNote(side, game)}</p>
    ${list}
  </section>`;
}

const isAwaitingStarter = (side, game) =>
  !side.starter && Boolean(side.club) && game.state === "pre";

function renderScouting(side, game) {
  if (isAwaitingStarter(side, game)) return renderRotation(side, game);
  if (!side.starter?.name) return html``;
  const name = side.starter.name;
  if (side.failed)
    return html`<section class="scout"><h3>${name}</h3><p class="scout-note">Couldn't load his numbers. Close and try again in a minute.</p></section>`;
  if (!side.pitcher) return renderPendingScouting(name);
  const { pitcher } = side;
  const starts =
    pitcher.starts.length &&
    html`<h4>Last starts</h4><ul class="recent-starts">${pitcher.starts.map((start) => renderStart(start, isUnderWay(start, side, game)))}</ul>`;
  return html`<section class="scout">
    <h3>${name}<span>What he throws</span></h3>
    ${renderPitchColumns(pitcher.pitches, name)}
    ${starts}
  </section>`;
}

const renderPendingStart = () =>
  html`<li>
    <span>${renderPlaceholder("Sep 00")}</span>
    <span>${renderPlaceholder("vs Mariners")}</span>
    <span>${renderPlaceholder("5 2/3 IP, 2 R, 6 K")}</span>
  </li>`;

function renderPendingScouting(name) {
  return html`<section class="scout">
    <h3>${name}<span>What he throws</span></h3>
    ${renderPendingPitchColumns()}
    <h4>Last starts</h4>
    <ul class="recent-starts">${Array.from({ length: PENDING_STARTS }, renderPendingStart)}</ul>
  </section>`;
}

function renderBody(game, sides) {
  return html`<div class="faceoff">${sides.map(renderPitcherId)}</div>
    ${renderTape(sides)}
    ${sides.map((side) => renderScouting(side, game))}`;
}

const isLoadingSide = (side, game) =>
  isLoadingPitcher(side) || (isAwaitingStarter(side, game) && isLoadingRotation(side));

function renderMatchup(game, sides) {
  const body = findElement("matchupBody");
  redrawSheet(findDialog(), () => {
    setHtml(findElement("matchupTitle"), renderTitle(sides));
    setHtml(findElement("matchupWhen"), renderWhen(game));
    setHtml(body, renderBody(game, sides));
    body.setAttribute("aria-busy", String(sides.some((side) => isLoadingSide(side, game))));
  });
}

const listSides = (game) =>
  SIDES.map((key, index) => ({
    key,
    club: game[key],
    opponent: game[SIDES[1 - index]],
    starter: game.starters?.[index] || null,
    pitcher: null,
    rotation: null,
    failed: false,
  }));

async function loadSide(side, game, season) {
  try {
    if (side.starter?.name) side.pitcher = await fetchPitcher(side.starter.id, season);
    else if (isAwaitingStarter(side, game))
      side.rotation = await fetchRotation(side.club, game.date);
  } catch {
    side.failed = true;
  }
}

/**
 * @param {{ date: string, start: string, state: string, tbd?: boolean, doubleheader?: number, away: string, home: string, starters: object[] }} game
 */
async function openMatchup(game) {
  const sequence = ++opening;
  const sides = listSides(game);
  const dialog = findDialog();
  renderMatchup(game, sides);
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  markScrolled();
  const season = session.activeYear;
  await Promise.all(
    sides.map((side) =>
      loadSide(side, game, season).then(() => {
        if (sequence === opening) renderMatchup(game, sides);
      }),
    ),
  );
}

// A line under the pinned header shows once the sheet has scrolled under it.
function markScrolled() {
  const dialog = findDialog();
  dialog.querySelector(".sheet-top").classList.toggle("scrolled", dialog.scrollTop > 0);
}

const readRowGame = (button) => JSON.parse(button.dataset.game);

const openFromRow = (button) => openMatchup(readRowGame(button));

function prepareFromRow(button) {
  const game = readRowGame(button);
  for (const side of listSides(game)) loadSide(side, game, session.activeYear);
}

export function startMatchups() {
  const dialog = findDialog();
  watchGameOpens(findElement("gamePages"), { open: openFromRow, prepare: prepareFromRow });
  findElement("matchupDoneBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) dialog.close();
  });
  dialog.addEventListener("scroll", markScrolled);
  closeOnSwipeDown(dialog);
}
