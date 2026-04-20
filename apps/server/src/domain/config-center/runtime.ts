import type { BattleBalanceConfig, BattleSkillCatalogConfig, MapObjectsConfig, UnitCatalogConfig, WorldGenerationConfig } from "@veil/shared/models";
import { getBattleBalanceConfig, getDefaultBattleBalanceConfig, getDefaultBattleSkillCatalog, getDefaultMapObjectsConfig, getDefaultUnitCatalog, getDefaultWorldConfig, replaceRuntimeConfigs, type RuntimeConfigBundle, validateBattleBalanceConfig, validateBattleSkillCatalog, validateMapObjectsConfig, validateUnitCatalog, validateWorldConfig } from "@veil/shared/world";
import { countRuntimeErrorEventsSince, recordRuntimeErrorEvent } from "../../observability";
import { captureServerError } from "../../error-monitoring";
import { parseLeaderboardTierThresholdsConfigDocument, validateLeaderboardTierThresholdsConfigDocument, type LeaderboardTierThresholdsConfigDocument } from "../../leaderboard-tier-thresholds";
import type {
  ConfigDocumentId,
  ConfigPublishEventSummary,
  RuntimeConfigDocumentId
} from "./types";
import type {
  ConfigCenterRuntimeDependencies,
  ConfigCenterTimerHandle,
  ConfigHotReloadRoomState,
  ConfigHotReloadRuntimeSnapshot,
  ConfigRollbackMonitorState,
  ConfigRuntimeApplyResult,
  PendingRuntimeBundleState
} from "./constants";
import {
  CONFIG_HOT_RELOAD_ERROR_THRESHOLD,
  DEFAULT_CONFIG_HOT_RELOAD_MONITOR_WINDOW_MS,
  RUNTIME_CONFIG_DOCUMENT_IDS
} from "./constants";
import { normalizeJsonContent } from "./helpers";
import { buildConfigDiffEntries } from "./diff";
import { buildRuntimeBundleWithParsedDocument, contentForDocumentId, parseConfigDocument } from "./preview";

export function buildRuntimeConfigBundle(
  documents: Partial<RuntimeConfigBundle>
): RuntimeConfigBundle {
  const world = documents.world ?? getDefaultWorldConfig();
  const mapObjects = documents.mapObjects ?? getDefaultMapObjectsConfig();
  const units = documents.units ?? getDefaultUnitCatalog();
  const battleSkills = documents.battleSkills ?? getDefaultBattleSkillCatalog();
  const battleBalance = documents.battleBalance ?? getBattleBalanceConfig();

  validateWorldConfig(world);
  validateMapObjectsConfig(mapObjects, world, units);
  validateBattleSkillCatalog(battleSkills);
  validateUnitCatalog(units, battleSkills);
  validateBattleBalanceConfig(battleBalance, battleSkills);

  return {
    world,
    mapObjects,
    units,
    battleSkills,
    battleBalance
  };
}

const configUpdateListeners = new Set<(bundle: RuntimeConfigBundle) => void>();
const defaultConfigCenterRuntimeDependencies: ConfigCenterRuntimeDependencies = {
  now: () => Date.now(),
  setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
};

let configCenterRuntimeDependencies = defaultConfigCenterRuntimeDependencies;
let configHotReloadRuntimeSnapshotProvider: () => ConfigHotReloadRuntimeSnapshot = () => ({
  rooms: [],
  activeBattleCount: 0
});
let appliedRuntimeBundle: RuntimeConfigBundle | null = null;
let pendingRuntimeBundleState: PendingRuntimeBundleState | null = null;
let configRollbackMonitorState: ConfigRollbackMonitorState | null = null;
let lastConfigRuntimeApplyResult: ConfigRuntimeApplyResult | null = null;

export function initializeAppliedRuntimeBundle(bundle: RuntimeConfigBundle): void {
  pendingRuntimeBundleState = null;
  appliedRuntimeBundle = bundle;
  replaceRuntimeConfigs(bundle);
  notifyConfigUpdateListeners(bundle);
  lastConfigRuntimeApplyResult = {
    status: "applied",
    message: "运行时配置已初始化。"
  };
}

export function serializeBundleDocument(bundle: RuntimeConfigBundle, id: RuntimeConfigDocumentId): string {
  return normalizeJsonContent(contentForDocumentId(bundle, id));
}

export function runtimeRoomsWithActiveBattles(): ConfigHotReloadRoomState[] {
  const snapshot = configHotReloadRuntimeSnapshotProvider();
  return snapshot.rooms.filter((room) => room.activeBattles > 0);
}

export function readConfigRollbackWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number(env.CONFIG_ROLLBACK_WINDOW_MS?.trim());
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_CONFIG_HOT_RELOAD_MONITOR_WINDOW_MS;
  }

  return Math.floor(parsed);
}

export function clearConfigRollbackMonitor(): void {
  if (!configRollbackMonitorState) {
    return;
  }

  configCenterRuntimeDependencies.clearTimeout(configRollbackMonitorState.handle);
  configRollbackMonitorState = null;
}

export function notifyConfigUpdateListeners(bundle: RuntimeConfigBundle): void {
  for (const listener of configUpdateListeners) {
    try {
      listener(bundle);
    } catch (error) {
      console.error("[config-center] Error notifying config update listener", error);
    }
  }
}

export function rollbackRuntimeBundleIfNeeded(): void {
  if (!configRollbackMonitorState) {
    return;
  }

  const monitor = configRollbackMonitorState;
  configRollbackMonitorState = null;
  const recentErrorCount = countRuntimeErrorEventsSince(monitor.appliedAtMs, {
    ownerArea: "multiplayer",
    severity: "error"
  });
  if (recentErrorCount < CONFIG_HOT_RELOAD_ERROR_THRESHOLD) {
    return;
  }

  pendingRuntimeBundleState = null;
  appliedRuntimeBundle = monitor.previousBundle;
  replaceRuntimeConfigs(monitor.previousBundle);
  notifyConfigUpdateListeners(monitor.previousBundle);
  lastConfigRuntimeApplyResult = {
    status: "applied",
    message: `热更新后 ${monitor.windowMs} ms 内捕获 ${recentErrorCount} 个房间错误，已自动回滚到上一版本。`
  };
  console.error("[config-center] Rolled back config hot reload after runtime error spike", {
    appliedAt: monitor.appliedAt,
    recentErrorCount
  });
  recordRuntimeErrorEvent({
    id: `config-hotload-${monitor.appliedAt}`,
    recordedAt: new Date().toISOString(),
    source: "server",
    surface: "config-center",
    candidateRevision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || null,
    featureArea: "runtime",
    ownerArea: "config",
    severity: "error",
    errorCode: "config_hotload_failed",
    message: "Runtime config hot reload was rolled back after a room error spike.",
    tags: ["config-center", "hot-reload"],
    context: {
      roomId: null,
      playerId: null,
      requestId: null,
      route: "/api/config-center/configs",
      action: "config.hot_reload",
      statusCode: null,
      crash: false,
      detail: `appliedAt=${monitor.appliedAt} recentErrorCount=${recentErrorCount}`
    }
  });
  void captureServerError({
    errorCode: "config_hotload_failed",
    message: "Runtime config hot reload was rolled back after a room error spike.",
    severity: "error",
    featureArea: "runtime",
    ownerArea: "config",
    surface: "config-center",
    tags: ["config-center", "hot-reload"],
    context: {
      route: "/api/config-center/configs",
      action: "config.hot_reload",
      detail: `appliedAt=${monitor.appliedAt} recentErrorCount=${recentErrorCount}`
    }
  });
}

export function startConfigRollbackMonitor(previousBundle: RuntimeConfigBundle | null): void {
  clearConfigRollbackMonitor();
  if (!previousBundle) {
    return;
  }

  const appliedAtMs = configCenterRuntimeDependencies.now();
  const windowMs = readConfigRollbackWindowMs();
  const handle = configCenterRuntimeDependencies.setTimeout(
    () => rollbackRuntimeBundleIfNeeded(),
    windowMs
  );
  handle.unref?.();
  configRollbackMonitorState = {
    previousBundle,
    appliedAtMs,
    appliedAt: new Date(appliedAtMs).toISOString(),
    windowMs,
    handle
  };
}

export function assertRuntimeBundleHotReloadCompatible(bundle: RuntimeConfigBundle): void {
  if (!appliedRuntimeBundle) {
    return;
  }

  const currentBundle = appliedRuntimeBundle;
  const incompatibleEntries = RUNTIME_CONFIG_DOCUMENT_IDS
    .flatMap((documentId) =>
      buildConfigDiffEntries(
        documentId,
        serializeBundleDocument(currentBundle, documentId),
        serializeBundleDocument(bundle, documentId)
      )
        .filter((entry) => ["field_removed", "type_changed", "enum_changed"].includes(entry.kind))
        .map((entry) => ({ documentId, entry }))
    );

  if (incompatibleEntries.length === 0) {
    return;
  }

  const summary = incompatibleEntries
    .slice(0, 3)
    .map(({ documentId, entry }) => `${documentId}.${entry.path} (${entry.kind})`)
    .join("、");
  throw new Error(`配置热更新被拒绝：检测到不兼容的 Schema 变更：${summary}`);
}

export function applyRuntimeBundle(bundle: RuntimeConfigBundle): ConfigRuntimeApplyResult {
  const roomsWithActiveBattles = runtimeRoomsWithActiveBattles();
  if (roomsWithActiveBattles.length > 0) {
    pendingRuntimeBundleState = {
      bundle,
      queuedAt: new Date(configCenterRuntimeDependencies.now()).toISOString(),
      previousBundle: appliedRuntimeBundle,
      delayedRooms: roomsWithActiveBattles
    };
    clearConfigRollbackMonitor();
    lastConfigRuntimeApplyResult = {
      status: "pending",
      message: `检测到 ${roomsWithActiveBattles.length} 个进行中房间，配置已延迟到战斗结束后应用。`
    };
    return lastConfigRuntimeApplyResult;
  }

  pendingRuntimeBundleState = null;
  const previousBundle = appliedRuntimeBundle;
  appliedRuntimeBundle = bundle;
  replaceRuntimeConfigs(bundle);
  notifyConfigUpdateListeners(bundle);
  startConfigRollbackMonitor(previousBundle);
  lastConfigRuntimeApplyResult = {
    status: "applied",
    message: "运行时配置已刷新。"
  };
  return lastConfigRuntimeApplyResult;
}

export function registerConfigUpdateListener(
  callback: (bundle: RuntimeConfigBundle) => void
): () => void {
  configUpdateListeners.add(callback);
  return () => {
    configUpdateListeners.delete(callback);
  };
}

export function configureConfigRuntimeStatusProvider(provider: () => ConfigHotReloadRuntimeSnapshot): void {
  configHotReloadRuntimeSnapshotProvider = provider;
}

export function configureConfigCenterRuntimeDependencies(overrides: Partial<ConfigCenterRuntimeDependencies>): void {
  configCenterRuntimeDependencies = {
    ...configCenterRuntimeDependencies,
    ...overrides
  };
}

export function resetConfigCenterRuntimeDependencies(): void {
  clearConfigRollbackMonitor();
  configCenterRuntimeDependencies = defaultConfigCenterRuntimeDependencies;
}

export function resetConfigHotReloadState(): void {
  clearConfigRollbackMonitor();
  pendingRuntimeBundleState = null;
  appliedRuntimeBundle = null;
  lastConfigRuntimeApplyResult = null;
}

export function flushPendingConfigUpdate(): ConfigRuntimeApplyResult | null {
  if (!pendingRuntimeBundleState) {
    return null;
  }

  if (runtimeRoomsWithActiveBattles().length > 0) {
    return lastConfigRuntimeApplyResult;
  }

  const pendingBundle = pendingRuntimeBundleState.bundle;
  pendingRuntimeBundleState = null;
  return applyRuntimeBundle(pendingBundle);
}

export function synchronizePendingRuntimeBundle(bundle: RuntimeConfigBundle): void {
  if (!pendingRuntimeBundleState) {
    return;
  }

  pendingRuntimeBundleState.bundle = bundle;
}

export function currentConfigRuntimeApplyResult(): ConfigRuntimeApplyResult | null {
  return lastConfigRuntimeApplyResult;
}

