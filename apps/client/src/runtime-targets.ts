const DEFAULT_SERVER_HTTP_URL = "http://127.0.0.1:2567";
const DEFAULT_SERVER_WS_URL = "ws://127.0.0.1:2567";

function readRuntimeEnv(key: string): string | undefined {
  const value = (import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveRuntimeServerHttpUrl(): string {
  return readRuntimeEnv("VITE_VEIL_SERVER_HTTP_URL") ?? DEFAULT_SERVER_HTTP_URL;
}

export function resolveRuntimeServerWsUrl(): string {
  return readRuntimeEnv("VITE_VEIL_SERVER_WS_URL") ?? DEFAULT_SERVER_WS_URL;
}
