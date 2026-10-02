// Giving up on a call to another service that doesn't answer in time.

/**
 * Asks with a signal that aborts after `timeoutMs`. The timer stops once the asking settles,
 * since one left running keeps a Durable Object's alarm open until it fires.
 * @template Result
 * @param {number} timeoutMs
 * @param {(signal: AbortSignal) => Promise<Result>} ask
 * @returns {Promise<Result>}
 */
export async function abortAfter(timeoutMs, ask) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`No answer in ${timeoutMs} ms`, "TimeoutError")),
    timeoutMs,
  );
  try {
    return await ask(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
