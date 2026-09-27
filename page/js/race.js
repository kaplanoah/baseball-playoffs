import { session } from "./session.js";

const isAhead = (gamesBack) => gamesBack === "-" || String(gamesBack).startsWith("+");

/**
 * @param {{ gb?: string, wcgb?: string, elim?: string, wce?: string, magic?: string | null,
 *   clinch?: string | null, clinched?: boolean, lead?: boolean, wcrank?: string | null } | null} row
 * @returns {{ label: string | null, standing: "clinched" | "racing" | "out" } | null}
 */
export function describeRace(row) {
  if (!row || !row.gb) return null;
  if (row.clinched) return { label: row.clinch === "z" ? "Bye" : "Div", standing: "clinched" };
  if (row.clinch === "w") return { label: `WC${row.wcrank}`, standing: "clinched" };
  if (row.lead) return { label: row.magic ? `M#${row.magic}` : "1st", standing: "racing" };
  if (row.clinch) return { label: "In", standing: "clinched" };
  if (row.elim !== "E") {
    return { label: row.gb === "-" ? "Tied" : `${row.gb} GB`, standing: "racing" };
  }
  if (row.wce !== "E") {
    const label = isAhead(row.wcgb) ? `WC${row.wcrank}` : `${row.wcgb} WC`;
    return { label, standing: "racing" };
  }
  return { label: null, standing: "out" };
}

export function findStandingsRow(id) {
  const divisions = (session.standings && session.standings.divisions) || {};
  return Object.values(divisions)
    .flat()
    .find((row) => row.id === id);
}
