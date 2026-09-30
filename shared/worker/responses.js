// What the Worker's JSON endpoints answer with.

export const respondJson = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export const respondError = (status, code, message) =>
  respondJson({ error: { code, message } }, status);

export const describeError = (error) => (error instanceof Error ? error.message : String(error));
