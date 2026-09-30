/** @typedef {{ version: string | null, commit: string, builtAt: string }} Release */

/** @type {Promise<Release | null> | null} */
let loadedRelease = null;

// The deploy writes version.json into the Worker's bundle; a local server has none.
/** @returns {Promise<Release | null>} */
export async function fetchRelease() {
  try {
    const response = await fetch(new URL("version.json", location.href), { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

// The release this page was loaded from; a deploy since then serves a newer one.
export function loadRelease() {
  loadedRelease ??= fetchRelease();
  return loadedRelease;
}
