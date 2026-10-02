import { test } from "node:test";
import assert from "node:assert/strict";
import { html } from "../shared/page/html.js";
import { renderUpdates } from "../shared/page/updates.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

const NOW = new Date("2026-10-01T23:00:00Z");
const at = (iso) => Date.parse(iso);

/**
 * @param {import("../shared/page/html.js").Markup} markup
 * @param {string} name
 */
const readCells = (markup, name) =>
  [...markup.text.matchAll(new RegExp(`<span class="${name}">([^<]*)</span>`, "g"))].map((match) =>
    normalizeSpaces(match[1]),
  );

test("the box counts its updates since the oldest, and names each one's time once", () =>
  checkInTimeZone(EASTERN, () => {
    const markup = renderUpdates(
      [
        { at: at("2026-10-01T22:30:00Z"), text: html`<b>Liberty</b> won` },
        { at: at("2026-10-01T22:30:00Z"), text: html`<b>Fever</b> won` },
        { at: at("2026-09-30T22:00:00Z"), text: html`<b>Dream</b> won` },
      ],
      NOW,
    );

    assert.deepEqual(readCells(markup, "updates-count"), ["3 updates since yesterday"]);
    assert.deepEqual(readCells(markup, "when"), ["6:30 PM", "", "Yesterday"]);
    assert.match(markup.text, /<span class="what"><b>Liberty<\/b> won<\/span>/);
    assert.match(markup.text, /aria-label="Dismiss updates"/);
  }));

test("one update today reads in the singular, since earlier today", () =>
  checkInTimeZone(EASTERN, () => {
    const markup = renderUpdates([{ at: at("2026-10-01T20:00:00Z"), text: html`won` }], NOW);

    assert.deepEqual(readCells(markup, "updates-count"), ["1 update since earlier today"]);
  }));

test("the box lists the newest dozen and counts the rest", () => {
  const updates = Array.from({ length: 15 }, (_, index) => ({
    at: at("2026-10-01T20:00:00Z") - index * 60 * 1000,
    text: html`Game ${index}`,
  }));
  const markup = renderUpdates(updates, NOW);

  assert.equal(markup.text.match(/<span class="what">/g)?.length, 12);
  assert.match(markup.text, /<li class="more">and 3 more<\/li>/);
});
