// A pitcher's style in a sentence, from where he ranks among the season's starters. Only what
// stands out is said: a top or bottom quarter, named exactly when it's a top or bottom ten.

import { formatOrdinal } from "./ordinal.js";

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const EXACT_RANKS = 10;

const CLAUSES = [
  { key: "speed", better: "throws harder", worse: "throws softer" },
  { key: "k9", better: "strikes out more hitters", worse: "strikes out fewer hitters" },
  { key: "bb9", better: "walks fewer hitters", worse: "walks more hitters" },
];

const countInWords = (count) => NUMBER_WORDS[count] ?? String(count);

// How many starters he trails, from the top or the bottom, or null when he's in the middle half.
function describeStanding({ rank, of }) {
  const fromBottom = of - rank + 1;
  if (rank <= of / 4) return { isBetter: true, trailing: rank - 1 };
  if (fromBottom <= of / 4) return { isBetter: false, trailing: fromBottom - 1 };
  return null;
}

// "any starter", "all but five starters", or "most starters"; later clauses drop the noun.
function describeRival(trailing, isFirst) {
  if (trailing === 0) return isFirst ? "any starter" : "any";
  if (trailing < EXACT_RANKS)
    return `all but ${countInWords(trailing)}${isFirst ? " starters" : ""}`;
  return isFirst ? "most starters" : "most";
}

function listStandouts(ranks) {
  return CLAUSES.map((clause) => ({
    clause,
    standing: ranks[clause.key] && describeStanding(ranks[clause.key]),
  }))
    .filter(({ standing }) => standing)
    .map(({ clause, standing }, index) => {
      const verb = standing.isBetter ? clause.better : clause.worse;
      return `${verb} than ${describeRival(standing.trailing, index === 0)}`;
    });
}

function joinClauses(clauses) {
  if (clauses.length <= 2) return clauses.join(" and ");
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses.at(-1)}`;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * @param {{ line: { era: string } | null, ranks: Record<string, { rank: number, of: number } | null> | null }} pitcher
 */
export function describeStyle({ line, ranks }) {
  if (!line) return "Hasn't pitched in the majors this season.";
  if (!ranks) return `Too few starts this season to rank among starters. His ERA is ${line.era}.`;
  const standouts = listStandouts(ranks);
  const era =
    ranks.era && `His ${line.era} ERA ranks ${formatOrdinal(ranks.era.rank)} of ${ranks.era.of}.`;
  return [standouts.length && `${capitalize(joinClauses(standouts))}.`, era]
    .filter(Boolean)
    .join(" ");
}
