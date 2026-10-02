const MAX_NOTIFIED = 4;

/**
 * Past a few at once, the rest are summed up in one, so a busy night doesn't bury the phone.
 * The summary's tag is its first hidden message's, so a later summary doesn't replace it.
 * @param {{ title: string, body: string, tag: string }[]} messages
 * @param {(count: number) => string} describeMore the summary's title for `count` more
 */
export function capNotifications(messages, describeMore) {
  if (messages.length <= MAX_NOTIFIED) return messages;
  const shown = messages.slice(0, MAX_NOTIFIED - 1);
  const hidden = messages.slice(shown.length);
  return [
    ...shown,
    {
      title: describeMore(hidden.length),
      body: "Open the page to see them all.",
      tag: `more:${hidden[0].tag}`,
    },
  ];
}
