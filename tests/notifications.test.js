import test from "node:test";
import assert from "node:assert/strict";
import { capNotifications } from "../shared/worker/notifications.js";

const listMessages = (count) =>
  Array.from({ length: count }, (_, index) => ({
    title: `Update ${index + 1}`,
    body: "",
    tag: `update:${index + 1}`,
  }));

const describeMore = (count) => `${count} more updates`;

test("a few notifications at once all go out", () => {
  const messages = listMessages(4);
  assert.deepEqual(capNotifications(messages, describeMore), messages);
});

test("past a few at once, the rest are summed up in one tagged by the first it hides", () => {
  const capped = capNotifications(listMessages(6), describeMore);

  assert.deepEqual(capped.slice(0, 3), listMessages(3));
  assert.deepEqual(capped[3], {
    title: "3 more updates",
    body: "Open the page to see them all.",
    tag: "more:update:4",
  });
  assert.equal(capped.length, 4);
});
