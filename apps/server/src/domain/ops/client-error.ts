import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GuestAuthSession } from "@server/domain/account/auth";
import { readGuestAuthTokenFromRequest, validateGuestAuthToken } from "@server/domain/account/auth";
import { captureClientError } from "@server/domain/ops/error-monitoring";
import { getRequestCorrelationId } from "@server/infra/http-request-context";
import { resolveTrustedRequestIp } from "@server/infra/request-ip";
import { recordHttpRateLimited, recordRuntimeErrorEvent } from "@server/domain/ops/observability";
import type { RoomSnapshotStore } from "@server/persistence";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_PLATFORM_LENGTH = 64;
const MAX_VERSION_LENGTH = 64;
const MAX_ERROR_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 16_000;
const MAX_CONTEXT_DETAIL_LENGTH = 8_000;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_PLAYER_MAX = 10;
const DEFAULT_RATE_LIMIT_IP_MAX = 20;

interface ClientErrorRuntimeConfig {
  rateLimitWindowMs: number;
  rateLimitPlayerMax: number;
  rateLimitIpMax: number;
}

interface ClientErrorReportPayload {
  platform: string;
  version: string;
  errorMessage: string;
  stack?: string | undefined;
  context?: Record<string, unknown> | undefined;
}

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface ClientErrorRouteRuntimeDependencies {
  now(): number;
  captureClientError: typeof captureClientError;
  recordRuntimeErrorEvent: typeof recordRuntimeErrorEvent;
  recordHttpRateLimited: typeof recordHttpRateLimited;
}

const defaultClientErrorRouteRuntimeDependencies: ClientErrorRouteRuntimeDependencies = {
  now: () => Date.now(),
  captureClientError,
  recordRuntimeErrorEvent,
  recordHttpRateLimited
};

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

class PayloadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "invalid_client_error_payload";
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function parseEnvNumber(
  value: string | undefined,
  fallback: number,
  options: { minimum?: number; integer?: boolean } = {}
): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = options.integer ? Math.floor(parsed) : parsed;
  if (options.minimum != null && normalized < options.minimum) {
    return fallback;
  }

  return normalized;
}

function readClientErrorRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ClientErrorRuntimeConfig {
  return {
    rateLimitWindowMs: parseEnvNumber(env.VEIL_RATE_LIMIT_CLIENT_ERROR_WINDOW_MS, DEFAULT_RATE_LIMIT_WINDOW_MS, {
      minimum: 1,
      integer: true
    }),
    rateLimitPlayerMax: parseEnvNumber(env.VEIL_RATE_LIMIT_CLIENT_ERROR_PLAYER_MAX, DEFAULT_RATE_LIMIT_PLAYER_MAX, {
      minimum: 1,
      integer: true
    }),
    rateLimitIpMax: parseEnvNumber(env.VEIL_RATE_LIMIT_CLIENT_ERROR_IP_MAX, DEFAULT_RATE_LIMIT_IP_MAX, {
      minimum: 1,
      integer: true
    })
  };
}

function readHeaderValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0]?.trim() || null : value?.trim() || null;
}

function resolveRequestIp(request: Pick<IncomingMessage, "headers" | "socket">): string {
  return resolveTrustedRequestIp(request);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    request.resume();
    throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeRequiredString(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new PayloadValidationError(`${fieldName} must be a string`);
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new PayloadValidationError(`${fieldName} is required`);
  }
  if (normalized.length > maxLength) {
    throw new PayloadValidationError(`${fieldName} exceeds ${maxLength} characters`);
  }

  return normalized;
}

function normalizeOptionalString(value: unknown, fieldName: string, maxLength: number): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new PayloadValidationError(`${fieldName} must be a string`);
  }
  if (value.length > maxLength) {
    throw new PayloadValidationError(`${fieldName} exceeds ${maxLength} characters`);
  }
  return value;
}

function normalizeContext(value: unknown): Record<string, unknown> | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new PayloadValidationError("context must be an object");
  }

  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_CONTEXT_DETAIL_LENGTH) {
    throw new PayloadValidationError(`context exceeds ${MAX_CONTEXT_DETAIL_LENGTH} characters`);
  }

  return value as Record<string, unknown>;
}

function normalizeClientErrorPayload(payload: unknown): ClientErrorReportPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PayloadValidationError("body must be a JSON object");
  }

  const typedPayload = payload as Record<string, unknown>;
  const stack = normalizeOptionalString(typedPayload.stack, "stack", MAX_STACK_LENGTH);
  const context = normalizeContext(typedPayload.context);
  return {
    platform: normalizeRequiredString(typedPayload.platform, "platform", MAX_PLATFORM_LENGTH),
    version: normalizeRequiredString(typedPayload.version, "version", MAX_VERSION_LENGTH),
    errorMessage: normalizeRequiredString(typedPayload.errorMessage, "errorMessage", MAX_ERROR_MESSAGE_LENGTH),
    ...(stack != null ? { stack } : {}),
    ...(context != null ? { context } : {})
  };
}

function consumeSlidingWindowRateLimit(
  counters: Map<string, number[]>,
  key: string,
  now: number,
  config: Pick<ClientErrorRuntimeConfig, "rateLimitWindowMs">,
  max: number
): RateLimitResult {
  const windowStart = now - config.rateLimitWindowMs;
  const timestamps = (counters.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
  if (timestamps.length >= max) {
    counters.set(key, timestamps);
    const oldestTimestamp = timestamps[0] ?? now;
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((oldestTimestamp + config.rateLimitWindowMs - now) / 1000))
    };
  }

  timestamps.push(now);
  counters.set(key, timestamps);
  return { allowed: true };
}

function sendRateLimited(response: ServerResponse, retryAfterSeconds: number): void {
  response.setHeader("Retry-After", String(retryAfterSeconds));
  sendJson(response, 429, {
    error: {
      code: "rate_limited",
      message: "Too many client error reports, please retry later"
    }
  });
}

function serializeContextDetail(context: Record<string, unknown> | undefined, authenticated: boolean): string | null {
  if (!authenticated || !context) {
    return null;
  }
  return JSON.stringify(context);
}

async function resolveOptionalSession(
  request: Pick<IncomingMessage, "headers">,
  store: RoomSnapshotStore | null
): Promise<GuestAuthSession | null> {
  const token = readGuestAuthTokenFromRequest(request);
  if (!token) {
    return null;
  }

  const result = await validateGuestAuthToken(token, store);
  return result.session;
}

export function registerClientErrorRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null,
  runtimeDependencies: Partial<ClientErrorRouteRuntimeDependencies> = {}
): void {
  const deps = {
    ...defaultClientErrorRouteRuntimeDependencies,
    ...runtimeDependencies
  };
  const ipCounters = new Map<string, number[]>();
  const playerCounters = new Map<string, number[]>();

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth, X-Correlation-Id");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.post("/api/client-error", async (request, response) => {
    try {
      const payload = normalizeClientErrorPayload(await readJsonBody(request));
      const session = await resolveOptionalSession(request, store);
      const config = readClientErrorRuntimeConfig();
      const now = deps.now();
      const ipAddress = resolveRequestIp(request);
      const ipLimit = consumeSlidingWindowRateLimit(ipCounters, ipAddress, now, config, config.rateLimitIpMax);
      if (!ipLimit.allowed) {
        deps.recordHttpRateLimited();
        sendRateLimited(response, ipLimit.retryAfterSeconds ?? 1);
        return;
      }

      if (session?.playerId) {
        const playerLimit = consumeSlidingWindowRateLimit(
          playerCounters,
          session.playerId,
          now,
          config,
          config.rateLimitPlayerMax
        );
        if (!playerLimit.allowed) {
          deps.recordHttpRateLimited();
          sendRateLimited(response, playerLimit.retryAfterSeconds ?? 1);
          return;
        }
      }

      const requestId = getRequestCorrelationId(request) ?? null;
      const authenticated = session != null;
      const candidateRevision = process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
      deps.recordRuntimeErrorEvent({
        id: randomUUID(),
        recordedAt: new Date(now).toISOString(),
        source: "client",
        surface: "client-error-report",
        candidateRevision,
        featureArea: "runtime",
        ownerArea: "client",
        severity: "error",
        errorCode: "client_error_boundary_triggered",
        message: payload.errorMessage,
        context: {
          roomId: null,
          playerId: session?.playerId ?? null,
          requestId,
          route: "/api/client-error",
          action: payload.platform,
          statusCode: null,
          crash: true,
          detail: serializeContextDetail(payload.context, authenticated)
        },
        tags: [payload.platform, payload.version, authenticated ? "authenticated" : "anonymous"]
      });

      await deps.captureClientError({
        platform: payload.platform,
        version: payload.version,
        errorMessage: payload.errorMessage,
        authenticated,
        ...(payload.stack != null ? { stack: payload.stack } : {}),
        context: {
          playerId: session?.playerId ?? null,
          requestId,
          clientVersion: payload.version,
          detail: serializeContextDetail(payload.context, authenticated)
        }
      });

      sendJson(response, 202, { accepted: true });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, {
          error: {
            code: error.name,
            message: error.message
          }
        });
        return;
      }

      if (error instanceof PayloadValidationError) {
        sendJson(response, 400, {
          error: {
            code: error.name,
            message: error.message
          }
        });
        return;
      }

      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }

      sendJson(response, 500, {
        error: {
          code: error instanceof Error ? error.name || "error" : "error",
          message: error instanceof Error ? error.message : String(error)
        }
      });
    }
  });
}
