import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RuntimeDiagnosticsFeatureArea } from "@veil/shared/platform";
import { recordRuntimeErrorEvent } from "./observability";

export const REQUEST_CORRELATION_ID_HEADER = "x-correlation-id";
const REQUEST_ID_FALLBACK_HEADER = "x-request-id";
const MAX_CORRELATION_ID_LENGTH = 128;
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;
const ROUTE_FAILURE_ERROR_CODE = "http_route_failed";
const VEIL_CORRELATION_ID_KEY = "__veilCorrelationId";
const VEIL_ROUTE_PATTERN_KEY = "__veilRoutePattern";

interface ObservedRequestContext {
  [VEIL_CORRELATION_ID_KEY]?: string;
  [VEIL_ROUTE_PATTERN_KEY]?: string;
}

interface HttpRouteObservabilityLogger {
  error(message: string, error: unknown): void;
}

interface HttpRouteObservabilityApp {
  use?: (...args: unknown[]) => unknown;
  get?: (...args: unknown[]) => unknown;
  post?: (...args: unknown[]) => unknown;
  put?: (...args: unknown[]) => unknown;
  delete?: (...args: unknown[]) => unknown;
  patch?: (...args: unknown[]) => unknown;
  options?: (...args: unknown[]) => unknown;
  head?: (...args: unknown[]) => unknown;
}

type HttpHandler = (...args: unknown[]) => unknown;

type AppMethodName = "use" | "get" | "post" | "put" | "delete" | "patch" | "options" | "head";

const ROUTE_METHOD_NAMES: AppMethodName[] = ["get", "post", "put", "delete", "patch", "options", "head"];

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.find((entry) => entry.trim().length > 0) ?? null;
  }

  return null;
}

function sanitizeCorrelationId(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized || normalized.length > MAX_CORRELATION_ID_LENGTH || !CORRELATION_ID_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

function buildCorrelationId(): string {
  return `req-${randomUUID()}`;
}

function readRequestPathname(request: IncomingMessage): string | null {
  if (!request.url) {
    return null;
  }

  try {
    return new URL(request.url, "http://project-veil.local").pathname;
  } catch {
    return request.url.split("?")[0] ?? null;
  }
}

function readRoutePattern(request: IncomingMessage): string | null {
  return (request as IncomingMessage & ObservedRequestContext)[VEIL_ROUTE_PATTERN_KEY] ?? null;
}

function setRoutePattern(request: IncomingMessage, routePattern: string | null): void {
  if (!routePattern) {
    return;
  }

  (request as IncomingMessage & ObservedRequestContext)[VEIL_ROUTE_PATTERN_KEY] = routePattern;
}

export function getRequestCorrelationId(request: IncomingMessage): string | null {
  return (request as IncomingMessage & ObservedRequestContext)[VEIL_CORRELATION_ID_KEY] ?? null;
}

export function ensureRequestCorrelationId(request: IncomingMessage, response: ServerResponse): string {
  const requestWithContext = request as IncomingMessage & ObservedRequestContext;
  const existing = requestWithContext[VEIL_CORRELATION_ID_KEY];
  if (existing) {
    response.setHeader(REQUEST_CORRELATION_ID_HEADER, existing);
    return existing;
  }

  const correlationId =
    sanitizeCorrelationId(readHeaderValue(request.headers[REQUEST_CORRELATION_ID_HEADER])) ??
    sanitizeCorrelationId(readHeaderValue(request.headers[REQUEST_ID_FALLBACK_HEADER])) ??
    buildCorrelationId();

  requestWithContext[VEIL_CORRELATION_ID_KEY] = correlationId;
  response.setHeader(REQUEST_CORRELATION_ID_HEADER, correlationId);
  return correlationId;
}

function inferFeatureArea(routePattern: string | null, pathname: string | null): RuntimeDiagnosticsFeatureArea {
  const route = (routePattern ?? pathname ?? "").toLowerCase();
  if (route.startsWith("/api/auth")) {
    return "login";
  }
  if (route.startsWith("/api/payments")) {
    return "payment";
  }
  if (route.startsWith("/api/guild")) {
    return "guild";
  }
  if (route.startsWith("/api/shop")) {
    return "shop";
  }
  if (route.startsWith("/api/season")) {
    return "season";
  }
  if (route.includes("quest")) {
    return "quests";
  }
  return "runtime";
}

function inferOwnerArea(featureArea: RuntimeDiagnosticsFeatureArea): string {
  switch (featureArea) {
    case "payment":
      return "commerce";
    case "guild":
      return "multiplayer";
    default:
      return "platform";
  }
}

function serializeErrorDetail(input: Record<string, unknown>): string {
  return JSON.stringify(input, (_key, value) => {
    if (typeof value === "string" && value.length > 1200) {
      return `${value.slice(0, 1197)}...`;
    }
    return value;
  });
}

function reportRouteError(
  logger: HttpRouteObservabilityLogger,
  request: IncomingMessage,
  response: ServerResponse,
  methodName: string,
  error: unknown
): void {
  const correlationId = ensureRequestCorrelationId(request, response);
  const pathname = readRequestPathname(request);
  const routePattern = readRoutePattern(request);
  const statusCode = response.statusCode >= 400 ? response.statusCode : 500;
  const featureArea = inferFeatureArea(routePattern, pathname);
  const errorName = error instanceof Error ? error.name : typeof error;
  const errorMessage = error instanceof Error ? error.message : String(error);
  const detail = {
    method: request.method ?? methodName.toUpperCase(),
    path: pathname,
    routePattern,
    correlationId,
    errorName,
    errorMessage,
    stack: error instanceof Error ? error.stack ?? null : null
  };

  logger.error(`HTTP route handler failed for ${request.method ?? methodName.toUpperCase()} ${pathname ?? routePattern ?? "<unknown>"}`, detail);
  recordRuntimeErrorEvent({
    id: randomUUID(),
    recordedAt: new Date().toISOString(),
    source: "server",
    surface: "http-route",
    candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    featureArea,
    ownerArea: inferOwnerArea(featureArea),
    severity: "error",
    errorCode: ROUTE_FAILURE_ERROR_CODE,
    message: `HTTP route handler failed for ${request.method ?? methodName.toUpperCase()} ${pathname ?? routePattern ?? "<unknown>"}`,
    tags: ["http-route", methodName.toLowerCase(), featureArea],
    context: {
      roomId: null,
      playerId: null,
      requestId: correlationId,
      route: routePattern ?? pathname,
      action: request.method ?? methodName.toUpperCase(),
      statusCode,
      crash: false,
      detail: serializeErrorDetail(detail)
    }
  });
}

function sendInternalError(response: ServerResponse, correlationId: string): void {
  if (response.headersSent) {
    response.end();
    return;
  }

  response.statusCode = 500;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(
    JSON.stringify({
      error: "internal_server_error",
      correlationId
    })
  );
}

function wrapHandler(
  value: unknown,
  logger: HttpRouteObservabilityLogger,
  methodName: string,
  routePattern?: string
): unknown {
  if (typeof value !== "function") {
    return value;
  }

  const handler = value as HttpHandler;
  return function observedHandler(request: IncomingMessage, response: ServerResponse, next?: () => void): unknown {
    ensureRequestCorrelationId(request, response);
    if (routePattern) {
      setRoutePattern(request, routePattern);
    }

    try {
      const result = handler(request, response, next);
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        return Promise.resolve(result).catch((error) => {
          reportRouteError(logger, request, response, methodName, error);
          sendInternalError(response, ensureRequestCorrelationId(request, response));
        });
      }
      return result;
    } catch (error) {
      reportRouteError(logger, request, response, methodName, error);
      sendInternalError(response, ensureRequestCorrelationId(request, response));
      return undefined;
    }
  };
}

function wrapUseArguments(logger: HttpRouteObservabilityLogger, args: unknown[]): unknown[] {
  if (args.length === 0) {
    return args;
  }

  if (typeof args[0] === "string") {
    return [args[0], ...args.slice(1).map((value) => wrapHandler(value, logger, "use"))];
  }

  return args.map((value) => wrapHandler(value, logger, "use"));
}

export function installHttpRequestObservability(
  app: HttpRouteObservabilityApp,
  logger: HttpRouteObservabilityLogger
): void {
  const originalUse = app.use?.bind(app);
  if (originalUse) {
    app.use = (...args: unknown[]) => originalUse(...wrapUseArguments(logger, args));
    app.use((request: IncomingMessage, response: ServerResponse, next: () => void) => {
      ensureRequestCorrelationId(request, response);
      next();
    });
  }

  for (const methodName of ROUTE_METHOD_NAMES) {
    const originalMethod = app[methodName]?.bind(app);
    if (!originalMethod) {
      continue;
    }

    app[methodName] = ((path: string, ...handlers: unknown[]) =>
      originalMethod(path, ...handlers.map((handler) => wrapHandler(handler, logger, methodName, path)))) as never;
  }
}
