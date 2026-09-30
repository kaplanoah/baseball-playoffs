import test from "node:test";
import assert from "node:assert/strict";
import { listShownPitches, namePitch, renderPitchColumns } from "../page/js/pitch-columns.js";

const pitch = (code, share, mph, name = code) => ({ code, name, share, mph });

test("the columns run slowest to fastest, without pitches thrown under 2% of the time", () => {
  const shown = listShownPitches([
    pitch("FF", 0.44, 98.0),
    pitch("CU", 0.1, 86.3),
    pitch("SL", 0.01, 89.6),
    pitch("FC", 0.26, 94.6),
    pitch("SI", 0.19, 97.8),
  ]);
  assert.deepEqual(
    shown.map((shownPitch) => shownPitch.code),
    ["CU", "FC", "SI", "FF"],
  );
});

test("a pitcher with more than seven pitches shows his seven most-thrown", () => {
  const codes = ["FF", "SI", "FC", "SL", "ST", "CU", "CH", "FS"];
  const pitches = codes.map((code, index) => pitch(code, 0.2 - index * 0.02, 80 + index));
  assert.deepEqual(
    listShownPitches(pitches).map((shownPitch) => shownPitch.code),
    codes.slice(0, 7),
  );
});

test("pitches get short names, and one MLB adds later keeps MLB's", () => {
  assert.equal(namePitch(pitch("FF", 0.4, 95, "Four-seam FB")), "Four-seam");
  assert.equal(namePitch(pitch("KC", 0.2, 82, "Knuckle Curve")), "Knuckle curve");
  assert.equal(namePitch(pitch("XX", 0.2, 82, "Gyroball")), "Gyroball");
});

test("a pitch at nearly the speed of a more-thrown one sits above the line", () => {
  const svg = String(
    renderPitchColumns(
      [pitch("FF", 0.44, 98.0), pitch("SI", 0.19, 97.8), pitch("CU", 0.1, 86.3)],
      "Schlittler",
    ),
  );
  const readDotY = (code) =>
    Number(new RegExp(`pitch-dot pitch-${code}" cx="[\\d.]+" cy="([\\d.-]+)"`).exec(svg)[1]);
  assert.equal(readDotY("FF"), 22);
  assert.equal(readDotY("CU"), 22);
  assert.equal(readDotY("SI"), 10);
  assert.match(svg, /class="pitch-stem"/);
});

test("a two-word pitch name takes two lines, and each column shows its share and speed", () => {
  const svg = String(renderPitchColumns([pitch("KC", 0.31, 81.6), pitch("FF", 0.5, 94.2)], "Cole"));
  assert.match(svg, />Knuckle<\/tspan><tspan [^>]*dy="12">curve</);
  assert.match(svg, />31%</);
  assert.match(svg, />82 mph</);
  assert.match(svg, /aria-label="Cole&#39;s pitches from slowest to fastest/);
});

test("a pitcher with no pitches tracked shows no chart", () => {
  assert.equal(String(renderPitchColumns([], "Nobody")), "");
});
