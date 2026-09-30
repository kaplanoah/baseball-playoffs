const TRY_AGAIN = "Couldn't reach live scores. Trying again shortly.";

// `retry` waits and tries again; otherwise the fix is elsewhere.
const LIVE_ERRORS = {
  bad_payload: {
    message:
      "Live scores came back in a form this page doesn't know. It updates itself once a newer version is out.",
    retry: false,
  },
};

export function describeLiveError(error) {
  const code = (error && error.code) || "upstream_error";
  const known = LIVE_ERRORS[code];
  return {
    code,
    message: (known && known.message) || TRY_AGAIN,
    retry: known ? known.retry : true,
  };
}
