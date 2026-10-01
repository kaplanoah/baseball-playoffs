// What the page shows, read from the Worker's store and kept current as it changes.
export const session = {
  /** @type {ReturnType<typeof import("#shared/worker-store.js").createWorkerStore> | null} */
  db: null,
  year: new Date().getFullYear(),
  /** @type {any} */
  season: null,
  /** @type {{ error?: string, detail?: string } | null} */
  status: null,
  problem: "",
  /** @type {import("./standings-view.js").StandingsView} */
  standingsView: "League",
};
