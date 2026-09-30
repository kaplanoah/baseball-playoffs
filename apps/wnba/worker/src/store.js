import { choosePollDelay } from "../../page/js/snapshot.js";
import { createSeasonStore } from "../../../../shared/worker/season-store.js";
import * as SeasonUpdater from "./season-updater.js";
import { createSnapshotServer } from "./snapshot.js";

export { forwardToStore } from "../../../../shared/worker/season-store.js";

// The page saves nothing to the store: each device keeps what it has seen for itself.
export const SeasonStore = createSeasonStore({
  pageFields: {},
  createLoadSnapshot: () => createSnapshotServer().loadSnapshot,
  loadCurrentSnapshot: SeasonUpdater.loadCurrentSnapshot,
  readUpdates: SeasonUpdater.readUpdates,
  saveSnapshot: SeasonUpdater.saveSnapshot,
  describeSnapshotStatus: SeasonUpdater.describeSnapshotStatus,
  saveStatus: SeasonUpdater.saveStatus,
  choosePollDelay,
  retryMs: SeasonUpdater.RETRY_MS,
  listNotifications: SeasonUpdater.listNotifications,
});
