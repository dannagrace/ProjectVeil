import { randomUUID } from "node:crypto";
import { STRUCTURED_ERROR_CODE_CATALOG, type StructuredErrorCode, type StructuredErrorCodeDefinition } from "@veil/shared/platform";

type MonitoringSeverity = "warn" | "error" | "fatal";

interface ErrorMonitoringRuntimeDependencies {
  fetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number }>;
  error(message: string, error?: unknown): void;
}

interface ParsedSentryDsn {
  dsn: string;
  endpoint: string;
}

export interface ServerErrorMonitoringContext {
  roomId?: string | null;
  playerId?: string | null;
  requestId?: string | null;
  action?: string | null;
  route?: string | null;
  statusCode?: number | null;
  roomDay?: number | null;
  battleId?: string | null;
  heroId?: string | null;
  clientVersion?: string | null;
  detail?: string | null;
}

export interface ClientErrorMonitoringContext {
  playerId?: string | null;
  requestId?: string | null;
  clientVersion?: string | null;
  detail?: string | null;
}

interface CaptureServerErrorInput {
  errorCode: StructuredErrorCode | string;
  message: string;
  error?: unknown;
  severity?: MonitoringSeverity;
  featureArea?: string;
  ownerArea?: string;
  surface?: string;
  tags?: string[];
  context?: ServerErrorMonitoringContext;
}

interface SentryEventInput {
  errorCode: StructuredErrorCode | string;
  message: string;
  error?: unknown;
  severity?: MonitoringSeverity;
  featureArea?: string;
  ownerArea?: string;
  surface?: string;
  tags?: string[];
  tagValues?: Record<string, string>;
  context?: ServerErrorMonitoringContext;
  platform?: string;
  logger?: string;
  serverName?: string;
}

export interface CaptureClientErrorInput {
  platform: string;
  version: string;
  errorMessage: string;
  stack?: string | null;
  context?: ClientErrorMonitoringContext;
  authenticated?: boolean;
}

const defaultErrorMonitoringRuntimeDependencies: ErrorMonitoringRuntimeDependencies = {
  fetch: (input, init) => fetch(input, init),
  error: (message, error) => console.error(message, error)
};

let errorMonitoringRuntimeDependencies = defaultErrorMonitoringRuntimeDependencies;

function isStructuredErrorCode(code: string): code is StructuredErrorCode {
  return code in STRUCTURED_ERROR_CODE_CATALOG;
}

function getStructuredErrorDefaults(
  code: StructuredErrorCode | string
): Pick<StructuredErrorCodeDefinition, "featureArea" | "ownerArea" | "severity"> | null {
  if (!isStructuredErrorCode(code)) {
    return null;
  }
  return STRUCTURED_ERROR_CODE_CATALOG[code];
}

function parseSentryDsn(dsn: string | undefined): ParsedSentryDsn | null {
  const trimmed = dsn?.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const pathSegments = parsed.pathname.split("/").filter(Boolean);
    const projectId = pathSegments.pop();
    if (!parsed.username || !projectId) {
      return null;
    }
    const basePath = pathSegments.length === 0 ? "" : `/${pathSegments.join("/")}`;
    return {
      dsn: trimmed,
      endpoint: `${parsed.protocol}//${parsed.host}${basePath}/api/${projectId}/envelope/`
    };
  } catch {
    return null;
  }
}

function normalizeError(error: unknown): { type: string; value: string; stack?: string } | null {
  if (error instanceof Error) {
    return {
      type: error.name || "Error",
      value: error.message,
      ...(error.stack ? { stack: error.stack } : {})
    };
  }
  if (error == null) {
    return null;
  }
  return {
    type: typeof error,
    value: String(error)
  };
}

function buildSentryEvent(
  input: SentryEventInput,
  env: NodeJS.ProcessEnv
): { endpoint: string; body: string } | null {
  const parsedDsn = parseSentryDsn(env.SENTRY_DSN);
  if (!parsedDsn) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const eventId = randomUUID().replace(/-/g, "");
  const defaults = getStructuredErrorDefaults(input.errorCode);
  const severity = input.severity ?? defaults?.severity ?? "error";
  const featureArea = input.featureArea ?? defaults?.featureArea ?? "runtime";
  const ownerArea = input.ownerArea ?? defaults?.ownerArea ?? "ops";
  const normalizedError = normalizeError(input.error);
  const candidateRevision = env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  const payload = {
    event_id: eventId,
    timestamp,
    platform: input.platform ?? "node",
    level: severity === "warn" ? "warning" : severity,
    logger: input.logger ?? "project-veil-server",
    server_name: input.serverName ?? "project-veil-server",
    environment: env.NODE_ENV?.trim() || "development",
    release: candidateRevision ?? undefined,
    message: {
      formatted: input.message
    },
    ...(normalizedError
      ? {
          exception: {
            values: [
              {
                type: normalizedError.type,
                value: normalizedError.value,
                ...(normalizedError.stack ? { stacktrace: { frames: normalizedError.stack.split("\n").map((line) => ({ filename: line.trim() })) } } : {})
              }
            ]
          }
        }
      : {}),
    ...(input.context?.playerId ? { user: { id: input.context.playerId } } : {}),
    tags: {
      error_code: input.errorCode,
      feature_area: featureArea,
      owner_area: ownerArea,
      surface: input.surface ?? "server",
      ...(input.context?.route ? { route: input.context.route } : {}),
      ...(input.context?.action ? { action: input.context.action } : {}),
      ...input.tagValues
    },
    fingerprint: [
      input.surface ?? "server",
      featureArea,
      ownerArea,
      input.errorCode,
      input.context?.route ?? "no-route",
      input.context?.action ?? "no-action"
    ],
    contexts: {
      project_veil: {
        candidateRevision,
        roomId: input.context?.roomId ?? null,
        playerId: input.context?.playerId ?? null,
        requestId: input.context?.requestId ?? null,
        action: input.context?.action ?? null,
        route: input.context?.route ?? null,
        statusCode: input.context?.statusCode ?? null,
        roomDay: input.context?.roomDay ?? null,
        battleId: input.context?.battleId ?? null,
        heroId: input.context?.heroId ?? null,
        clientVersion: input.context?.clientVersion ?? null
      }
    },
    extra: {
      detail: input.context?.detail ?? null,
      tags: input.tags ?? []
    }
  };
  const envelope = `${JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn: parsedDsn.dsn })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(payload)}`;

  return {
    endpoint: parsedDsn.endpoint,
    body: envelope
  };
}

export function configureErrorMonitoringRuntimeDependencies(
  overrides: Partial<ErrorMonitoringRuntimeDependencies>
): void {
  errorMonitoringRuntimeDependencies = {
    ...errorMonitoringRuntimeDependencies,
    ...overrides
  };
}

export function resetErrorMonitoringRuntimeDependencies(): void {
  errorMonitoringRuntimeDependencies = defaultErrorMonitoringRuntimeDependencies;
}

export function isErrorMonitoringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseSentryDsn(env.SENTRY_DSN) != null;
}

export async function captureServerError(
  input: CaptureServerErrorInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const event = buildSentryEvent(input, env);
  if (!event) {
    return;
  }

  try {
    const response = await errorMonitoringRuntimeDependencies.fetch(event.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope"
      },
      body: event.body
    });
    if (!response.ok) {
      errorMonitoringRuntimeDependencies.error(`[ErrorMonitoring] Failed to deliver Sentry envelope: ${response.status}`);
    }
  } catch (error) {
    errorMonitoringRuntimeDependencies.error("[ErrorMonitoring] Failed to deliver Sentry envelope", error);
  }
}

function normalizeClientStack(errorMessage: string, stack: string | null | undefined): Error {
  const error = new Error(errorMessage);
  if (stack?.trim()) {
    error.stack = stack.trim().includes(errorMessage)
      ? stack.trim()
      : `${error.name}: ${errorMessage}\n${stack.trim()}`;
  }
  return error;
}

export async function captureClientError(
  input: CaptureClientErrorInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  const event = buildSentryEvent(
    {
      errorCode: "client_error_boundary_triggered",
      message: `Client error reported from ${input.platform} ${input.version}: ${input.errorMessage}`,
      error: normalizeClientStack(input.errorMessage, input.stack),
      severity: "error",
      featureArea: "runtime",
      ownerArea: "client",
      surface: "client-error-report",
      platform: "javascript",
      logger: "project-veil-client",
      serverName: "project-veil-client",
      tagValues: {
        client_platform: input.platform,
        client_version: input.version,
        auth: input.authenticated ? "authenticated" : "anonymous"
      },
      context: {
        playerId: input.context?.playerId ?? null,
        requestId: input.context?.requestId ?? null,
        route: "/api/client-error",
        clientVersion: input.context?.clientVersion ?? input.version,
        detail: input.context?.detail ?? null
      }
    },
    env
  );
  if (!event) {
    return;
  }

  try {
    const response = await errorMonitoringRuntimeDependencies.fetch(event.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope"
      },
      body: event.body
    });
    if (!response.ok) {
      errorMonitoringRuntimeDependencies.error(`[ErrorMonitoring] Failed to deliver Sentry envelope: ${response.status}`);
    }
  } catch (error) {
    errorMonitoringRuntimeDependencies.error("[ErrorMonitoring] Failed to deliver Sentry envelope", error);
  }
}
