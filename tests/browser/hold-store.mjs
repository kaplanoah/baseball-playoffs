/**
 * Keeps the page's store from answering until the returned function is called.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => void>}
 */
export async function holdStore(page) {
  let release = () => {};
  const held = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  await page.route(
    (url) => url.pathname.startsWith("/store/"),
    async (route) => {
      await held;
      await route.fallback();
    },
  );
  return release;
}
