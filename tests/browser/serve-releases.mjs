const RELEASE = { version: "2.13.0", commit: "abc1234", builtAt: "2026-09-28T00:10:41Z" };
export const NEXT_RELEASE = {
  version: "2.13.1",
  commit: "def5678",
  builtAt: "2026-09-28T02:00:00Z",
};

/**
 * Serves version.json, and lets a test deploy a newer release, fail the next few reads, or leave
 * reads unanswered.
 * @param {import("@playwright/test").Page} page
 */
export async function serveReleases(page) {
  const served = { release: RELEASE, requests: 0, failures: 0, isHanging: false };
  await page.route(
    (url) => url.pathname === "/version.json",
    (route) => {
      served.requests++;
      if (served.isHanging) return undefined;
      if (served.failures > 0) {
        served.failures--;
        return route.fulfill({ status: 503, body: "" });
      }
      return route.fulfill({ json: served.release });
    },
  );
  return served;
}
