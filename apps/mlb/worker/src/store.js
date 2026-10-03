import { OFF_DAY_CHECK_MS } from "#shared/poll-schedule.js";
import { choosePollDelay } from "../../page/js/snapshot.js";
import { createSeasonStore } from "../../../../shared/worker/season-store.js";
import { findNotableUpdates, listNotifications } from "./notifications.js";
import * as SeasonUpdater from "./season-updater.js";
import { createSnapshotServer } from "./snapshot.js";

export { forwardToStore } from "../../../../shared/worker/season-store.js";

// Baseball's page saves the ranking and when updates were last seen.
const PAGE_FIELDS = {
  ranking: (value) => Array.isArray(value) && value.every((id) => typeof id === "string"),
  seenAt: (value) => typeof value === "string",
};

export const SeasonStore = createSeasonStore({
  pageFields: PAGE_FIELDS,
  createLoadSnapshot: (storage) => createSnapshotServer({ storage }).loadSnapshot,
  loadCurrentSnapshot: SeasonUpdater.loadCurrentSnapshot,
  readUpdates: SeasonUpdater.readUpdates,
  saveSnapshot: SeasonUpdater.saveSnapshot,
  describeSnapshotStatus: SeasonUpdater.describeSnapshotStatus,
  choosePollDelay: (snapshot, now) => choosePollDelay(snapshot, now) ?? OFF_DAY_CHECK_MS,
  listNotifications: ({ before, after, snapshot, now }) => {
    const updates = findNotableUpdates({ before, after, state: snapshot, now });
    const context = { teams: snapshot.teams, standings: snapshot.standings };
    return updates.length ? listNotifications(updates, context) : [];
  },
});
