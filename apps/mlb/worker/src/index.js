import PAGE_FILES from "#page-files/mlb";
import { createAppWorker } from "../../../../shared/worker/app-worker.js";
import { createPitcherServer } from "./pitchers.js";
import { createRotationServer } from "./rotations.js";
import { createSnapshotServer } from "./snapshot.js";
import { SeasonStore, forwardToStore } from "./store.js";

const snapshots = createSnapshotServer();
const pitchers = createPitcherServer();
const rotations = createRotationServer();

export default createAppWorker({
  pageFiles: PAGE_FILES,
  serveSnapshot: (url) => snapshots.serveSnapshot(url),
  forwardToStore,
  reads: {
    "/pitcher": (url) => pitchers.servePitcher(url),
    "/rotation": (url) => rotations.serveRotation(url),
  },
});

export { SeasonStore };
