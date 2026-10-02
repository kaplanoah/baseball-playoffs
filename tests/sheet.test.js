import { test } from "node:test";
import assert from "node:assert/strict";
import { openSheet, wireSheet } from "../shared/page/sheet.js";

// A stand-in for a dialog on a wide screen, where a sheet closes at once instead of sliding down.
function createDialog() {
  globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
  const dialog = Object.assign(new EventTarget(), {
    open: false,
    scrollTop: 0,
    timesShown: 0,
    showModal() {
      dialog.open = true;
      dialog.timesShown += 1;
    },
    close() {
      dialog.open = false;
    },
  });
  const doneButton = new EventTarget();
  wireSheet(/** @type {any} */ (dialog), { doneButton: /** @type {any} */ (doneButton) });
  return { dialog, doneButton };
}

test("a sheet opens at its top, and opening it again keeps it open there", () => {
  const { dialog } = createDialog();

  openSheet(/** @type {any} */ (dialog));
  dialog.scrollTop = 300;
  openSheet(/** @type {any} */ (dialog));
  assert.equal(dialog.open, true);
  assert.equal(dialog.timesShown, 1);
  assert.equal(dialog.scrollTop, 0);
});

test("Done and a click on the backdrop close the sheet", () => {
  const { dialog, doneButton } = createDialog();

  openSheet(/** @type {any} */ (dialog));
  doneButton.dispatchEvent(new Event("click"));
  assert.equal(dialog.open, false);
  openSheet(/** @type {any} */ (dialog));
  dialog.dispatchEvent(new Event("click"));
  assert.equal(dialog.open, false);
});

// A stand-in for a sheet on a phone, which a swipe down moves and closes.
function createPhoneSheet() {
  globalThis.matchMedia = /** @type {any} */ ((query) => ({ matches: query.includes("width") }));
  const dialog = Object.assign(new EventTarget(), {
    open: true,
    scrollTop: 0,
    style: { transform: "" },
    animate() {
      /** @type {{ cancel: () => void, finished?: Promise<unknown> }} */
      const motion = { cancel() {} };
      motion.finished = Promise.resolve(motion);
      return motion;
    },
    close() {
      dialog.open = false;
    },
  });
  wireSheet(/** @type {any} */ (dialog), { doneButton: /** @type {any} */ (new EventTarget()) });
  /** @param {string} type @param {number} [clientY] */
  const touch = (type, clientY) => {
    const touches = clientY === undefined ? [] : [{ clientY }];
    dialog.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { touches }));
  };
  return { dialog, touch };
}

test("on a phone, a swipe down that scrolls the sheet back to its top goes on to move the sheet and close it", async () => {
  const { dialog, touch } = createPhoneSheet();
  dialog.scrollTop = 300;

  touch("touchstart", 100);
  touch("touchmove", 200);
  assert.equal(dialog.style.transform, "");
  dialog.scrollTop = 0;
  touch("touchmove", 230);
  assert.equal(dialog.style.transform, "translateY(30px)");
  touch("touchmove", 400);
  touch("touchend");
  await new Promise((resolve) => setTimeout(resolve));
  assert.equal(dialog.open, false);
});

test("on a phone, a swipe at the sheet's top that goes up first moves the sheet from its highest point", () => {
  const { dialog, touch } = createPhoneSheet();

  touch("touchstart", 300);
  touch("touchmove", 260);
  assert.equal(dialog.style.transform, "");
  touch("touchmove", 310);
  assert.equal(dialog.style.transform, "translateY(50px)");
});
