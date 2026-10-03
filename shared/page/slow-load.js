// Until the page's modules load and draw the season, its views are empty, which on a weak or lost
// connection can last minutes. This plain script loads in the head, and the page calls
// watchSlowLoad() right after its views, so the note says why; the page's modules end it with
// endLoadNote() from load-note.js.

const SLOW_LOAD_MS = 4000;
const SLOW_TEXT = "Still loading. Your connection is slow.";
const OFFLINE_TEXT = "You're offline. The page loads once you're back online.";

/**
 * @param {HTMLElement} note
 * @param {boolean} hasWaited
 */
function updateLoadNote(note, hasWaited) {
  const isOffline = !navigator.onLine;
  if (!note.isConnected || (note.hidden && !hasWaited && !isOffline)) return;
  note.textContent = isOffline ? OFFLINE_TEXT : SLOW_TEXT;
  note.hidden = false;
}

// The wait counts from the page's request, since the head's stylesheets can take most of it.
function watchSlowLoad() {
  const note = document.getElementById("loadNote");
  if (!note) return;
  const waitLeftMs = SLOW_LOAD_MS - performance.now();
  let hasWaited = waitLeftMs <= 0;
  const update = () => updateLoadNote(note, hasWaited);
  if (!hasWaited)
    setTimeout(() => {
      hasWaited = true;
      update();
    }, waitLeftMs);
  addEventListener("online", update);
  addEventListener("offline", update);
  update();
}
