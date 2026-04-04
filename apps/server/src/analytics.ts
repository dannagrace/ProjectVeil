import {
  createAnalyticsEvent,
  type AnalyticsEvent,
  type AnalyticsEventName
} from "../../../packages/shared/src/index";

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
