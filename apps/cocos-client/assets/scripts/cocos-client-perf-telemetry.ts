export const CLIENT_PERF_FPS_THRESHOLD = 20;
export const CLIENT_PERF_MEMORY_RATIO_THRESHOLD = 0.8;
export const CLIENT_PERF_LOW_FPS_WINDOW_MS = 5_000;
export const CLIENT_PERF_THROTTLE_MS = 60_000;

interface ClientPerfFrameSample {
  atMs: number;
  deltaMs: number;
}

export interface ClientPerfTelemetryMonitorState {
  frameSamples: ClientPerfFrameSample[];
  lowFpsSinceMs: number | null;
  lastEmittedAtMs: number | null;
}

export interface ClientPerfRuntimeMetadata {
  deviceModel: string;
  wechatVersion: string;
}

export interface ClientPerfDegradedPayload extends Record<string, unknown> {
  reason: "fps" | "memory" | "fps_and_memory";
  fpsAvg: number;
  latencyMsAvg: number;
  memoryUsageRatio: number;
  deviceModel: string;
  wechatVersion: string;
}

interface EvaluateClientPerfTelemetryOptions {
  nowMs: number;
  memoryUsageRatio: number | null;
  metadata: ClientPerfRuntimeMetadata;
}

interface WechatSystemInfoLike {
  model?: unknown;
  version?: unknown;
}

interface WechatPerfTelemetryRuntimeLike {
  getSystemInfoSync?: (() => WechatSystemInfoLike | null | undefined) | undefined;
}

function roundToTenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function clampRatio(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.min(value, 1);
}

function pruneSamples(state: ClientPerfTelemetryMonitorState, nowMs: number): void {
  const windowStartMs = nowMs - CLIENT_PERF_LOW_FPS_WINDOW_MS;
  state.frameSamples = state.frameSamples.filter((sample) => sample.atMs >= windowStartMs);
}

function summarizeSamples(state: ClientPerfTelemetryMonitorState): { fpsAvg: number; latencyMsAvg: number } | null {
  if (state.frameSamples.length === 0) {
    return null;
  }

  const totalFrameTimeMs = state.frameSamples.reduce((sum, sample) => sum + sample.deltaMs, 0);
  if (totalFrameTimeMs <= 0) {
    return null;
  }

  const latencyMsAvg = totalFrameTimeMs / state.frameSamples.length;
  const fpsAvg = 1000 / latencyMsAvg;
  return {
    fpsAvg: roundToTenths(fpsAvg),
    latencyMsAvg: roundToTenths(latencyMsAvg)
  };
}

export function createClientPerfTelemetryMonitorState(): ClientPerfTelemetryMonitorState {
  return {
    frameSamples: [],
    lowFpsSinceMs: null,
    lastEmittedAtMs: null
  };
}

export function recordClientPerfFrame(
  state: ClientPerfTelemetryMonitorState,
  deltaSeconds: number,
  nowMs: number
): void {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
    return;
  }

  state.frameSamples.push({
    atMs: nowMs,
    deltaMs: deltaSeconds * 1000
  });
  pruneSamples(state, nowMs);
}

export function evaluateClientPerfTelemetry(
  state: ClientPerfTelemetryMonitorState,
  options: EvaluateClientPerfTelemetryOptions
): ClientPerfDegradedPayload | null {
  pruneSamples(state, options.nowMs);
  const summary = summarizeSamples(state);
  if (!summary) {
    state.lowFpsSinceMs = null;
    return null;
  }

  const memoryUsageRatio = clampRatio(options.memoryUsageRatio);
  const lowFps = summary.fpsAvg < CLIENT_PERF_FPS_THRESHOLD;
  const memoryHigh = memoryUsageRatio != null && memoryUsageRatio >= CLIENT_PERF_MEMORY_RATIO_THRESHOLD;

  if (lowFps) {
    state.lowFpsSinceMs ??= state.frameSamples[0]?.atMs ?? options.nowMs;
  } else {
    state.lowFpsSinceMs = null;
  }

  const sustainedLowFps =
    lowFps && state.lowFpsSinceMs != null && options.nowMs - state.lowFpsSinceMs >= CLIENT_PERF_LOW_FPS_WINDOW_MS;
  const reason = sustainedLowFps && memoryHigh ? "fps_and_memory" : sustainedLowFps ? "fps" : memoryHigh ? "memory" : null;

  if (!reason) {
    return null;
  }

  if (state.lastEmittedAtMs != null && options.nowMs - state.lastEmittedAtMs < CLIENT_PERF_THROTTLE_MS) {
    return null;
  }

  state.lastEmittedAtMs = options.nowMs;
  return {
    reason,
    fpsAvg: summary.fpsAvg,
    latencyMsAvg: summary.latencyMsAvg,
    memoryUsageRatio: roundToTenths((memoryUsageRatio ?? 0) * 100) / 100,
    deviceModel: options.metadata.deviceModel,
    wechatVersion: options.metadata.wechatVersion
  };
}

export function readClientPerfRuntimeMetadata(
  environment: { wx?: WechatPerfTelemetryRuntimeLike | null } = globalThis as { wx?: WechatPerfTelemetryRuntimeLike | null }
): ClientPerfRuntimeMetadata {
  const systemInfo = environment.wx?.getSystemInfoSync?.() ?? null;
  return {
    deviceModel: normalizeString(systemInfo?.model) ?? "unknown",
    wechatVersion: normalizeString(systemInfo?.version) ?? "unknown"
  };
}
