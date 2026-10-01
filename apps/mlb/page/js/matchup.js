// The matchup sheet a game with named starters opens: the two starters face to face, where each
// ranks among the season's starters, what each throws, and their last starts.
// Phones show it as a sheet from the bottom that a swipe down closes, wider screens as a modal,
// like Settings.

import { nameTeam, renderTeamTag } from "./clubs.js";
import { describeStart, formatGameDay, renderArm } from "./games-view.js";
import { html, joinWithSeparator, setHtml } from "#shared/html.js";
import { renderPitchColumns } from "./pitch-columns.js";
import { fetchPitcher } from "./pitcher-fetch.js";
import { session } from "./session.js";
import { closeOnSwipeDown } from "#shared/sheet-swipe.js";

const SIDES = ["away", "home"];
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

function renderBio(pitcher) {
  const age = pitcher.age && html`<span>Age ${pitcher.age}</span>`;
  return html`<span class="pitcher-bio">${renderArm(pitcher.hand)}${age}</span>`;
}

// Until his numbers load, a starter has only the last name the game row shows.
function renderName({ starter, pitcher }) {
  const first = pitcher?.firstName && html`<span class="pitcher-first">${pitcher.firstName}</span>`;
  const last = pitcher?.lastName || starter?.name || "Not named yet";
  return html`<span class="pitcher-name">${first}<span class="pitcher-last">${last}</span></span>`;
}

function renderPitcherId(side) {
  const { club, pitcher } = side;
  return html`<div class="pitcher-id ${side.key}">
    ${renderName(side)}
    ${club ? renderTeamTag(club) : html``}
    ${pitcher ? renderBio(pitcher) : html``}
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

function renderTapeSide(side, measure, leader) {
  const line = side.pitcher?.line;
  const value = line?.[measure.key];
  if (value == null) return html`<div class="tape-side ${side.key}"></div>`;
  const beaten = measureBeaten(side.pitcher.ranks?.[measure.key]);
  const bar =
    beaten != null &&
    html`<span class="tape-bar"><i class="${leader === side.key ? "lead" : ""}" style="width: ${beaten}%"></i></span>`;
  return html`<div class="tape-side ${side.key}">
    <span class="tape-value tabular">${measure.format(line)}</span>${bar}
  </div>`;
}

function renderTape(sides) {
  const counted = sides.find((side) => side.pitcher?.line)?.pitcher.starters;
  if (!counted) return html``;
  const rows = TAPE.map((measure) => {
    const leader = findLeader(sides, measure.key);
    return html`<div class="tape-row">
      ${renderTapeSide(sides[0], measure, leader)}
      <span class="tape-label">${measure.label}</span>
      ${renderTapeSide(sides[1], measure, leader)}
    </div>`;
  });
  return html`<div class="tape">
    ${rows}
    <p class="tape-note">Bars are the share of this season's ${counted.count} starters, pitchers with ${counted.minimum} or more starts, he beats</p>
  </div>`;
}

// MLB counts innings in thirds after the point: 5.2 is five and two thirds.
function formatInnings(innings) {
  const [whole, thirds] = String(innings).split(".");
  return thirds && thirds !== "0" ? `${whole} ${thirds}/3` : whole;
}

function formatStartDay(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], { month: "short", day: "numeric" });
}

function renderStart(start) {
  const opponent = start.opp ? `${start.home ? "vs" : "@"} ${nameTeam(start.opp)}` : "";
  const line = `${formatInnings(start.ip)} IP, ${start.runs} R, ${start.k} K`;
  return html`<li><span class="tabular">${formatStartDay(start.date)}</span><span>${opponent}</span><span class="tabular">${line}</span></li>`;
}

function renderScouting(side) {
  if (!side.starter?.name) return html``;
  const name = side.starter.name;
  if (side.failed)
    return html`<section class="scout"><h3>${name}</h3><p class="scout-note">Couldn't load his numbers. Close and try again in a minute.</p></section>`;
  if (!side.pitcher)
    return html`<section class="scout"><h3>${name}</h3><p class="scout-note">Loading his numbers</p></section>`;
  const { pitcher } = side;
  const starts =
    pitcher.starts.length &&
    html`<h4>Last starts</h4><ul class="recent-starts">${pitcher.starts.map(renderStart)}</ul>`;
  return html`<section class="scout">
    <h3>${name}<span>What he throws</span></h3>
    ${renderPitchColumns(pitcher.pitches, name)}
    ${starts}
  </section>`;
}

function renderBody(sides) {
  return html`<div class="faceoff">${sides.map(renderPitcherId)}</div>
    ${renderTape(sides)}
    ${sides.map(renderScouting)}`;
}

function renderMatchup(game, sides) {
  setHtml(findElement("matchupTitle"), renderTitle(sides));
  setHtml(findElement("matchupWhen"), renderWhen(game));
  setHtml(findElement("matchupBody"), renderBody(sides));
}

const listSides = (game) =>
  SIDES.map((key, index) => ({
    key,
    club: game[key],
    starter: game.starters?.[index] || null,
    pitcher: null,
    failed: false,
  }));

async function loadSide(side, season) {
  if (!side.starter?.name) return;
  try {
    side.pitcher = await fetchPitcher(side.starter.id, season);
  } catch {
    side.failed = true;
  }
}

/**
 * @param {{ date: string, start: string, tbd?: boolean, doubleheader?: number, away: string, home: string, starters: object[] }} game
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
      loadSide(side, season).then(() => {
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

function openFromRow(event) {
  const button = /** @type {HTMLElement} */ (event.target).closest(".game-open");
  if (button instanceof HTMLElement) openMatchup(JSON.parse(button.dataset.game));
}

export function startMatchups() {
  const dialog = findDialog();
  findElement("gamePages").addEventListener("click", openFromRow);
  findElement("matchupDoneBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) dialog.close();
  });
  dialog.addEventListener("scroll", markScrolled);
  closeOnSwipeDown(dialog);
}
