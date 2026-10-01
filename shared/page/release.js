/** @typedef {{ version: string | null, commit: string, builtAt: string }} Release */

// A phone waking a page can hold its first requests until they time out, so a read gives up
// rather than keep every later check waiting on it.
const RELEASE_TIMEOUT_MS = 10 * 1000;

/** @type {Promise<Release | null> | null} */
let loadedRelease = null;

// The deploy writes version.json into the Worker's bundle; a local server has none, and answers
// null. A read that gets no answer rejects, so a caller can try again.
/** @returns {Promise<Release | null>} */
export async function fetchRelease() {
  const response = await fetch(new URL("version.json", location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(RELEASE_TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`version.json answered ${response.status}`);
  return response.json();
}

// The release this page was loaded from; a deploy since then serves a newer one. A failed read
// isn't kept, so the next load tries again.
export function loadRelease() {
  loadedRelease ??= fetchRelease().catch((error) => {
    loadedRelease = null;
    throw error;
  });
  return loadedRelease;
}
