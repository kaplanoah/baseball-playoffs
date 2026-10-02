import { html } from "./html.js";

/**
 * One titled part of a sheet, with an optional note across from its title.
 * @param {string} title
 * @param {import("./html.js").Markup} body
 * @param {import("./html.js").Markup | string | false} [aside]
 */
export const renderSheetPart = (title, body, aside = false) =>
  html`<section class="sheet-part">
    <div class="sheet-part-head">
      <h3>${title}</h3>
      ${aside && html`<span>${aside}</span>`}
    </div>
    ${body}
  </section>`;
