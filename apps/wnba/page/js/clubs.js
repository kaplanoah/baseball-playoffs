import { html } from "#shared/html.js";
import { renderTeamSheetButton } from "#shared/team-sheet.js";
import { nameTeam } from "./series.js";
import { TEAMS } from "./teams.js";

/** @param {string | null} code */
export function renderDot(code) {
  const team = code ? TEAMS[code] : null;
  if (!team) return html`<span class="dot unknown"></span>`;
  return html`<span class="dot" style="--color:${team.color};--color2:${team.color2}"></span>`;
}

// The feeds give a seed of 0 to a team that isn't known yet.
/** @param {number | null | undefined} seed */
const renderSeed = (seed) => (seed ? html`<span class="seed">${seed}</span>` : "");

/**
 * @param {string | null} code
 * @param {number | null | undefined} seed
 */
const renderClubParts = (code, seed) =>
  html`${renderDot(code)}${renderSeed(seed)}<span class="team-name">${nameTeam(code)}</span>`;

/** @param {string} code */
const nameFullTeam = (code) => `${TEAMS[code].city} ${TEAMS[code].name}`;

/**
 * A team's dot, seed, and name, that opens its sheet, or TBD while it isn't known.
 * @param {string | null} code
 * @param {{ seed?: number | null }} [options]
 */
export function renderClub(code, { seed } = {}) {
  if (!code || !TEAMS[code])
    return html`<span class="club tbd">${renderClubParts(code, seed)}</span>`;
  return renderTeamSheetButton({
    team: code,
    name: nameFullTeam(code),
    content: renderClubParts(code, seed),
    className: "club",
  });
}

/**
 * A team's dot and name, for inside a button of its own.
 * @param {string} code
 */
export const renderPlainClub = (code) =>
  html`<span class="club">${renderClubParts(code, null)}</span>`;

/**
 * A button around a team's name that opens its sheet.
 * @param {string} code
 * @param {import("#shared/html.js").Markup | string} content
 */
export const renderTeamButton = (code, content) =>
  renderTeamSheetButton({ team: code, name: nameFullTeam(code), content });

/**
 * A team's name in a line of text, that opens its sheet once the team is known.
 * @param {string | null} code
 */
export const renderTeamName = (code) =>
  code && TEAMS[code] ? renderTeamButton(code, nameTeam(code)) : nameTeam(code);
