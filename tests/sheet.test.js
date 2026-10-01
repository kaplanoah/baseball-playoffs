import { test } from "node:test";
import assert from "node:assert/strict";
import { openSheet, wireSheet } from "../shared/page/sheet.js";

// A stand-in for a dialog on a wide screen, where a sheet closes at once instead of sliding down.
function createDialog() {
  globalThis.matchMedia = /** @type {any} */ (() => ({ matches: false }));
  const top = new Set();
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
    querySelector: () => ({
      classList: { toggle: (name, isOn) => (isOn ? top.add(name) : top.delete(name)) },
    }),
  });
  const doneButton = new EventTarget();
  wireSheet(/** @type {any} */ (dialog), { doneButton: /** @type {any} */ (doneButton) });
  return { dialog, doneButton, isTopScrolled: () => top.has("scrolled") };
}

test("a sheet opens at its top, and opening it again keeps it open there", () => {
  const { dialog, isTopScrolled } = createDialog();

  openSheet(/** @type {any} */ (dialog));
  dialog.scrollTop = 300;
  dialog.dispatchEvent(new Event("scroll"));
  assert.equal(isTopScrolled(), true);
  openSheet(/** @type {any} */ (dialog));
  assert.equal(dialog.open, true);
  assert.equal(dialog.timesShown, 1);
  assert.equal(dialog.scrollTop, 0);
  assert.equal(isTopScrolled(), false);
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
