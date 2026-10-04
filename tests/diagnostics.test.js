import { test } from "node:test";
import assert from "node:assert/strict";
import { describeLoad, describeTimeAway, writeRecordsAsText } from "../shared/page/diagnostics.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

const MINUTE_MS = 60 * 1000;

test("a load names a reload, and anything else an open", () => {
  assert.equal(describeLoad("reload"), "Reloaded");
  assert.equal(describeLoad("navigate"), "Opened");
  assert.equal(describeLoad("back_forward"), "Opened");
  assert.equal(describeLoad(undefined), "Opened");
});

test("a return names how long the page was away", () => {
  assert.equal(describeTimeAway(20 * 1000), "Back after less than a minute");
  assert.equal(describeTimeAway(5 * MINUTE_MS), "Back after 5 min");
  assert.equal(describeTimeAway(135 * MINUTE_MS), "Back after 2 h 15 min");
});

test("copied records list each open, newest first, with its steps and any dip", () =>
  checkInTimeZone(EASTERN, () => {
    const now = new Date("2026-10-03T23:00:00Z");
    const records = [
      {
        at: Date.parse("2026-10-03T22:42:00Z"),
        how: "Back after 12 min",
        tab: "Bracket",
        lines: [
          { ms: 0, text: "Shows stamp 40/18px" },
          { ms: 120, text: "stamp: text 40 to 0", isDip: true },
        ],
      },
      { at: Date.parse("2026-10-02T18:15:00Z"), how: "Opened", tab: "", lines: [] },
    ];

    assert.equal(
      normalizeSpaces(writeRecordsAsText(records, now)),
      [
        "Today 6:42 PM, Back after 12 min, Bracket (dip)",
        "+0 Shows stamp 40/18px",
        "+120 stamp: text 40 to 0",
        "",
        "Yesterday 2:15 PM, Opened",
      ].join("\n"),
    );
  }));
