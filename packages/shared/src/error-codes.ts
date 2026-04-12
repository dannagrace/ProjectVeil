export interface StructuredErrorCodeDefinition {
  code: string;
  surface: "server" | "client";
  featureArea: string;
  ownerArea: string;
  severity: "warn" | "error" | "fatal";
  description: string;
}

export const STRUCTURED_ERROR_CODE_CATALOG = {
  persistence_save_failed: {
    code: "persistence_save_failed",
    surface: "server",
    featureArea: "runtime",
    ownerArea: "multiplayer",
    severity: "error",
    description: "Authoritative room state could not be persisted and the action was rolled back."
  },
  auth_invalid: {
    code: "auth_invalid",
    surface: "server",
    featureArea: "login",
    ownerArea: "auth",
    severity: "warn",
    description: "Session or player authentication was rejected as invalid, expired, or revoked."
  },
  config_hotload_failed: {
    code: "config_hotload_failed",
    surface: "server",
    featureArea: "runtime",
    ownerArea: "config",
    severity: "error",
    description: "Runtime config hot reload triggered an error spike and was rolled back."
  },
  uncaught_exception: {
    code: "uncaught_exception",
    surface: "server",
    featureArea: "runtime",
    ownerArea: "ops",
    severity: "fatal",
    description: "A process-level uncaught exception forced the server to shut down."
  },
  unhandled_rejection: {
    code: "unhandled_rejection",
    surface: "server",
    featureArea: "runtime",
    ownerArea: "ops",
    severity: "fatal",
    description: "A process-level unhandled promise rejection forced the server to shut down."
  },
  session_disconnect: {
    code: "session_disconnect",
    surface: "client",
    featureArea: "room_sync",
    ownerArea: "client",
    severity: "error",
    description: "The client session disconnected or failed to recover through reconnect."
  },
  client_error_boundary_triggered: {
    code: "client_error_boundary_triggered",
    surface: "client",
    featureArea: "runtime",
    ownerArea: "client",
    severity: "fatal",
    description: "The global client error boundary caught an uncaught exception or rejection."
  }
} as const satisfies Record<string, StructuredErrorCodeDefinition>;

export type StructuredErrorCode = keyof typeof STRUCTURED_ERROR_CODE_CATALOG;

export function getStructuredErrorCodeDefinition(code: StructuredErrorCode): StructuredErrorCodeDefinition {
  return STRUCTURED_ERROR_CODE_CATALOG[code];
}
