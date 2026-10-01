import PAGE_FILES from "#page-files/wnba";
import { createAppWorker } from "../../../../shared/worker/app-worker.js";
import { createBoxScoreServer } from "./box-score.js";
import { createPreviewServer } from "./preview.js";
import { createSnapshotServer } from "./snapshot.js";
import { SeasonStore, forwardToStore } from "./store.js";

const snapshots = createSnapshotServer();
const boxScores = createBoxScoreServer();
const previews = createPreviewServer();

export default createAppWorker({
  pageFiles: PAGE_FILES,
  serveSnapshot: (url) => snapshots.serveSnapshot(url),
  forwardToStore,
  reads: {
    "/box-score": (url) => boxScores.serveBoxScore(url),
    "/preview": (url) => previews.servePreview(url),
  },
});

export { SeasonStore };
