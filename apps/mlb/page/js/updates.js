import { renderClub, renderRankTag } from "./clubs.js";
import { describeEntry, describeUpdate } from "./entry-text.js";
import { html } from "#shared/html.js";
import { showUpdates } from "#shared/updates.js";
import { saveSeenAt } from "./season-store.js";
import { session, readSeasonYear } from "./session.js";
import { showSaveResult } from "./stamp-view.js";
import { TEAMS } from "./teams.js";
import { groupUpdates } from "./update-groups.js";

function renderClubChip(id) {
  return TEAMS[id] ? html`${renderRankTag(id)}${renderClub(id)}` : html``;
}

const readTextContext = () => ({
  renderClub: renderClubChip,
  teams: session.state?.teams,
  standings: session.standings,
});

// Markup for an entry, or null for one there is nothing to say about.
export const renderEntryText = (entry) => describeEntry(entry, readTextContext());

export const renderUpdateText = (entries) => describeUpdate(entries, readTextContext());

// Freshness goes by when a change was noticed; the list shows when it happened, which for a
// group is when its last game ended.
const findHappenedAt = (group) =>
  Math.max(...group.map((entry) => Date.parse(entry.ended || entry.at)));

const readNoticedAt = (entry) => Date.parse(entry.at);

function listFreshUpdates() {
  const seen = session.state.seenAt ? Date.parse(session.state.seenAt) : 0;
  const fresh = (session.state.log || []).filter(
    (entry) => entry && (!seen || readNoticedAt(entry) > seen) && renderEntryText(entry),
  );
  return groupUpdates(fresh).sort(
    (first, second) => findHappenedAt(second) - findHappenedAt(first),
  );
}

export function renderUpdates() {
  const fresh = session.activeYear === readSeasonYear() ? listFreshUpdates() : [];
  const updates = fresh.map((group) => ({
    at: findHappenedAt(group),
    text: renderUpdateText(group),
  }));
  showUpdates(/** @type {HTMLElement} */ (document.getElementById("updates")), updates, {
    dismiss: dismissUpdates,
  });
}

// Updates are stamped by the Worker's clock, so the dismissal goes by the newest one, not by
// this device's clock, which can be off.
function dismissUpdates() {
  const newest = Math.max(...listFreshUpdates().flatMap((group) => group.map(readNoticedAt)));
  const saving = saveSeenAt(new Date(newest).toISOString());
  renderUpdates();
  return showSaveResult(saving);
}
