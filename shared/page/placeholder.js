import { html } from "./html.js";

/**
 * A stand-in for text still loading, as sheet.css draws it: a pulsing bar as wide and tall as
 * the sample text would be, so the page keeps its shape until the real text replaces it.
 * @param {string} sample text about as long as what will show here
 */
export const renderPlaceholder = (sample) =>
  html`<span class="placeholder" aria-hidden="true">${sample}</span>`;
