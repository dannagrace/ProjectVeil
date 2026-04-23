import { buildAuthHeaders } from "./auth-session";

const DEFAULT_CLIENT_RUNTIME_PLATFORM = "h5-shell";
const DEFAULT_CLIENT_RUNTIME_VERSION = "development";
const CLIENT_RUNTIME_ERROR_DEDUPE_WINDOW_MS = 60_000;
const CLIENT_RUNTIME_ERROR_THROTTLE_WINDOW_MS = 60_000;
const CLIENT_RUNTIME_ERROR_THROTTLE_LIMIT = 5;
const CLIENT_RUNTIME_ERROR_FINGERPRINT_STACK_LIMIT = 120;
const CLIENT_RUNTIME_ERROR_RECENT_FINGERPRINT_LIMIT = 128;
const CLIENT_RUNTIME_ERROR_ROUTE = "/api/client-error";

interface GlobalErrorBoundaryEventLike {
  message?: string;
  error?: unknown;
  reason?: unknown;
}

interface EventTargetLike {
  addEventListener(type: string, listener: (event: GlobalErrorBoundaryEventLike) => void): void;
  removeEventListener(type: string, listener: (event: GlobalErrorBoundaryEventLike) => void): void;
}

interface RuntimeErrorReportingDependencies {
  eventTarget?: EventTargetLike | null;
  fetchImpl?: typeof fetch;
}

interface ReportClientRuntimeErrorInput {
  apiBaseUrl: string;
  authToken?: string | null;
  payload: {
    platform: string;
    version: string;
    errorMessage: string;
    stack?: string;
    context?: Record<string, unknown>;
  };
  fetchImpl?: typeof fetch;
}

interface BindClientRuntimeErrorBoundaryInput extends RuntimeErrorReportingDependencies {
  apiBaseUrl: string;
  readAuthToken: () => string | null;
  readContext: () => Record<string, unknown>;
  platform?: string;
  version?: string;
}

function resolveClientRuntimeVersion(): string {
  if (typeof import.meta !== "undefined" && typeof import.meta.env?.MODE === "string" && import.meta.env.MODE.trim()) {
    return import.meta.env.MODE.trim();
  }
  return DEFAULT_CLIENT_RUNTIME_VERSION;
}

function normalizeRuntimeBoundaryFailure(event: GlobalErrorBoundaryEventLike): {
  errorMessage: string;
  stack?: string;
} {
  const reason = event.error ?? event.reason;
  if (reason instanceof Error) {
    return {
      errorMessage: reason.message || event.message?.trim() || "unknown_client_error",
      ...(reason.stack ? { stack: reason.stack } : {})
    };
  }
  if (typeof event.message === "string" && event.message.trim()) {
    return {
      errorMessage: event.message.trim()
    };
  }
  if (typeof reason === "string" && reason.trim()) {
    return {
      errorMessage: reason.trim()
    };
  }
  return {
    errorMessage: String(reason ?? "unknown_client_error")
  };
}

function buildRuntimeErrorFingerprint(input: { errorMessage: string; stack?: string }): string {
  const stackPrefix = input.stack?.slice(0, CLIENT_RUNTIME_ERROR_FINGERPRINT_STACK_LIMIT).trim() ?? "";
  return stackPrefix ? `${input.errorMessage}:${stackPrefix}` : input.errorMessage;
}

function pruneRecentRuntimeErrorFingerprints(recentFingerprints: Map<string, number>, now: number): void {
  const cutoff = now - CLIENT_RUNTIME_ERROR_DEDUPE_WINDOW_MS;
  for (const [fingerprint, reportedAt] of recentFingerprints.entries()) {
    if (reportedAt < cutoff) {
      recentFingerprints.delete(fingerprint);
    }
  }
  while (recentFingerprints.size > CLIENT_RUNTIME_ERROR_RECENT_FINGERPRINT_LIMIT) {
    const oldestFingerprint = recentFingerprints.keys().next().value;
    if (typeof oldestFingerprint !== "string") {
      break;
    }
    recentFingerprints.delete(oldestFingerprint);
  }
}

function pruneRuntimeErrorReportTimestamps(reportTimestamps: number[], now: number): void {
  const cutoff = now - CLIENT_RUNTIME_ERROR_THROTTLE_WINDOW_MS;
  while (reportTimestamps.length > 0 && reportTimestamps[0] !== undefined && reportTimestamps[0] < cutoff) {
    reportTimestamps.shift();
  }
}

export async function reportClientRuntimeError({
  apiBaseUrl,
  authToken,
  payload,
  fetchImpl = fetch
}: ReportClientRuntimeErrorInput): Promise<void> {
  await fetchImpl(`${apiBaseUrl}${CLIENT_RUNTIME_ERROR_ROUTE}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildAuthHeaders(authToken)
    },
    body: JSON.stringify(payload)
  });
}

export function bindClientRuntimeErrorBoundary({
  apiBaseUrl,
  readAuthToken,
  readContext,
  platform = DEFAULT_CLIENT_RUNTIME_PLATFORM,
  version = resolveClientRuntimeVersion(),
  eventTarget = globalThis as typeof globalThis & Partial<EventTargetLike>,
  fetchImpl = fetch
}: BindClientRuntimeErrorBoundaryInput): (() => void) | null {
  if (
    !eventTarget ||
    typeof eventTarget.addEventListener !== "function" ||
    typeof eventTarget.removeEventListener !== "function"
  ) {
    return null;
  }

  const recentFingerprints = new Map<string, number>();
  const reportTimestamps: number[] = [];
  let isHandlingRuntimeFailure = false;

  const handleRuntimeFailure = (event: GlobalErrorBoundaryEventLike): void => {
    if (isHandlingRuntimeFailure) {
      return;
    }

    isHandlingRuntimeFailure = true;
    try {
      const normalized = normalizeRuntimeBoundaryFailure(event);
      const now = Date.now();
      const fingerprint = buildRuntimeErrorFingerprint(normalized);

      pruneRecentRuntimeErrorFingerprints(recentFingerprints, now);
      if (recentFingerprints.has(fingerprint)) {
        return;
      }

      pruneRuntimeErrorReportTimestamps(reportTimestamps, now);
      if (reportTimestamps.length >= CLIENT_RUNTIME_ERROR_THROTTLE_LIMIT) {
        return;
      }

      const payload = {
        platform,
        version,
        errorMessage: normalized.errorMessage,
        ...(normalized.stack ? { stack: normalized.stack } : {}),
        context: readContext()
      };
      const authToken = readAuthToken();

      recentFingerprints.set(fingerprint, now);
      pruneRecentRuntimeErrorFingerprints(recentFingerprints, now);
      reportTimestamps.push(now);

      void reportClientRuntimeError({
        apiBaseUrl,
        authToken,
        fetchImpl,
        payload
      }).catch(() => undefined);
    } catch {
      return;
    } finally {
      isHandlingRuntimeFailure = false;
    }
  };

  eventTarget.addEventListener("error", handleRuntimeFailure);
  eventTarget.addEventListener("unhandledrejection", handleRuntimeFailure);

  return () => {
    eventTarget.removeEventListener("error", handleRuntimeFailure);
    eventTarget.removeEventListener("unhandledrejection", handleRuntimeFailure);
  };
}
