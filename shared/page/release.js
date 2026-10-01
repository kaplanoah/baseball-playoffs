/** @typedef {{ version: string | null, commit: string, builtAt: string }} Release */

/** @type {Promise<Release | null> | null} */
let loadedRelease = null;

// The deploy writes version.json into the Worker's bundle; a local server has none.
/**
 * @param {URL} url
 * @returns {Promise<Release | null>}
 */
async function readRelease(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export const fetchRelease = () => readRelease(new URL("version.json", location.href));

// The release this page's files came from, read from their own folder, since the Worker may
// already serve a newer one. A failed read isn't kept, so the next check tries again.
export function loadRelease() {
  loadedRelease ??= readRelease(new URL("../version.json", import.meta.url)).then((release) => {
    if (!release) loadedRelease = null;
    return release;
  });
  return loadedRelease;
}
