// A dialog shown as a sheet, from the bottom on phones and as a modal on wider screens. It opens
// at its top, shows a line under its pinned .sheet-top once its content has scrolled under it, and
// closes with its Done button, a click on its backdrop, Escape, or on phones a swipe down.

import { closeOnSwipeDown, closeSheet } from "./sheet-swipe.js";

/** @param {HTMLDialogElement} dialog */
function markScrolled(dialog) {
  dialog.querySelector(".sheet-top").classList.toggle("scrolled", dialog.scrollTop > 0);
}

// A click on the backdrop lands on the dialog itself; its content fills it edge to edge.
/** @param {MouseEvent} event */
function closeOnBackdropClick(event) {
  const dialog = /** @type {HTMLDialogElement} */ (event.currentTarget);
  if (event.target === dialog) closeSheet(dialog);
}

/**
 * Shows a sheet, or keeps it showing, scrolled back to its top.
 * @param {HTMLDialogElement} dialog
 */
export function openSheet(dialog) {
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  markScrolled(dialog);
}

/**
 * Wires a sheet's ways to close and the line under its pinned top. A touch that starts on a
 * target `isOwnGesture` claims, like a drag handle or a picker, never moves the sheet.
 * @param {HTMLDialogElement} dialog
 * @param {{ doneButton: HTMLElement, isOwnGesture?: (target: EventTarget) => boolean }} parts
 */
export function wireSheet(dialog, { doneButton, isOwnGesture }) {
  doneButton.addEventListener("click", () => closeSheet(dialog));
  dialog.addEventListener("click", closeOnBackdropClick);
  dialog.addEventListener("scroll", () => markScrolled(dialog));
  closeOnSwipeDown(dialog, isOwnGesture);
}
