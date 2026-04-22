const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_CLIENT_HOST = "127.0.0.1";
const DEFAULT_SERVER_PORT = 2567;
const DEFAULT_CLIENT_PORT = 4173;

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const SERVER_HOST = process.env.VEIL_PLAYWRIGHT_SERVER_HOST?.trim() || DEFAULT_SERVER_HOST;
export const CLIENT_HOST = process.env.VEIL_PLAYWRIGHT_CLIENT_HOST?.trim() || DEFAULT_CLIENT_HOST;
export const SERVER_PORT = readPort(process.env.VEIL_PLAYWRIGHT_SERVER_PORT, DEFAULT_SERVER_PORT);
export const CLIENT_PORT = readPort(process.env.VEIL_PLAYWRIGHT_CLIENT_PORT, DEFAULT_CLIENT_PORT);

export const SERVER_BASE_URL =
  process.env.VEIL_PLAYWRIGHT_SERVER_ORIGIN?.trim() || `http://${SERVER_HOST}:${SERVER_PORT}`;
export const SERVER_WS_URL =
  process.env.VEIL_PLAYWRIGHT_SERVER_WS_URL?.trim() || `ws://${SERVER_HOST}:${SERVER_PORT}`;
export const CLIENT_BASE_URL =
  process.env.VEIL_PLAYWRIGHT_CLIENT_ORIGIN?.trim() || `http://${CLIENT_HOST}:${CLIENT_PORT}`;
export const ADMIN_BASE_URL = `${SERVER_BASE_URL}/admin`;
export const ANALYTICS_CAPTURE_ENDPOINT = `${SERVER_BASE_URL}/api/test/analytics/events`;
export const RESET_ENDPOINT = `${SERVER_BASE_URL}/api/test/reset-store`;
export const SERVER_DIAGNOSTICS_URL = `${SERVER_BASE_URL}/api/runtime/diagnostic-snapshot?format=text`;
