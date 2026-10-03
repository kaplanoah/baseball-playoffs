// The page's service worker, sw.js, shows its notifications and keeps its offline copy.

/** @type {Promise<ServiceWorkerRegistration> | null} */
let registration = null;

export function registerServiceWorker() {
  registration ??= navigator.serviceWorker.register("sw.js");
  return registration;
}

// A browser without service workers, or one that refuses this page's, reads the page from the
// Worker each time.
export function startServiceWorker() {
  if ("serviceWorker" in navigator) registerServiceWorker().catch(() => {});
}

// A worker the phone stops part way never answers, and the page's next release check asks again.
const REFRESH_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Whether the service worker's copy of the page now holds the Worker's page, after it reads it
 * again. A page the worker doesn't control opens from the Worker, which always has it.
 * @returns {Promise<boolean>}
 */
export function refreshPageCopy() {
  const worker = navigator.serviceWorker?.controller;
  if (!worker) return Promise.resolve(true);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = ({ data }) => resolve(data === true);
    setTimeout(() => resolve(false), REFRESH_TIMEOUT_MS);
    worker.postMessage({ type: "refreshPageCopy" }, [channel.port2]);
  });
}
