import { TEAMS } from "./teams.js";
import { fullBracket } from "./bracket.js";
import { escapeHtml } from "./html.js";
import { session, seasonYear } from "./session.js";

export function lastTitle(id) {
  const seeded = TEAMS[id].lastWS;
  const tracked = session.trackedTitles[id];
  if (seeded && tracked) return Math.max(seeded, tracked);
  return tracked || seeded;
}

export function droughtLabel(id) {
  const won = lastTitle(id);
  if (!won) return `Since ${TEAMS[id].firstSeason}`;
  const year = seasonYear();
  if (won >= year) return "Reigning";
  const { state } = session;
  const crowned = state && state.teams ? fullBracket(state).ws?.winner : null;
  if (won === year - 1 && !crowned) return "Defending";
  const years = year - won;
  return years + (years === 1 ? " yr" : " yrs");
}

const perceivedLightness = (hex) => {
  const [red, green, blue] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  return 0.299 * red + 0.587 * green + 0.114 * blue;
};

// Split vertically so the inner shadow shades both halves alike; a much lighter half reads larger,
// so it gets slightly less room.
function chooseDotSplit(team) {
  const contrastGap = perceivedLightness(team.color2) - perceivedLightness(team.color);
  if (contrastGap > 90) return 52;
  if (contrastGap < -90) return 48;
  return 50;
}

function teamDot(id) {
  const team = TEAMS[id];
  if (!team) return `<span class="dot" style="background:#999"></span>`;
  const split = chooseDotSplit(team);
  return `<span class="dot" style="background:linear-gradient(90deg, ${team.color} ${split}%, ${team.color2} ${split}%)"></span>`;
}

export function teamLabel(id) {
  return TEAMS[id] ? TEAMS[id].name : "?";
}

export function teamTag(id, tag = "span") {
  return `<span class="club">${teamDot(id)}<${tag} class="team-name">${teamLabel(id)}</${tag}></span>`;
}

// `ranking` changes only on a drag, so it can name clubs that left the field and miss ones that arrived.
export function rankedOrder() {
  const { state } = session;
  if (!state || !state.teams) return [];
  const ranked = (state.ranking || []).filter((id) => state.teams[id]);
  const unranked = Object.keys(state.teams).filter((id) => !ranked.includes(id));
  return ranked.concat(unranked);
}

export function seedMark(seed) {
  return seed ? `<span class="seed-pre tabular">${escapeHtml(seed)}</span>` : "";
}

export function rankTag(id, solid) {
  const index = rankedOrder().indexOf(id);
  if (index === -1) return "";
  return `<span class="rank-slot"><span class="rank-tag ${solid ? "solid" : ""}">#${index + 1}</span></span>`;
}
