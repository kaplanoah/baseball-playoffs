// Longer than the Worker's two rounds of MLB requests, the season's dates and then the rest.
const FETCH_TIMEOUT_MS = 20 * 1000;

class LiveError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// The Worker that serves the page also reads MLB for it.
export async function fetchLive(season) {
  const response = await fetch(new URL(`snapshot?season=${season}`, location.href), {
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new LiveError("upstream_error", body?.error || `The Worker answered ${response.status}`);
  if (!body || body.version !== 1 || body.season !== season)
    throw new LiveError("bad_payload", "unexpected answer");
  return body;
}
