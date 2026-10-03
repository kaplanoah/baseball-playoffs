const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// Stored documents are writable by anyone the page is shared with, so their text is never markup.
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);

export class Markup {
  /** @param {string} text */
  constructor(text) {
    this.text = text;
  }
  toString() {
    return this.text;
  }
}

// `false` renders as nothing, so `${isShown && html`...`}` reads naturally.
function renderValue(value) {
  if (value instanceof Markup) return value.text;
  if (Array.isArray(value)) return value.map(renderValue).join("");
  if (value === false) return "";
  return escapeHtml(value);
}

/**
 * Builds markup from a template, escaping every value except markup built the same way.
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 */
export function html(strings, ...values) {
  let text = strings[0];
  values.forEach((value, index) => {
    text += renderValue(value) + strings[index + 1];
  });
  return new Markup(text);
}

const TEXT_ENTITIES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&ndash;": "\u2013",
  "&mdash;": "\u2014",
};

// For places that show only text, like a notification.
export const convertToText = (markup) =>
  renderValue(markup)
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|ndash|mdash);/g, (entity) => TEXT_ENTITIES[entity]);

const SEPARATOR = new Markup('<span class="sep">&bull;</span>');

/**
 * Joins items with the page's one separator, so every list of facts reads the same way. Each fact
 * holds the separator after it, so a line that keeps its facts whole breaks after a dot.
 * @param {unknown[]} items
 */
export const joinWithSeparator = (items) =>
  html`${items.map(
    (item, index) =>
      html`<span class="fact">${item}${index < items.length - 1 && SEPARATOR}</span>`,
  )}`;

// Views redraw on every update and every minute, so markup the element already holds is left as
// it is, and new markup changes only the nodes that differ, keeping the focus, scrolling, loaded
// images, and running animations inside the rest.
const writtenMarkup = new WeakMap();

/** @typedef {{ heights: Map<Element, number>, added: Element[] }} PatchLog */

/** @type {PatchLog | null} */
let patchLog = null;

// A changed line of text rarely changes a height, and measuring before each would lay the page
// out again for every changed number, so only adding, removing, or hiding an element counts.
/** @param {Node} element */
function noteHeight(element) {
  if (patchLog && element instanceof Element && !patchLog.heights.has(element))
    patchLog.heights.set(element, element.getBoundingClientRect().height);
}

/** @param {Node} node */
function noteAdded(node) {
  if (patchLog && node instanceof Element) patchLog.added.push(node);
}

/**
 * Runs `redraw`, and returns how tall each element whose children or `hidden` it changed was
 * before, and the elements it added.
 * @param {() => void} redraw
 * @returns {PatchLog}
 */
export function logPatches(redraw) {
  const log = { heights: new Map(), added: [] };
  patchLog = log;
  try {
    redraw();
  } finally {
    patchLog = null;
  }
  return log;
}

/**
 * @param {Node} current
 * @param {Node} next
 */
const isSameKind = (current, next) =>
  current.nodeName === next.nodeName &&
  (!(current instanceof Element) ||
    (current.namespaceURI === /** @type {Element} */ (next).namespaceURI &&
      current.id === /** @type {Element} */ (next).id));

/**
 * @param {Element} current
 * @param {Element} next
 */
function patchAttributes(current, next) {
  if (current.hasAttribute("hidden") !== next.hasAttribute("hidden")) noteHeight(current);
  for (const { name } of [...current.attributes]) {
    if (!next.hasAttribute(name)) current.removeAttribute(name);
  }
  for (const { name, value } of next.attributes) {
    if (current.getAttribute(name) !== value) current.setAttribute(name, value);
  }
}

// An element that setHtml writes on its own keeps its children when the markup around it is
// patched, since its own writes fill them.
/**
 * @param {Node} current
 * @param {Node} next
 */
function patchNode(current, next) {
  if (!(current instanceof Element)) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return;
  }
  patchAttributes(current, /** @type {Element} */ (next));
  if (!writtenMarkup.has(current)) patchChildren(current, next);
}

/**
 * Makes `parent`'s children match `nextParent`'s, keeping each node that sits in the same place
 * as one of the same kind. An empty element filling in shows something new rather than changing
 * what it showed, so a logged redraw leaves it out.
 * @param {Node} parent
 * @param {Node} nextParent
 */
function patchChildren(parent, nextParent) {
  const isFilling = !parent.firstChild;
  let current = parent.firstChild;
  for (const next of [...nextParent.childNodes]) {
    if (current && isSameKind(current, next)) {
      const patched = current;
      current = current.nextSibling;
      patchNode(patched, next);
    } else if (isFilling) parent.insertBefore(next, current);
    else {
      noteHeight(parent);
      parent.insertBefore(next, current);
      noteAdded(next);
    }
  }
  if (current) noteHeight(parent);
  while (current) {
    const left = current;
    current = current.nextSibling;
    left.remove();
  }
}

/**
 * @param {Element} element
 * @param {string} text
 */
function patchMarkup(element, text) {
  // A copy of the element reads the markup as the element would, as rows in a table or paths in
  // an SVG, without running it in the page.
  const next = /** @type {Element} */ (element.cloneNode(false));
  next.innerHTML = text;
  // A select's choice is its options' state, not their markup, so it follows the markup's as a
  // newly written select would. Patching moves the options it reads from, so it's read first.
  const selectedIndex = next instanceof HTMLSelectElement ? next.selectedIndex : -1;
  patchChildren(element, next);
  if (element instanceof HTMLSelectElement) element.selectedIndex = selectedIndex;
}

/**
 * The page's only way to write markup, so nothing reaches it unescaped.
 * @param {Element} element
 * @param {Markup | string} markup plain text is escaped
 */
export function setHtml(element, markup) {
  const text = renderValue(markup);
  if (writtenMarkup.get(element) === text) return;
  writtenMarkup.set(element, text);
  // An empty element has nothing to keep, so its markup goes straight in.
  if (element.firstChild) patchMarkup(element, text);
  else element.innerHTML = text;
}
