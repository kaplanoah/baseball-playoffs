// The settings panel's notifications switch: subscribes this device to the Worker's pushes. A note
// shows under it only when the switch can't do its job.
import { reloadWhenSignedOut } from "./access.js";

const NOTES = {
  blockedOnIos:
    "Notifications are blocked for this page. Turn them on in Settings > Notifications.",
  blockedInBrowser:
    "Notifications are blocked for this page. Turn them on in the browser's site settings, from the icon beside the address.",
  homeScreen:
    "To get notifications on an iPhone, add this page to your Home Screen and open it from there.",
  unsupported: "This browser can't show notifications.",
  failed: "Couldn't change notifications. Try again in a moment.",
};

const SWITCHABLE = new Set(["off", "on", "failed"]);

let registration = null;
let subscription = null;
let status = "loading";
let note = "";
let isBusy = false;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

const isStandalone = () =>
  matchMedia("(display-mode: standalone)").matches ||
  /** @type {{ standalone?: boolean }} */ (navigator).standalone === true;

const canPush = () =>
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

// iOS keeps a Home Screen page's permission in its Settings app; other browsers keep it per site.
function describeStatus() {
  if (status === "blocked") return isIos() ? NOTES.blockedOnIos : NOTES.blockedInBrowser;
  return NOTES[status] ?? "";
}

function renderNotifications() {
  const toggle = findElement("notifySwitch");
  const isOn = status === "on";
  toggle.hidden = !SWITCHABLE.has(status) && status !== "blocked";
  toggle.setAttribute("aria-checked", String(isOn));
  /** @type {HTMLButtonElement} */ (toggle).disabled = isBusy || status === "blocked";
  findElement("notifyNote").textContent = note || describeStatus();
  findElement("notifyRow").hidden = status === "loading";
}

function setStatus(next, message = "") {
  status = next;
  note = message;
  renderNotifications();
}

function decodeBase64Url(text) {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeBase64Url(buffer) {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function requestPush(path, init = {}) {
  const response = await fetch(new URL(path, location.href), { cache: "no-store", ...init });
  reloadWhenSignedOut(response);
  if (!response.ok) throw new Error(`The Worker answered ${response.status}`);
  return response.status === 204 ? null : response.json();
}

const sendEndpoint = (method, endpoint) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ endpoint }),
});

async function fetchPublicKey() {
  const { publicKey } = await requestPush("push/key");
  return publicKey;
}

async function saveSubscription(current) {
  await requestPush("push/subscription", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(current.toJSON()),
  });
}

async function subscribe(publicKey) {
  subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(publicKey),
  });
  await saveSubscription(subscription);
}

// Saving again on every visit restores a subscription the Worker lost, and a new signing key
// needs a new subscription.
async function syncSubscription() {
  const publicKey = await fetchPublicKey();
  const subscribedKey = subscription.options.applicationServerKey;
  if (subscribedKey && encodeBase64Url(subscribedKey) !== publicKey) {
    await subscription.unsubscribe();
    await subscribe(publicKey);
    return;
  }
  await saveSubscription(subscription);
}

async function showBusyDuring(task) {
  isBusy = true;
  renderNotifications();
  try {
    await task();
  } finally {
    isBusy = false;
    renderNotifications();
  }
}

// iOS asks for permission only from a tap, so the request comes before anything is awaited.
async function turnOn() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    setStatus(permission === "denied" ? "blocked" : "off");
    return;
  }
  try {
    await subscribe(await fetchPublicKey());
    setStatus("on");
  } catch {
    setStatus("failed");
  }
}

async function turnOff() {
  try {
    await requestPush("push/subscription", sendEndpoint("DELETE", subscription.endpoint));
    await subscription.unsubscribe();
    subscription = null;
    setStatus("off");
  } catch {
    setStatus("on", NOTES.failed);
  }
}

function toggleNotifications() {
  if (isBusy) return;
  showBusyDuring(status === "on" ? turnOff : turnOn);
}

function describeStartStatus() {
  if (Notification.permission === "denied") return "blocked";
  return subscription && Notification.permission === "granted" ? "on" : "off";
}

export async function startNotifications() {
  findElement("notifySwitch").addEventListener("click", toggleNotifications);
  if (!canPush()) {
    setStatus(isIos() && !isStandalone() ? "homeScreen" : "unsupported");
    return;
  }
  try {
    registration = await navigator.serviceWorker.register("sw.js");
    subscription = await registration.pushManager.getSubscription();
  } catch {
    setStatus("unsupported");
    return;
  }
  setStatus(describeStartStatus());
  // A sync that fails is tried again on the next visit.
  if (status === "on") syncSubscription().catch(() => {});
}
