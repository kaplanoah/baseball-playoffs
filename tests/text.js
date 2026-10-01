import { Markup } from "../shared/page/html.js";

const readText = (value) => (value instanceof Markup ? value.text : value);

// toLocaleTimeString puts a narrow no-break space (U+202F) before AM/PM.
export const normalizeSpaces = (value) => {
  const text = readText(value);
  return typeof text === "string" ? text.replace(/\u202f/g, " ") : text;
};

export const stripTags = (value) => readText(value).replace(/<[^>]+>/g, "");

// A stamp's markup as it reads: its AM/PM is set apart by a margin, which reads as a space.
export const readStampText = (value) =>
  stripTags(normalizeSpaces(value).replace(/<span class="ap">/g, " "))
    .replace(/&mdash;/g, "\u2014")
    .replace(/&amp;/g, "&");
