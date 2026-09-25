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
