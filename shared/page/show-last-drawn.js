// Modules run only once all of them have loaded, and the browser can paint before then, so a page
// left to them would first show empty views. The page saves what each part it draws whole showed
// as it leaves the screen (last-seen.js), and this plain script, loaded in the head, puts it back:
// the page calls showLastDrawn() right after its views, before anything is painted.

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.
function readLastDrawn() {
  try {
    const saved = JSON.parse(localStorage.getItem("lastDrawn") ?? "null");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

// Only a part the page draws whole goes back, since a release may have changed the markup around
// it, and the page's modules redraw it from the season before it's ever used.
/**
 * @param {string} id
 * @param {any} part
 */
function isDrawnPart(id, part) {
  const element = document.getElementById(id);
  return !!element?.hasAttribute("data-last-drawn") && typeof part?.markup === "string";
}

/**
 * @param {string} id
 * @param {{ markup: string, hidden: boolean }} part
 */
function showPart(id, { markup, hidden }) {
  const element = /** @type {HTMLElement} */ (document.getElementById(id));
  element.innerHTML = markup;
  element.hidden = hidden === true;
}

// What the page last showed is a drawing of its own, so the note that its views are still empty
// goes with it.
function showLastDrawn() {
  const parts = Object.entries(readLastDrawn()).filter(([id, part]) => isDrawnPart(id, part));
  for (const [id, part] of parts) showPart(id, part);
  if (parts.length) document.getElementById("loadNote")?.remove();
}
