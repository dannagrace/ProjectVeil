export type ReconnectFailureReason =
  | "timeout"
  | "auth_invalid"
  | "version_mismatch"
  | "transport_lost"
  | "reconnect_window_expired"
  | "unknown";

interface ClassifyReconnectFailureInput {
  error?: unknown;
  rawCode?: number | null;
  rawReason?: string | null;
  fallbackReason?: ReconnectFailureReason;
}

function normalizeReconnectFailureText(input: ClassifyReconnectFailureInput): string {
  const parts: string[] = [];

  if (typeof input.rawCode === "number" && Number.isFinite(input.rawCode)) {
    parts.push(String(input.rawCode));
  }

  if (typeof input.rawReason === "string" && input.rawReason.trim().length > 0) {
    parts.push(input.rawReason);
  }

  if (input.error instanceof Error && input.error.message.trim().length > 0) {
    parts.push(input.error.message);
  } else if (typeof input.error === "string" && input.error.trim().length > 0) {
    parts.push(input.error);
  }

  return parts.join(" ").toLowerCase();
}

export function classifyReconnectFailure(input: ClassifyReconnectFailureInput): ReconnectFailureReason {
  const normalized = normalizeReconnectFailureText(input);

  if (
    normalized.includes("version_mismatch") ||
    normalized.includes("version mismatch") ||
    normalized.includes("protocol mismatch") ||
    normalized.includes("schema mismatch")
  ) {
    return "version_mismatch";
  }

  if (
    normalized.includes("token_expired") ||
    normalized.includes("session_revoked") ||
    normalized.includes("account_banned") ||
    normalized.includes("unauthorized") ||
    normalized.includes("invalid_session") ||
    normalized.includes("invalid session") ||
    normalized.includes("invalid token") ||
    normalized.includes("auth_invalid") ||
    normalized.includes("authentication failed") ||
    normalized.includes("401") ||
    normalized.includes("403")
  ) {
    return "auth_invalid";
  }

  if (
    normalized.includes("reconnect_window_expired") ||
    normalized.includes("reconnect window expired")
  ) {
    return "reconnect_window_expired";
  }

  if (
    normalized.includes("connect_timeout") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out")
  ) {
    return "timeout";
  }

  if (
    normalized.includes("transport") ||
    normalized.includes("network") ||
    normalized.includes("socket") ||
    normalized.includes("ws closed") ||
    normalized.includes("websocket") ||
    normalized.includes("failed_to_reconnect") ||
    normalized.includes("room_left") ||
    normalized.includes("connection closed") ||
    normalized.includes("disconnect")
  ) {
    return "transport_lost";
  }

  return input.fallbackReason ?? "unknown";
}
