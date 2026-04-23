import { buildAuthHeaders } from "./auth-session";

const DEFAULT_CLIENT_RUNTIME_PLATFORM = "h5-shell";
const DEFAULT_CLIENT_RUNTIME_VERSION = "development";

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

export async function reportClientRuntimeError({
  apiBaseUrl,
  authToken,
  payload,
  fetchImpl = fetch
}: ReportClientRuntimeErrorInput): Promise<void> {
  await fetchImpl(`${apiBaseUrl}/api/errors`, {
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

  const handleRuntimeFailure = (event: GlobalErrorBoundaryEventLike): void => {
    const normalized = normalizeRuntimeBoundaryFailure(event);
    void reportClientRuntimeError({
      apiBaseUrl,
      authToken: readAuthToken(),
      fetchImpl,
      payload: {
        platform,
        version,
        errorMessage: normalized.errorMessage,
        ...(normalized.stack ? { stack: normalized.stack } : {}),
        context: readContext()
      }
    }).catch(() => undefined);
  };

  eventTarget.addEventListener("error", handleRuntimeFailure);
  eventTarget.addEventListener("unhandledrejection", handleRuntimeFailure);

  return () => {
    eventTarget.removeEventListener("error", handleRuntimeFailure);
    eventTarget.removeEventListener("unhandledrejection", handleRuntimeFailure);
  };
}
