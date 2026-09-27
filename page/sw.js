// Shows the Worker's push messages, and opens the page when one is tapped. Every push shows a
// notification, because iOS stops delivering to a page whose pushes show nothing.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function readMessage(data) {
  try {
    return data ? data.json() : {};
  } catch {
    return {};
  }
}

self.addEventListener("push", (event) => {
  const message = readMessage(event.data);
  event.waitUntil(
    self.registration.showNotification(message.title || "MLB Postseason", {
      body: message.body || "",
      tag: message.tag,
      icon: "icon-180.png",
    }),
  );
});

async function openPage() {
  const scope = self.registration.scope;
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows.find((client) => client.url.startsWith(scope));
  return open ? open.focus() : self.clients.openWindow(scope);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openPage());
});
