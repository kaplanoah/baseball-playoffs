import { holdRequests } from "./hold-requests.mjs";

/**
 * Keeps the page's store from answering until the returned function is called.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => void>}
 */
export const holdStore = (page) => holdRequests(page, (url) => url.pathname.startsWith("/store/"));
