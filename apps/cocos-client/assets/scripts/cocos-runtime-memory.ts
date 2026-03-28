export interface CocosRuntimeMemoryMetricsLike {
  usedJSHeapSize?: number | null;
  totalJSHeapSize?: number | null;
  jsHeapSizeLimit?: number | null;
}

export interface CocosRuntimeMemoryPerformanceLike {
  memory?: CocosRuntimeMemoryMetricsLike | null;
}

export interface CocosRuntimeMemoryWechatLike {
  getPerformance?: (() => CocosRuntimeMemoryPerformanceLike | null | undefined) | undefined;
  triggerGC?: (() => void) | undefined;
  onMemoryWarning?: ((callback: (payload?: { level?: number } | null) => void) => void) | undefined;
  offMemoryWarning?: ((callback: (payload?: { level?: number } | null) => void) => void) | undefined;
}

export interface CocosRuntimeMemoryEnvironmentLike {
  performance?: CocosRuntimeMemoryPerformanceLike | null;
  wx?: CocosRuntimeMemoryWechatLike | null;
}

export interface CocosRuntimeAssetUsageLike {
  retainedScopes: string[];
  loadedPaths: string[];
  retainedPaths: string[];
}

export interface CocosRuntimeMemorySnapshot {
  source: "wechat-performance" | "browser-performance" | "unavailable";
  heapUsedBytes: number | null;
  heapTotalBytes: number | null;
  heapLimitBytes: number | null;
  canTriggerGc: boolean;
  canListenMemoryWarning: boolean;
}

export interface CocosRuntimeMemoryWarningEvent {
  level: number | null;
}

function normalizeMemoryMetric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function toMb(bytes: number | null): string | null {
  return bytes == null ? null : `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function readCocosRuntimeMemorySnapshot(
  environment: CocosRuntimeMemoryEnvironmentLike = globalThis as CocosRuntimeMemoryEnvironmentLike
): CocosRuntimeMemorySnapshot {
  const wechatMemory = environment.wx?.getPerformance?.()?.memory ?? null;
  const browserMemory = environment.performance?.memory ?? null;
  const resolved = wechatMemory ?? browserMemory;
  const source = wechatMemory ? "wechat-performance" : browserMemory ? "browser-performance" : "unavailable";

  return {
    source,
    heapUsedBytes: normalizeMemoryMetric(resolved?.usedJSHeapSize),
    heapTotalBytes: normalizeMemoryMetric(resolved?.totalJSHeapSize),
    heapLimitBytes: normalizeMemoryMetric(resolved?.jsHeapSizeLimit),
    canTriggerGc: typeof environment.wx?.triggerGC === "function",
    canListenMemoryWarning: typeof environment.wx?.onMemoryWarning === "function"
  };
}

export function formatCocosRuntimeMemoryStatus(
  snapshot: CocosRuntimeMemorySnapshot,
  assetUsage: CocosRuntimeAssetUsageLike
): string {
  const scopeLabel =
    assetUsage.retainedScopes.length > 0 ? assetUsage.retainedScopes.join("/") : "idle";
  const assetLabel = `资源 ${scopeLabel} · ${assetUsage.loadedPaths.length} 项`;

  if (snapshot.heapUsedBytes != null) {
    const usedMb = toMb(snapshot.heapUsedBytes);
    const limitMb = toMb(snapshot.heapLimitBytes);
    const ratio = snapshot.heapLimitBytes && snapshot.heapLimitBytes > 0 ? snapshot.heapUsedBytes / snapshot.heapLimitBytes : null;
    const pressure = ratio != null && ratio >= 0.85 ? "高压" : ratio != null && ratio >= 0.65 ? "偏高" : "平稳";
    return `内存 ${usedMb}${limitMb ? ` / ${limitMb}` : ""} · ${pressure} · ${assetLabel}${snapshot.canTriggerGc ? " · 支持 GC" : ""}`;
  }

  const sourceLabel =
    snapshot.source === "wechat-performance"
      ? "小游戏性能接口"
      : snapshot.source === "browser-performance"
        ? "浏览器性能接口"
        : "当前运行时未暴露堆内存指标";
  return `内存 ${sourceLabel} · ${assetLabel}${snapshot.canListenMemoryWarning ? " · 支持告警" : ""}${snapshot.canTriggerGc ? " · 支持 GC" : ""}`;
}

export function triggerCocosRuntimeGc(
  environment: CocosRuntimeMemoryEnvironmentLike = globalThis as CocosRuntimeMemoryEnvironmentLike
): boolean {
  if (typeof environment.wx?.triggerGC !== "function") {
    return false;
  }

  environment.wx.triggerGC();
  return true;
}

export function bindCocosRuntimeMemoryWarning(
  callback: (event: CocosRuntimeMemoryWarningEvent) => void,
  environment: CocosRuntimeMemoryEnvironmentLike = globalThis as CocosRuntimeMemoryEnvironmentLike
): () => void {
  if (typeof environment.wx?.onMemoryWarning !== "function") {
    return () => undefined;
  }

  const handler = (payload?: { level?: number } | null) => {
    callback({
      level: typeof payload?.level === "number" ? payload.level : null
    });
  };

  environment.wx.onMemoryWarning(handler);
  return () => {
    environment.wx?.offMemoryWarning?.(handler);
  };
}
