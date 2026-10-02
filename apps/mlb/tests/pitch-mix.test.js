import test from "node:test";
import assert from "node:assert/strict";
import { listShownPitches, namePitch, renderPitchMix } from "../page/js/pitch-mix.js";

const pitch = (code, share, mph, name = code) => ({ code, name, share, mph });

test("the pitches run slowest to fastest, without ones thrown under 2% of the time", () => {
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

test("pitches at nearly the same speed sit side by side on the line, slowest first", () => {
  const svg = String(
    renderPitchMix([pitch("FF", 0.44, 98.0), pitch("SI", 0.19, 97.8), pitch("CU", 0.1, 86.3)]),
  );
  const readDot = (code) => {
    const [, x, y] = new RegExp(`pitch-dot pitch-${code}" cx="([\\d.]+)" cy="([\\d.]+)"`).exec(svg);
    return { x: Number(x), y: Number(y) };
  };
  const [sinker, fourSeam, curve] = ["SI", "FF", "CU"].map(readDot);
  assert.deepEqual([sinker.y, fourSeam.y, curve.y], [8, 8, 8]);
  assert.equal(Number((fourSeam.x - sinker.x).toFixed(1)), 12);
  assert.ok(curve.x < sinker.x - 12);
  assert.doesNotMatch(svg, /pitch-stem/);
});

test("the speed line is labeled every 10 mph, with the unit on the slowest", () => {
  const labels = (pitches) =>
    [...String(renderPitchMix(pitches)).matchAll(/class="speed-label[^"]*"[^>]*>([^<]+)</g)].map(
      (match) => match[1],
    );
  assert.deepEqual(labels([pitch("FF", 0.5, 94.2)]), ["70 mph", "80", "90", "100"]);
  assert.deepEqual(labels([pitch("EP", 0.1, 58.0), pitch("FF", 0.5, 101.2)]), [
    "50 mph",
    "60",
    "70",
    "80",
    "90",
    "100",
    "110",
  ]);
});

test("each pitch gets a row with its dot, name, share, and speed", () => {
  const markup = String(renderPitchMix([pitch("KC", 0.31, 81.6), pitch("FF", 0.5, 94.2)]));
  const rows = [...markup.matchAll(/<li class="pitch-(\w+)">([\s\S]*?)<\/li>/g)].map(
    ([, code, row]) => ({
      code,
      hasDot: row.includes('class="pitch-key"'),
      text: row
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    }),
  );
  assert.deepEqual(rows, [
    { code: "KC", hasDot: true, text: "Knuckle curve 31% 82 mph" },
    { code: "FF", hasDot: true, text: "Four-seam 50% 94 mph" },
  ]);
  assert.doesNotMatch(markup, /pitch-bar/);
});

test("the bar over the line splits by how often he throws each pitch, slowest first", () => {
  const markup = String(
    renderPitchMix([pitch("FF", 0.44, 98.0), pitch("CU", 0.1, 86.3), pitch("FC", 0.26, 94.6)]),
  );
  const [usage] = /<div class="pitch-usage"[\s\S]*?<\/div>/.exec(markup) ?? [""];
  const slices = [...usage.matchAll(/class="pitch-(\w+)" style="flex-grow: ([\d.]+)"/g)].map(
    ([, code, share]) => [code, Number(share)],
  );
  assert.deepEqual(slices, [
    ["CU", 0.1],
    ["FC", 0.26],
    ["FF", 0.44],
  ]);
  assert.ok(markup.indexOf("pitch-usage") < markup.indexOf("speed-line"));
});

test("a pitcher with no pitches tracked shows no chart", () => {
  assert.equal(String(renderPitchMix([])), "");
});
