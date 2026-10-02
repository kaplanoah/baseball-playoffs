import { html } from "#shared/html.js";
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
 * A team's dot, seed, and name, or TBD while it isn't known.
 * @param {string | null} code
 * @param {{ seed?: number | null }} [options]
 */
export const renderClub = (code, { seed } = {}) =>
  html`<span class="club${code ? "" : " tbd"}">${renderDot(code)}${renderSeed(seed)}<span class="team-name">${nameTeam(code)}</span></span>`;

/**
 * A button around a team's name that opens its sheet, which reads where its row says data-team.
 * @param {string} code
 * @param {import("#shared/html.js").Markup} content
 */
export const renderTeamButton = (code, content) =>
  html`<button type="button" class="team-open" aria-label="Team details: ${TEAMS[code].city} ${TEAMS[code].name}">${content}</button>`;
