// The store hands documents back with their keys sorted, so key order must not count as a change.
function serializeCanonically(value) {
  if (Array.isArray(value)) return `[${value.map(serializeCanonically).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${serializeCanonically(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

export const sameJson = (first, second) =>
  serializeCanonically(first) === serializeCanonically(second);
