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
// it is, with the focus, scrolling, and running animations inside it.
const writtenMarkup = new WeakMap();

/**
 * The page's only way to write markup, so nothing reaches it unescaped.
 * @param {Element} element
 * @param {Markup | string} markup plain text is escaped
 */
export function setHtml(element, markup) {
  const text = renderValue(markup);
  if (writtenMarkup.get(element) === text) return;
  writtenMarkup.set(element, text);
  element.innerHTML = text;
}
