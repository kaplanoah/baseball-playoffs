// Giving up on a call to another service that doesn't answer in time.

/**
 * Runs `run` with a signal that aborts after `timeoutMs`. The timer stops once `run` settles,
 * since one left running keeps a Durable Object's alarm open until it fires.
 * @template Result
 * @param {number} timeoutMs
 * @param {(signal: AbortSignal) => Promise<Result>} run
 * @returns {Promise<Result>}
 */
export async function runWithTimeout(timeoutMs, run) {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException(`No answer in ${timeoutMs} ms`, "TimeoutError")),
    timeoutMs,
  );
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
