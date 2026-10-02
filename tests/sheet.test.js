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
