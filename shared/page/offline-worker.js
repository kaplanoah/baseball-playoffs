// The service worker keeps a copy of the page and every file it loads, so the page opens at once
// on a weak connection or none, and draws what it last showed. It opens the copy and reads the
// page again behind it, and a newer page replaces the copy only once all of its files are kept,
// so the copy always opens whole. A deploy then reaches the page on its next open, or when its
// release check reloads it. Only the page and its files go through here; version.json, the store,
// and everything else always reach the Worker.

const PAGE_CACHE = "page";
const PAGE_FILE_PATH = /\.(?:js|css|woff2)$/;
const PAGE_FILE_TAG = /<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+)"/g;

const findPageAddress = () => self.registration.scope;

/** @param {URL} url */
function isPageAddress(url) {
  const page = new URL(findPageAddress());
  return (
    url.origin === page.origin &&
    (url.pathname === page.pathname || url.pathname === `${page.pathname}index.html`)
  );
}

/** @param {URL} url */
const isPageFile = (url) =>
  url.href.startsWith(findPageAddress()) && PAGE_FILE_PATH.test(url.pathname);

/**
 * Every file of the page's own that its markup loads.
 * @param {string} page
 */
function listPageFiles(page) {
  const addresses = [...page.matchAll(PAGE_FILE_TAG)].map(
    ([, address]) => new URL(address, findPageAddress()),
  );
  return [...new Set(addresses.filter(isPageFile).map((url) => url.href))];
}

/**
 * @param {Cache} cache
 * @param {string} file
 */
async function keepFile(cache, file) {
  const response = await fetch(file);
  if (!response.ok) throw new Error(`${file} answered ${response.status}`);
  await cache.put(file, response);
}

// Each file that arrives stays, so the next try on a weak connection picks up where this one
// stopped.
/**
 * @param {Cache} cache
 * @param {string[]} files
 */
async function keepMissingFiles(cache, files) {
  const kept = await Promise.all(files.map((file) => cache.match(file)));
  const missing = files.filter((file, index) => !kept[index]);
  const results = await Promise.allSettled(missing.map((file) => keepFile(cache, file)));
  if (results.some(({ status }) => status === "rejected"))
    throw new Error("A file of the page didn't arrive.");
}

/**
 * @param {Cache} cache
 * @param {string[]} files
 */
async function forgetOtherFiles(cache, files) {
  const wanted = new Set([findPageAddress(), ...files]);
  const keys = await cache.keys();
  await Promise.all(keys.filter(({ url }) => !wanted.has(url)).map((key) => cache.delete(key)));
}

// Until all of the page's files have arrived, the copy stays as it was.
/** @param {Response} response */
async function keepPage(response) {
  const page = await response.text();
  const files = listPageFiles(page);
  const cache = await caches.open(PAGE_CACHE);
  await keepMissingFiles(cache, files);
  const headers = { "content-type": response.headers.get("content-type") ?? "text/html" };
  await cache.put(findPageAddress(), new Response(page, { headers }));
  await forgetOtherFiles(cache, files);
}

const forgetPage = () => caches.delete(PAGE_CACHE);

// The Worker shows its access gate at the page's address, which it says never to store, to a
// phone that is signed out, and the copy would get past it.
/** @param {Response} response */
const isGate = (response) => /\bno-store\b/.test(response.headers.get("cache-control") ?? "");

// Whether the copy now opens what the Worker shows: the newer page, or the gate, with no copy.
/** @param {Response} response */
async function followPage(response) {
  if (isGate(response)) await forgetPage();
  else if (response.ok) await keepPage(response);
  return isGate(response) || response.ok;
}

/** @type {Promise<boolean> | null} */
let refreshing = null;

// One read at a time, shared by every open and every page waiting on it.
function refreshCopy() {
  refreshing ??= fetch(findPageAddress())
    .then(followPage)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

/** @param {FetchEvent} event */
async function openPage(event) {
  const copy = await caches.match(findPageAddress(), { cacheName: PAGE_CACHE });
  if (copy) {
    event.waitUntil(refreshCopy());
    return copy;
  }
  const response = await fetch(event.request);
  event.waitUntil(followPage(response.clone()).catch(() => {}));
  return response;
}

/** @param {string} file */
async function isNamedByCopy(file) {
  const kept = await caches.match(findPageAddress(), { cacheName: PAGE_CACHE });
  return !!kept && listPageFiles(await kept.text()).includes(file);
}

// A file the Worker no longer has belongs to a release it has replaced, so a copy that needs it
// can't open whole, and the page's reload then reaches the Worker.
/** @param {Request} request */
async function readPageFile(request) {
  const kept = await caches.match(request, { cacheName: PAGE_CACHE });
  if (kept) return kept;
  const response = await fetch(request);
  if (response.status === 404 && (await isNamedByCopy(request.url))) await forgetPage();
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (request.mode === "navigate" && isPageAddress(url)) event.respondWith(openPage(event));
  else if (isPageFile(url)) event.respondWith(readPageFile(request));
});

// A phone gets its first copy as soon as the worker starts, not on the page's next open. The
// activation doesn't wait for it, since the page's requests would wait with it.
self.addEventListener("activate", () => {
  refreshCopy();
});

// A page a deploy replaced reloads only once the copy holds the newer page, or the reload would
// open the copy it already runs.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "refreshPageCopy") return;
  event.waitUntil(refreshCopy().then((isCurrent) => event.ports[0]?.postMessage(isCurrent)));
});
