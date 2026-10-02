import { test } from "node:test";
import assert from "node:assert/strict";
import { joinWithSeparator } from "../shared/page/html.js";

test("each fact in a line of facts keeps the dot after it, so a line breaks only after a dot", () => {
  assert.equal(
    joinWithSeparator(["Lead changes: 15", "Ties: 14", "Timeouts left: 1"]).text,
    '<span class="fact">Lead changes: 15<span class="sep">&bull;</span></span>' +
      '<span class="fact">Ties: 14<span class="sep">&bull;</span></span>' +
      '<span class="fact">Timeouts left: 1</span>',
  );
});

test("a line of facts escapes each fact", () => {
  assert.equal(joinWithSeparator(["<b>"]).text, '<span class="fact">&lt;b&gt;</span>');
});
