import { LIVE_SERVER } from "./live-fetch.js";

const SETTINGS = "claude.ai's connector settings";
const NOT_IN_VIEW = "Live scores aren't available in this view.";
const TRY_AGAIN = "Couldn't reach live scores. Trying again shortly.";

// `retry` waits and tries again; otherwise the fix is elsewhere. `retract` drops shown live data.
const LIVE_ERRORS = {
  server_not_connected: {
    message: `Live scores need the ${LIVE_SERVER} connector: add it in ${SETTINGS}.`,
    retry: false,
    retract: true,
  },
  needs_reauth: {
    message: `Reconnect ${LIVE_SERVER} in ${SETTINGS} for live scores.`,
    retry: false,
    retract: true,
  },
  selection_required: {
    message: `Choose which ${LIVE_SERVER} connector this page should use.`,
    retry: false,
    retract: false,
  },
  not_in_manifest: {
    message: "Live scores are turned off for this page. Reload to be asked again.",
    retry: false,
    retract: true,
  },
  blocked_by_policy: {
    message: `Your organization doesn't allow ${LIVE_SERVER} here.`,
    retry: false,
    retract: true,
  },
  approval_required: {
    message: `Your organization requires approval for ${LIVE_SERVER}.`,
    retry: false,
    retract: true,
  },
  no_mcp: { message: NOT_IN_VIEW, retry: false, retract: false },
  not_granted: { message: NOT_IN_VIEW, retry: false, retract: false },
  capability_disabled: { message: NOT_IN_VIEW, retry: false, retract: false },
  bad_payload: {
    message: `${LIVE_SERVER} answered with something unexpected. Is it up to date?`,
    retry: false,
    retract: false,
  },
  bad_request: { message: TRY_AGAIN, retry: false, retract: false },
};

export function describeLiveError(error) {
  const code = (error && error.code) || "upstream_error";
  const reason = String((error && error.message) || "");
  const known = LIVE_ERRORS[code];
  const message =
    code === "tool_error"
      ? `MLB didn't answer (${reason || "no reason given"}). Trying again shortly.`
      : (known && known.message) || TRY_AGAIN;
  return {
    code,
    message,
    retry: known ? known.retry : true,
    retract: known ? known.retract : false,
    detail: reason.slice(0, 200),
  };
}
