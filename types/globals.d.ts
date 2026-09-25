declare const Sortable: {
  create(element: HTMLElement, options: Record<string, unknown>): unknown;
};

interface ArtifactHotReload {
  ready(start: () => void): void;
}

interface ArtifactRuntime {
  use(capability: "db" | "mcp"): Promise<any>;
  hot?: ArtifactHotReload;
}

interface Window {
  claude?: ArtifactRuntime;
  __runtime?: any;
  __runtimeConfig?: any;
}

// Cloudflare Workers runtime: a Durable Object answers a WebSocket upgrade with one end of a pair.
declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface ResponseInit {
  webSocket?: WebSocket;
}
