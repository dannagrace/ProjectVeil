import {
  createAnalyticsEvent,
  type AnalyticsEvent,
  type AnalyticsEventName
} from "../../../packages/shared/src/index";
import type { IncomingMessage, ServerResponse } from "node:http";

const ANALYTICS_BUFFER_FLUSH_SIZE = 20;
const ANALYTICS_BUFFER_FLUSH_DELAY_MS = 250;

interface AnalyticsRuntimeDependencies {
  fetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number }>;
  log(message: string): void;
  error(message: string, error?: unknown): void;
  setTimeout(handler: () => void, delayMs: number): NodeJS.Timeout;
  clearTimeout(handle: NodeJS.Timeout): void;
}

const defaultAnalyticsRuntimeDependencies: AnalyticsRuntimeDependencies = {
  fetch: (input, init) => fetch(input, init),
  log: (message) => console.log(message),
  error: (message, error) => console.error(message, error),
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => clearTimeout(handle)
};

let analyticsRuntimeDependencies = defaultAnalyticsRuntimeDependencies;
let pendingEvents: AnalyticsEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

const MAX_ANALYTICS_REQUEST_BYTES = 256 * 1024;

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_ANALYTICS_REQUEST_BYTES) {
    request.resume();
    throw new PayloadTooLargeError(MAX_ANALYTICS_REQUEST_BYTES);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_ANALYTICS_REQUEST_BYTES) {
      throw new PayloadTooLargeError(MAX_ANALYTICS_REQUEST_BYTES);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function configureAnalyticsRuntimeDependencies(overrides: Partial<AnalyticsRuntimeDependencies>): void {
  analyticsRuntimeDependencies = {
    ...analyticsRuntimeDependencies,
    ...overrides
  };
}

export function resetAnalyticsRuntimeDependencies(): void {
  analyticsRuntimeDependencies = defaultAnalyticsRuntimeDependencies;
  pendingEvents = [];
  if (flushTimer) {
    analyticsRuntimeDependencies.clearTimeout(flushTimer);
  }
  flushTimer = null;
}

async function flushEvents(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (pendingEvents.length === 0) {
    return;
  }

  const batch = pendingEvents;
  pendingEvents = [];
  if (flushTimer) {
    analyticsRuntimeDependencies.clearTimeout(flushTimer);
    flushTimer = null;
  }

  const envelope = {
    schemaVersion: 1,
    emittedAt: new Date().toISOString(),
    events: batch
  };
  const endpoint = env.ANALYTICS_ENDPOINT?.trim();

  if (!endpoint) {
    analyticsRuntimeDependencies.log(`[Analytics] ${JSON.stringify(envelope)}`);
    return;
  }

  try {
    const response = await analyticsRuntimeDependencies.fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(envelope)
    });

    if (!response.ok) {
      analyticsRuntimeDependencies.error(`[Analytics] Failed to flush analytics batch: ${response.status}`);
    }
  } catch (error) {
    analyticsRuntimeDependencies.error("[Analytics] Failed to flush analytics batch", error);
  }
}

function scheduleFlush(env: NodeJS.ProcessEnv = process.env): void {
  if (pendingEvents.length >= ANALYTICS_BUFFER_FLUSH_SIZE) {
    void flushEvents(env);
    return;
  }

  if (flushTimer) {
    return;
  }

  flushTimer = analyticsRuntimeDependencies.setTimeout(() => {
    flushTimer = null;
    void flushEvents(env);
  }, ANALYTICS_BUFFER_FLUSH_DELAY_MS);
  flushTimer.unref?.();
}

export function emitAnalyticsEvent<Name extends AnalyticsEventName>(
  name: Name,
  input: Parameters<typeof createAnalyticsEvent<Name>>[1],
  env: NodeJS.ProcessEnv = process.env
): AnalyticsEvent<Name> {
  const event = createAnalyticsEvent(name, input);
  pendingEvents.push(event);
  scheduleFlush(env);
  return event;
}

export function flushAnalyticsEventsForTest(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return flushEvents(env);
}

export function registerAnalyticsRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  }
): void {
  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.post("/api/analytics/events", async (request, response) => {
    try {
      const payload = await readJsonBody(request);
      analyticsRuntimeDependencies.log(`[Analytics] ${JSON.stringify(payload)}`);
      sendJson(response, 202, {
        accepted: Array.isArray((payload as { events?: unknown[] } | null)?.events)
          ? (payload as { events: unknown[] }).events.length
          : 0
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, {
          error: toErrorPayload(error)
        });
        return;
      }

      sendJson(response, 400, {
        error: toErrorPayload(error)
      });
    }
  });
}
