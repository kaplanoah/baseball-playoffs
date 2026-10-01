import { renderRankTag, renderTeamTag } from "./clubs.js";
import { describeEntry, describeUpdate } from "./entry-text.js";
import { DAYS, countDaysBetween, formatClockTime, formatShortDate } from "#shared/days.js";
import { html, setHtml } from "#shared/html.js";
import { saveSeenAt } from "./season-store.js";
import { session, readSeasonYear } from "./session.js";
import { showSaveResult } from "./stamp-view.js";
import { TEAMS } from "./teams.js";
import { groupUpdates } from "./update-groups.js";

const MAX_SHOWN = 12;

function renderClubChip(id) {
  return TEAMS[id] ? html`${renderRankTag(id)}${renderTeamTag(id, "b")}` : html``;
}

const readTextContext = () => ({
  renderClub: renderClubChip,
  teams: session.state?.teams,
  standings: session.standings,
});

// Markup for an entry, or null for one there is nothing to say about.
export const renderEntryText = (entry) => describeEntry(entry, readTextContext());

export const renderUpdateText = (entries) => describeUpdate(entries, readTextContext());

function formatWhen(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = countDaysBetween(date, now);
  if (days <= 0) return formatClockTime(date);
  if (days === 1) return "Yesterday";
  if (days < 7) return DAYS[date.getDay()];
  return formatShortDate(date);
}
function formatSince(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = countDaysBetween(date, now);
  if (days <= 0) return "since earlier today";
  if (days === 1) return "since yesterday";
  if (days < 7) return `since ${DAYS[date.getDay()]}`;
  return `since ${formatShortDate(date)}`;
}

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

// Updates that share a time show it once, on the first of them.
function formatTimeColumn(groups) {
  const times = groups.map((group) => formatWhen(findHappenedAt(group)));
  return times.map((time, index) => (time === times[index - 1] ? "" : time));
}

function renderUpdate(group, when) {
  return html`<li><span class="when">${when}</span><span class="what">${renderUpdateText(group)}</span></li>`;
}

function hideUpdates(panel) {
  panel.hidden = true;
  setHtml(panel, html``);
}

export function renderUpdates() {
  const panel = document.getElementById("updates");
  const fresh = session.activeYear === readSeasonYear() ? listFreshUpdates() : [];
  if (!fresh.length) {
    hideUpdates(panel);
    return;
  }
  panel.hidden = false;

  const shown = fresh.slice(0, MAX_SHOWN);
  const times = formatTimeColumn(shown);
  const extra = fresh.length - shown.length;
  // The oldest update listed, not the last dismissal: a change can be found after a dismissal
  // but have happened before it.
  const since = formatSince(findHappenedAt(fresh[fresh.length - 1]));
  const head = `${fresh.length} update${fresh.length === 1 ? "" : "s"} ${since}`;

  setHtml(
    panel,
    html`
    <div class="updates-head">
      <span class="updates-count">${head}</span>
      <button type="button" class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
    </div>
    <ul class="updates-list">
      ${shown.map((group, index) => renderUpdate(group, times[index]))}
      ${extra > 0 && html`<li class="more">and ${extra} more</li>`}
    </ul>`,
  );
  document.getElementById("dismissUpdates").addEventListener("click", dismissUpdates);
}

// Updates are stamped by the Worker's clock, so the dismissal goes by the newest one, not by
// this device's clock, which can be off.
function dismissUpdates() {
  const newest = Math.max(...listFreshUpdates().flatMap((group) => group.map(readNoticedAt)));
  const saving = saveSeenAt(new Date(newest).toISOString());
  renderUpdates();
  return showSaveResult(saving);
}
