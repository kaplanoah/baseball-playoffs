import test from "node:test";
import assert from "node:assert/strict";
import { runWithTimeout } from "../shared/worker/timeout.js";

const TIMEOUT_MS = 8000;

/** A call that answers only when its signal aborts, and then with the signal's reason. */
const waitForAbort = (signal) =>
  new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason));
  });

test("a call that doesn't answer in time is aborted as a timeout", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let isSettled = false;
  const result = runWithTimeout(TIMEOUT_MS, waitForAbort).finally(() => {
    isSettled = true;
  });

  context.mock.timers.tick(TIMEOUT_MS - 1);
  await Promise.resolve();
  assert.equal(isSettled, false);
  context.mock.timers.tick(1);

  await assert.rejects(result, { name: "TimeoutError" });
});

test("a call that answers, or fails, stops its timer, so nothing is left waiting on it", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const signals = [];
  const answer = await runWithTimeout(TIMEOUT_MS, async (signal) => {
    signals.push(signal);
    return "answer";
  });
  await assert.rejects(
    runWithTimeout(TIMEOUT_MS, async (signal) => {
      signals.push(signal);
      throw new Error("refused");
    }),
    { message: "refused" },
  );

  context.mock.timers.tick(TIMEOUT_MS);

  assert.equal(answer, "answer");
  assert.deepEqual(
    signals.map((signal) => signal.aborted),
    [false, false],
  );
});
