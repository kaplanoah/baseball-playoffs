import test from "node:test";
import assert from "node:assert/strict";
import { describeStyle } from "../page/js/scouting.js";

const rank = (value, of = 141) => ({ rank: value, of });

test("a top-ten rank is named exactly, and the noun comes once", () => {
  const style = describeStyle({
    line: { era: "1.95" },
    ranks: { era: rank(2), k9: rank(6), bb9: rank(26), speed: rank(6) },
  });
  assert.equal(
    style,
    "Throws harder than all but five starters, strikes out more hitters than all but five, and " +
      "walks fewer hitters than most. His 1.95 ERA ranks 2nd of 141.",
  );
});

test("the top or bottom quarter reads as most, and the middle half goes unsaid", () => {
  const style = describeStyle({
    line: { era: "3.91" },
    ranks: { era: rank(67), k9: rank(121), bb9: rank(54), speed: rank(108) },
  });
  assert.equal(
    style,
    "Throws softer than most starters and strikes out fewer hitters than most. " +
      "His 3.91 ERA ranks 67th of 141.",
  );
});

test("the very best and the very worst read as any", () => {
  const style = describeStyle({
    line: { era: "5.80" },
    ranks: { era: rank(141), k9: rank(1), bb9: rank(141), speed: rank(70) },
  });
  assert.equal(
    style,
    "Strikes out more hitters than any starter and walks more hitters than any. " +
      "His 5.80 ERA ranks 141st of 141.",
  );
});

test("three standouts are listed with commas", () => {
  const style = describeStyle({
    line: { era: "2.10" },
    ranks: { era: rank(3), k9: rank(12), bb9: rank(20), speed: rank(30) },
  });
  assert.equal(
    style,
    "Throws harder than most starters, strikes out more hitters than most, and walks fewer " +
      "hitters than most. His 2.10 ERA ranks 3rd of 141.",
  );
});

test("a pitcher with nothing standing out gets only his ERA", () => {
  const style = describeStyle({
    line: { era: "4.02" },
    ranks: { era: rank(80), k9: rank(70), bb9: rank(60), speed: null },
  });
  assert.equal(style, "His 4.02 ERA ranks 80th of 141.");
});

test("a pitcher too new to rank, or yet to pitch, says so", () => {
  assert.equal(
    describeStyle({ line: { era: "0.90" }, ranks: null }),
    "Too few starts this season to rank among starters. His ERA is 0.90.",
  );
  assert.equal(
    describeStyle({ line: null, ranks: null }),
    "Hasn't pitched in the majors this season.",
  );
});
