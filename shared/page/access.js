// A Worker with an access code answers 401 once the phone's code is no longer the one it asks
// for, as when the code changes, and reloading the page shows the Worker's gate.

/** @param {Response} response */
export function reloadWhenSignedOut(response) {
  if (response.status === 401) location.reload();
}
