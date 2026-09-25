import { Markup } from "../page/js/html.js";

const readText = (value) => (value instanceof Markup ? value.text : value);

// toLocaleTimeString puts a narrow no-break space (U+202F) before AM/PM.
export const normalizeSpaces = (value) => {
  const text = readText(value);
  return typeof text === "string" ? text.replace(/\u202f/g, " ") : text;
};

export const stripTags = (value) => readText(value).replace(/<[^>]+>/g, "");
