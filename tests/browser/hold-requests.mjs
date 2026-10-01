/**
 * Keeps the page's requests that match from being answered until the returned function is called.
 * @param {import("@playwright/test").Page} page
 * @param {(url: URL) => boolean} matches
 * @returns {Promise<() => void>}
 */
export async function holdRequests(page, matches) {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route(matches, async (route) => {
    await held;
    await route.fallback();
  });
  return release;
}
