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

/**
 * The page's only way to write markup, so nothing reaches it unescaped.
 * @param {Element} element
 * @param {Markup | string} markup plain text is escaped
 */
export function setHtml(element, markup) {
  element.innerHTML = renderValue(markup);
}
