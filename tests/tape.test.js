import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPendingTapeRow, renderTapeRow } from "../shared/page/tape.js";
import { stripTags } from "./text.js";

const readSide = (markup, place) =>
  markup.text.match(new RegExp(`<div class="tape-side ${place}">([\\s\\S]*?)</div>`))[1];

test("a tape row puts the measure between the two sides, the leader's bar marked", () => {
  const row = renderTapeRow({
    label: "Field goals",
    away: { value: "47.9%", detail: "23-48", bar: 47.9 },
    home: { value: "42.0%", detail: "21-50", bar: 42 },
    leader: "away",
  });

  assert.equal(stripTags(row).replace(/\s+/g, " ").trim(), "47.9%23-48 Field goals 42.0%21-50");
  assert.match(readSide(row, "away"), /<i class="lead" style="width: 47.9%">/);
  assert.match(readSide(row, "home"), /<i class="" style="width: 42%">/);
  assert.match(readSide(row, "away"), /<span class="tape-detail">23-48<\/span>/);
});

test("a side without a number is left blank, and one without a bar has none", () => {
  const row = renderTapeRow({
    label: "ERA",
    away: null,
    home: { value: "4.02", bar: null },
    leader: null,
  });

  assert.equal(readSide(row, "away"), "");
  assert.doesNotMatch(row.text, /tape-bar/);
  assert.doesNotMatch(row.text, /tape-detail/);
  assert.match(readSide(row, "home"), /4\.02/);
});

test("a measure still loading keeps its name, with a placeholder over an empty bar on each side", () => {
  const row = renderPendingTapeRow("ERA");

  assert.match(row.text, /<span class="tape-label">ERA<\/span>/);
  for (const place of ["away", "home"]) {
    assert.match(readSide(row, place), /<span class="placeholder" aria-hidden="true">/);
    assert.match(readSide(row, place), /<i class="" style="width: 0%">/);
  }
});
