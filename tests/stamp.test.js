import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeFinishedDay,
  formatStampWhen,
  renderStampLine,
  renderStampWhen,
} from "../shared/page/stamp.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

// Noon Eastern on Thursday, September 24.
const NOON = new Date("2026-09-24T16:00:00Z");

const inEastern = (check) => checkInTimeZone(EASTERN, check);

test("the day words beside a time", () =>
  inEastern(() => {
    const describeWhen = (iso) => normalizeSpaces(formatStampWhen(new Date(iso), NOON));
    assert.equal(describeWhen("2026-09-24T17:15:00Z"), "1:15 PM");
    assert.equal(describeWhen("2026-09-23T17:15:00Z"), "yesterday 1:15 PM");
    assert.equal(describeWhen("2026-09-25T17:15:00Z"), "tomorrow 1:15 PM");
    assert.equal(describeWhen("2026-09-27T17:15:00Z"), "Sunday 1:15 PM");
    assert.equal(describeWhen("2026-09-29T17:15:00Z"), "Tuesday 1:15 PM");
    assert.equal(describeWhen("2026-10-05T17:15:00Z"), "Oct 5 1:15 PM");
  }));

test("the time as markup sets its AM/PM apart and leaves the rest alone", () =>
  inEastern(() => {
    const renderHtml = (iso) => normalizeSpaces(renderStampWhen(new Date(iso), NOON).text);
    assert.equal(renderHtml("2026-09-25T02:19:00Z"), '10:19<span class="ap">PM</span>');
    assert.equal(renderHtml("2026-09-25T17:08:00Z"), 'tomorrow 1:08<span class="ap">PM</span>');
  }));

test("a finished game names the day it ended, and the weekday or date it was played", () =>
  inEastern(() => {
    const describeDay = (endIso, playedIso = endIso) =>
      describeFinishedDay(new Date(endIso), new Date(playedIso), NOON);
    assert.equal(describeDay("2026-09-24T05:30:00Z", "2026-09-24T01:40:00Z"), "today");
    assert.equal(describeDay("2026-09-24T01:00:00Z"), "yesterday");
    assert.equal(describeDay("2026-09-23T20:00:00Z"), "yesterday");
    assert.equal(describeDay("2026-09-24T15:00:00Z"), "today");
    assert.equal(describeDay("2026-09-21T23:00:00Z"), "Monday");
    assert.equal(describeDay("2026-09-22T05:00:00Z", "2026-09-22T01:00:00Z"), "Monday");
    assert.equal(describeDay("2026-09-14T23:00:00Z"), "Sep 14");
  }));

test("a stamp line sets its time in bold, with what it's about after a dash", () => {
  assert.equal(
    renderStampLine("Next tip-off", "9:00 PM", "Fever @ Aces").text,
    "<span>Next tip-off <b>9:00 PM</b> &mdash; Fever @ Aces</span>",
  );
  assert.equal(renderStampLine("Saved", "9:00 PM").text, "<span>Saved <b>9:00 PM</b></span>");
});
