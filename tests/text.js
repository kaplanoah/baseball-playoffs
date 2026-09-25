// toLocaleTimeString puts a narrow no-break space (U+202F) before AM/PM.
export const normalizeSpaces = (text) =>
  typeof text === "string" ? text.replace(/\u202f/g, " ") : text;

export const stripTags = (html) => html.replace(/<[^>]+>/g, "");
