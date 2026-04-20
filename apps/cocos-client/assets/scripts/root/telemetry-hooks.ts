import type { CocosPlayerAccountProfile } from "../cocos-lobby.ts";
import type { AssetLoadFailureEvent } from "../cocos-asset-load-resilience.ts";
import type { ShopProduct } from "../cocos-shop-panel.ts";
import {
  appendPrimaryClientTelemetry,
  emitClientAnalyticsEvent,
  type ClientAnalyticsContext
} from "../cocos-primary-client-telemetry.ts";
import type { PrimaryClientTelemetryEvent } from "../project-shared/runtime-diagnostics.ts";
import type { StructuredErrorCode } from "../project-shared/error-codes.ts";
import type { GlobalErrorBoundaryEvent } from "./types";

type RootTelemetryEventName =
  | "session_start"
  | "battle_start"
  | "battle_end"
  | "mission_started"
  | "quest_complete"
  | "tutorial_step"
  | "experiment_exposure"
  | "shop_open"
  | "purchase_initiated"
  | "purchase_attempt"
  | "asset_load_failed"
  | "client_perf_degraded"
  | "client_runtime_error";

type VeilRootTelemetryState = any;

export function emitPrimaryClientTelemetryForRoot(
  state: VeilRootTelemetryState,
  event: PrimaryClientTelemetryEvent | PrimaryClientTelemetryEvent[] | null
): void {
  state.primaryClientTelemetry = appendPrimaryClientTelemetry(state.primaryClientTelemetry, event);
}

export function ensureAnalyticsSessionIdForRoot(state: VeilRootTelemetryState): string {
  if (!state.analyticsSessionId) {
    state.analyticsSessionId = `cocos-session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return state.analyticsSessionId;
}

export function createClientAnalyticsContextForRoot(
  state: VeilRootTelemetryState,
  roomId = state.roomId
): ClientAnalyticsContext {
  return {
    remoteUrl: state.remoteUrl,
    playerId: state.playerId,
    sessionId: ensureAnalyticsSessionIdForRoot(state),
    roomId,
    platform: "wechat"
  };
}

export function trackClientAnalyticsEventForRoot(
  state: VeilRootTelemetryState,
  name: RootTelemetryEventName,
  payload: Record<string, unknown>,
  roomId = state.roomId
): void {
  emitClientAnalyticsEvent(name, createClientAnalyticsContextForRoot(state, roomId), payload as never);
}

export function trackAssetLoadFailureAnalyticsForRoot(
  state: VeilRootTelemetryState,
  event: AssetLoadFailureEvent
): void {
  trackClientAnalyticsEventForRoot(state, "asset_load_failed", {
    assetType: event.assetType,
    assetPath: event.assetPath,
    retryCount: event.retryCount,
    critical: event.critical,
    finalFailure: event.finalFailure,
    errorMessage: event.errorMessage
  });
}

export function handleAssetLoadFailureForRoot(
  state: VeilRootTelemetryState,
  event: AssetLoadFailureEvent
): void {
  if (!event.finalFailure || !event.critical) {
    return;
  }

  const noticeKey = `${event.assetType}:${event.assetPath}`;
  if (state.lastAssetFailureNoticeKey === noticeKey) {
    return;
  }

  state.lastAssetFailureNoticeKey = noticeKey;
  state.achievementNotice = {
    eventId: noticeKey,
    title: "资源加载异常",
    detail: "部分资源加载失败，建议重新进入游戏",
    expiresAt: Date.now() + 6000
  };
  state.pushLog(`资源加载失败：${event.assetPath}（已重试 ${event.retryCount} 次）`);
  state.renderView();
}

export function reportClientRuntimeErrorForRoot(
  state: VeilRootTelemetryState,
  input: {
    errorCode: StructuredErrorCode | "session_disconnect" | "client_error_boundary_triggered";
    severity: "error" | "fatal";
    stage: string;
    recoverable: boolean;
    message: string;
    detail?: string;
    roomId?: string | null;
  }
): void {
  trackClientAnalyticsEventForRoot(
    state,
    "client_runtime_error",
    {
      errorCode: input.errorCode,
      severity: input.severity,
      stage: input.stage,
      recoverable: input.recoverable,
      message: input.message,
      ...(input.detail ? { detail: input.detail } : {})
    },
    input.roomId ?? state.roomId
  );
}

export function maybeReportSessionRuntimeErrorForRoot(
  state: VeilRootTelemetryState,
  error: unknown,
  stage: string
): void {
  if (!(error instanceof Error)) {
    return;
  }

  if (error.message === "persistence_save_failed") {
    reportClientRuntimeErrorForRoot(state, {
      errorCode: "persistence_save_failed",
      severity: "error",
      stage,
      recoverable: false,
      message: "Server persistence failed while applying a session action."
    });
    return;
  }

  if (
    error.message === "room_left" ||
    error.message === "session_unavailable" ||
    error.message === "connect_failed" ||
    error.message === "connect_timeout"
  ) {
    reportClientRuntimeErrorForRoot(state, {
      errorCode: "session_disconnect",
      severity: "error",
      stage,
      recoverable: true,
      message: error.message
    });
  }
}

export function bindGlobalErrorBoundaryForRoot(
  state: VeilRootTelemetryState
): (() => void) | null {
  const runtime = globalThis as typeof globalThis & {
    addEventListener?: ((type: string, listener: (event: GlobalErrorBoundaryEvent) => void) => void) | undefined;
    removeEventListener?: ((type: string, listener: (event: GlobalErrorBoundaryEvent) => void) => void) | undefined;
  };
  if (typeof runtime.addEventListener !== "function" || typeof runtime.removeEventListener !== "function") {
    return null;
  }

  const handleGlobalFailure = (event: GlobalErrorBoundaryEvent): void => {
    const reason = event.error ?? event.reason;
    const message =
      typeof event.message === "string" && event.message.trim().length > 0
        ? event.message
        : reason instanceof Error
          ? reason.message
          : String(reason ?? "unknown_client_error");
    reportClientRuntimeErrorForRoot(state, {
      errorCode: "client_error_boundary_triggered",
      severity: "fatal",
      stage: "global",
      recoverable: false,
      message,
      ...(reason instanceof Error && reason.stack ? { detail: reason.stack } : {})
    });
    state.pushLog(`客户端异常：${message}`);
    state.renderView();
  };

  runtime.addEventListener("error", handleGlobalFailure);
  runtime.addEventListener("unhandledrejection", handleGlobalFailure);

  return () => {
    runtime.removeEventListener?.("error", handleGlobalFailure);
    runtime.removeEventListener?.("unhandledrejection", handleGlobalFailure);
  };
}

export function createTelemetryContextForRoot(
  state: VeilRootTelemetryState,
  heroId?: string | null
): { roomId: string; playerId: string; heroId?: string } {
  return {
    roomId: state.roomId,
    playerId: state.playerId,
    ...(heroId ? { heroId } : {})
  };
}

export function maybeEmitShopOpenAnalyticsForRoot(state: VeilRootTelemetryState): void {
  if (!state.showLobby || state.lobbyShopProducts.length === 0) {
    return;
  }

  const sessionId = ensureAnalyticsSessionIdForRoot(state);
  if (state.emittedShopOpenSessionId === sessionId) {
    return;
  }

  state.emittedShopOpenSessionId = sessionId;
  trackClientAnalyticsEventForRoot(state, "shop_open", {
    roomId: state.roomId,
    surface: "lobby"
  });
}

export function maybeEmitExperimentExposureAnalyticsForRoot(
  state: VeilRootTelemetryState,
  profile: CocosPlayerAccountProfile
): void {
  const experiments = (profile as CocosPlayerAccountProfile & {
    experiments?: Array<{
      experimentKey: string;
      experimentName: string;
      owner: string;
      bucket: number;
      variant: string;
    }>;
  }).experiments ?? [];

  for (const experiment of experiments) {
    if (state.emittedExperimentExposureKeys.has(experiment.experimentKey)) {
      continue;
    }

    state.emittedExperimentExposureKeys.add(experiment.experimentKey);
    trackClientAnalyticsEventForRoot(
      state,
      "experiment_exposure",
      {
        experimentKey: experiment.experimentKey,
        experimentName: experiment.experimentName,
        variant: experiment.variant,
        bucket: experiment.bucket,
        surface: "player_account_profile",
        owner: experiment.owner
      },
      profile.lastRoomId ?? state.roomId
    );
  }
}

export function maybeEmitQuestCompleteAnalyticsForRoot(
  state: VeilRootTelemetryState,
  previousProfile: CocosPlayerAccountProfile,
  profile: CocosPlayerAccountProfile
): void {
  const previousClaims = new Map(
    (previousProfile.dailyQuestBoard?.quests ?? []).map((quest) => [quest.id, quest.claimed === true] as const)
  );

  for (const quest of profile.dailyQuestBoard?.quests ?? []) {
    if (quest.claimed !== true || previousClaims.get(quest.id) === true) {
      continue;
    }

    trackClientAnalyticsEventForRoot(
      state,
      "quest_complete",
      {
        roomId: profile.lastRoomId ?? state.roomId,
        questId: quest.id,
        reward: quest.reward
      },
      profile.lastRoomId ?? state.roomId
    );
  }
}

export function trackPurchaseInitiatedForRoot(
  state: VeilRootTelemetryState,
  product: ShopProduct,
  surface: "lobby" | "battle_pass"
): void {
  const price = Math.max(0, Math.floor(product.wechatPriceFen ?? product.price ?? 0));
  const payload = {
    roomId: state.roomId,
    productId: product.productId,
    productType: product.type,
    currency: product.wechatPriceFen ? "wechat_fen" : "gems",
    price,
    surface
  };
  trackClientAnalyticsEventForRoot(state, "purchase_initiated", payload);
  trackClientAnalyticsEventForRoot(state, "purchase_attempt", payload);
}
