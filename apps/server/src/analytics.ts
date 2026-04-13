import {
  createAnalyticsEvent,
  type AnalyticsEvent,
  type AnalyticsEventName
} from "../../../packages/shared/src/index";
import type { IncomingMessage, ServerResponse } from "node:http";

const ANALYTICS_BUFFER_FLUSH_SIZE = 20;
const ANALYTICS_BUFFER_FLUSH_DELAY_MS = 250;
const DEFAULT_ANALYTICS_RETENTION_DAYS = 400;

export type AnalyticsSink = "stdout" | "http";

interface AnalyticsPipelineConfig {
  sink: AnalyticsSink;
  endpoint: string | null;
  warehouseDataset: string;
  warehouseEventsTable: string;
  warehouseRawBucket: string;
  retentionDays: number;
  deletionWorkflow: string;
  alerts: string[];
}

interface AnalyticsPipelineCounters {
  ingestedEventsTotal: number;
  flushedEventsTotal: number;
  flushBatchesTotal: number;
  flushFailuresTotal: number;
  lastFlushAt: string | null;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
  ingestedByKey: Map<string, number>;
  flushedByKey: Map<string, number>;
}

export interface AnalyticsPipelineSnapshot {
  status: "ok" | "warn";
  sink: AnalyticsSink;
  endpoint: string | null;
  buffering: {
    pendingEvents: number;
    flushSize: number;
    flushDelayMs: number;
  };
  warehouse: {
    dataset: string;
    eventsTable: string;
    rawBucket: string;
    retentionDays: number;
    deletionWorkflow: string;
  };
  delivery: {
    ingestedEventsTotal: number;
    flushedEventsTotal: number;
    flushBatchesTotal: number;
    flushFailuresTotal: number;
    lastFlushAt: string | null;
    lastErrorAt: string | null;
    lastErrorMessage: string | null;
    events: Array<{
      name: string;
      source: string;
      ingestedTotal: number;
      flushedTotal: number;
    }>;
  };
  alerts: string[];
}

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
let capturedAnalyticsEvents: AnalyticsEvent[] = [];
const emittedAnalyticsAlerts = new Set<string>();
const analyticsPipelineCounters: AnalyticsPipelineCounters = {
  ingestedEventsTotal: 0,
  flushedEventsTotal: 0,
  flushBatchesTotal: 0,
  flushFailuresTotal: 0,
  lastFlushAt: null,
  lastErrorAt: null,
  lastErrorMessage: null,
  ingestedByKey: new Map<string, number>(),
  flushedByKey: new Map<string, number>()
};

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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function normalizeAnalyticsDimension(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function buildAnalyticsCounterKey(event: { name?: unknown; source?: unknown }): string {
  return `${normalizeAnalyticsDimension(event.name, "unknown")}::${normalizeAnalyticsDimension(event.source, "unknown")}`;
}

function incrementCounter(map: Map<string, number>, key: string, amount = 1): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function recordIngestedEvents(events: Array<{ name?: unknown; source?: unknown }>): void {
  analyticsPipelineCounters.ingestedEventsTotal += events.length;
  for (const event of events) {
    incrementCounter(analyticsPipelineCounters.ingestedByKey, buildAnalyticsCounterKey(event));
  }
}

function recordFlushedEvents(events: Array<{ name?: unknown; source?: unknown }>): void {
  analyticsPipelineCounters.flushedEventsTotal += events.length;
  analyticsPipelineCounters.flushBatchesTotal += 1;
  analyticsPipelineCounters.lastFlushAt = new Date().toISOString();
  analyticsPipelineCounters.lastErrorAt = null;
  analyticsPipelineCounters.lastErrorMessage = null;
  for (const event of events) {
    incrementCounter(analyticsPipelineCounters.flushedByKey, buildAnalyticsCounterKey(event));
  }
}

function recordFlushFailure(message: string): void {
  analyticsPipelineCounters.flushFailuresTotal += 1;
  analyticsPipelineCounters.lastErrorAt = new Date().toISOString();
  analyticsPipelineCounters.lastErrorMessage = message;
}

function usesExampleHostname(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.trim().toLowerCase();
    return hostname === "example" || hostname.endsWith(".example");
  } catch {
    return /\.example($|\/|:)/.test(value.trim().toLowerCase());
  }
}

function resolveAnalyticsPipelineConfig(env: NodeJS.ProcessEnv = process.env): AnalyticsPipelineConfig {
  const requestedSink = env.ANALYTICS_SINK?.trim().toLowerCase();
  const configuredEndpoint = env.ANALYTICS_ENDPOINT?.trim() || env.ANALYTICS_HTTP_ENDPOINT?.trim() || null;
  const alerts: string[] = [];
  let sink: AnalyticsSink =
    requestedSink === "http" || requestedSink === "stdout"
      ? requestedSink
      : configuredEndpoint
        ? "http"
        : "stdout";

  if (sink === "http" && !configuredEndpoint) {
    alerts.push("ANALYTICS_SINK=http but ANALYTICS_ENDPOINT is not configured; falling back to stdout.");
    sink = "stdout";
  }

  if (configuredEndpoint && usesExampleHostname(configuredEndpoint)) {
    alerts.push("ANALYTICS_ENDPOINT uses a .example hostname; analytics delivery is still pointed at a placeholder endpoint.");
  }

  return {
    sink,
    endpoint: sink === "http" ? configuredEndpoint : null,
    warehouseDataset: env.ANALYTICS_WAREHOUSE_DATASET?.trim() || "analytics_prod",
    warehouseEventsTable: env.ANALYTICS_WAREHOUSE_EVENTS_TABLE?.trim() || "veil_analytics_events",
    warehouseRawBucket: env.ANALYTICS_RAW_BUCKET?.trim() || "s3://project-veil-analytics-prod/raw",
    retentionDays: parsePositiveInteger(env.ANALYTICS_RETENTION_DAYS, DEFAULT_ANALYTICS_RETENTION_DAYS),
    deletionWorkflow: env.ANALYTICS_DELETION_WORKFLOW?.trim() || "dsr-player-delete",
    alerts
  };
}

function buildAnalyticsPipelineEventsSummary(): AnalyticsPipelineSnapshot["delivery"]["events"] {
  const keys = new Set([
    ...analyticsPipelineCounters.ingestedByKey.keys(),
    ...analyticsPipelineCounters.flushedByKey.keys()
  ]);

  return Array.from(keys)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const [name, source] = key.split("::");
      return {
        name: name ?? "unknown",
        source: source ?? "unknown",
        ingestedTotal: analyticsPipelineCounters.ingestedByKey.get(key) ?? 0,
        flushedTotal: analyticsPipelineCounters.flushedByKey.get(key) ?? 0
      };
    });
}

function emitAnalyticsAlerts(config: AnalyticsPipelineConfig): void {
  for (const alert of config.alerts) {
    if (emittedAnalyticsAlerts.has(alert)) {
      continue;
    }
    analyticsRuntimeDependencies.error(`[Analytics] ${alert}`);
    emittedAnalyticsAlerts.add(alert);
  }
}

export function getAnalyticsPipelineSnapshot(env: NodeJS.ProcessEnv = process.env): AnalyticsPipelineSnapshot {
  const config = resolveAnalyticsPipelineConfig(env);
  const alerts = [...config.alerts];
  if (analyticsPipelineCounters.flushFailuresTotal > 0) {
    alerts.push(`analytics flush failures recorded=${analyticsPipelineCounters.flushFailuresTotal}`);
  }

  return {
    status: alerts.length > 0 ? "warn" : "ok",
    sink: config.sink,
    endpoint: config.endpoint,
    buffering: {
      pendingEvents: pendingEvents.length,
      flushSize: ANALYTICS_BUFFER_FLUSH_SIZE,
      flushDelayMs: ANALYTICS_BUFFER_FLUSH_DELAY_MS
    },
    warehouse: {
      dataset: config.warehouseDataset,
      eventsTable: config.warehouseEventsTable,
      rawBucket: config.warehouseRawBucket,
      retentionDays: config.retentionDays,
      deletionWorkflow: config.deletionWorkflow
    },
    delivery: {
      ingestedEventsTotal: analyticsPipelineCounters.ingestedEventsTotal,
      flushedEventsTotal: analyticsPipelineCounters.flushedEventsTotal,
      flushBatchesTotal: analyticsPipelineCounters.flushBatchesTotal,
      flushFailuresTotal: analyticsPipelineCounters.flushFailuresTotal,
      lastFlushAt: analyticsPipelineCounters.lastFlushAt,
      lastErrorAt: analyticsPipelineCounters.lastErrorAt,
      lastErrorMessage: analyticsPipelineCounters.lastErrorMessage,
      events: buildAnalyticsPipelineEventsSummary()
    },
    alerts
  };
}

export function renderAnalyticsPipelineSnapshotText(snapshot: AnalyticsPipelineSnapshot): string {
  const parts = [
    `analytics_pipeline status=${snapshot.status}`,
    `sink=${snapshot.sink}`,
    `pending=${snapshot.buffering.pendingEvents}`,
    `ingested=${snapshot.delivery.ingestedEventsTotal}`,
    `flushed=${snapshot.delivery.flushedEventsTotal}`,
    `failures=${snapshot.delivery.flushFailuresTotal}`,
    `dataset=${snapshot.warehouse.dataset}.${snapshot.warehouse.eventsTable}`,
    `retention_days=${snapshot.warehouse.retentionDays}`,
    `deletion_workflow=${snapshot.warehouse.deletionWorkflow}`
  ];
  return `${parts.join(" | ")}\n`;
}

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
  capturedAnalyticsEvents = [];
  emittedAnalyticsAlerts.clear();
  if (flushTimer) {
    analyticsRuntimeDependencies.clearTimeout(flushTimer);
  }
  flushTimer = null;
  analyticsPipelineCounters.ingestedEventsTotal = 0;
  analyticsPipelineCounters.flushedEventsTotal = 0;
  analyticsPipelineCounters.flushBatchesTotal = 0;
  analyticsPipelineCounters.flushFailuresTotal = 0;
  analyticsPipelineCounters.lastFlushAt = null;
  analyticsPipelineCounters.lastErrorAt = null;
  analyticsPipelineCounters.lastErrorMessage = null;
  analyticsPipelineCounters.ingestedByKey.clear();
  analyticsPipelineCounters.flushedByKey.clear();
}

export function resetCapturedAnalyticsEventsForTest(): void {
  capturedAnalyticsEvents = [];
}

export function getCapturedAnalyticsEventsForTest(): AnalyticsEvent[] {
  return capturedAnalyticsEvents.map((event) => structuredClone(event));
}

async function flushEvents(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (pendingEvents.length === 0) {
    return;
  }

  const config = resolveAnalyticsPipelineConfig(env);
  emitAnalyticsAlerts(config);
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

  if (config.sink === "stdout" || !config.endpoint) {
    analyticsRuntimeDependencies.log(`[Analytics] ${JSON.stringify(envelope)}`);
    recordFlushedEvents(batch);
    return;
  }

  try {
    const response = await analyticsRuntimeDependencies.fetch(config.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify(envelope)
    });

    if (!response.ok) {
      const message = `[Analytics] Failed to flush analytics batch: ${response.status}`;
      analyticsRuntimeDependencies.error(message);
      recordFlushFailure(message);
      pendingEvents = [...batch, ...pendingEvents];
      scheduleFlush(env);
      return;
    }
    recordFlushedEvents(batch);
  } catch (error) {
    const message = "[Analytics] Failed to flush analytics batch";
    analyticsRuntimeDependencies.error(message, error);
    recordFlushFailure(message);
    pendingEvents = [...batch, ...pendingEvents];
    scheduleFlush(env);
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
  recordIngestedEvents([event]);
  scheduleFlush(env);
  return event;
}

export function flushAnalyticsEventsForTest(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  return flushEvents(env);
}

export function registerAnalyticsRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
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

  app.get("/api/test/analytics/events", async (_request, response) => {
    sendJson(response, 200, {
      events: getCapturedAnalyticsEventsForTest()
    });
  });

  app.post("/api/analytics/events", async (request, response) => {
    try {
      const payload = await readJsonBody(request);
      const config = resolveAnalyticsPipelineConfig();
      emitAnalyticsAlerts(config);
      const events = Array.isArray((payload as { events?: unknown[] } | null)?.events)
        ? ((payload as { events: AnalyticsEvent[] }).events ?? [])
        : [];
      capturedAnalyticsEvents.push(...events);
      pendingEvents.push(...events);
      recordIngestedEvents(events);
      scheduleFlush();
      analyticsRuntimeDependencies.log(`[Analytics] accepted ${events.length} event(s) into ${config.sink} sink`);
      sendJson(response, 202, {
        accepted: events.length
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
