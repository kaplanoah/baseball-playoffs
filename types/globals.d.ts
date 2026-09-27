declare const Sortable: {
  create(element: HTMLElement, options: Record<string, unknown>): unknown;
};

// Cloudflare Workers runtime: a Durable Object answers a WebSocket upgrade with one end of a pair.
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface ResponseInit {
  webSocket?: WebSocket;
}
