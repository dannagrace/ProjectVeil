import type { IncomingMessage, ServerResponse } from "node:http";
import {
  buildRuntimeDiagnosticsErrorEvent,
  renderRuntimeDiagnosticsSnapshotText,
  summarizeRuntimeDiagnosticsErrors,
  type FeatureFlagAuditEntry,
  type FeatureFlagKey,
  type FeatureFlagRolloutPolicy,
  type ReconnectFailureReason,
  type RuntimeDiagnosticsErrorEvent,
  type RuntimeDiagnosticsSnapshot
} from "../../../packages/shared/src/index";
import { getFeatureFlagRuntimeSnapshot, listFeatureFlagRuntimeSummaries } from "./feature-flags";
import type { LeaderboardAlertEvent } from "./leaderboard-anti-abuse";
import {
  getAnalyticsPipelineSnapshot,
  renderAnalyticsPipelineSnapshotText,
  resetCapturedAnalyticsEventsForTest
} from "./analytics";
import { getMySqlPoolMetricsSnapshot, resetTrackedMySqlPools } from "./mysql-pool";
import { resetGuestAuthSessions } from "./auth";
import { configureAuthoritativeRoomTelemetry } from "./index";
import { readRuntimeSecret } from "./runtime-secrets";

export interface RuntimeRoomSnapshot {
  roomId: string;
  day: number | null;
  connectedPlayers: number;
  heroCount: number;
  activeBattles: number;
  updatedAt: string;
}

interface RuntimeObservabilityCounters {
  connectMessagesTotal: number;
  worldActionsTotal: number;
  battleActionsTotal: number;
  websocketActionRateLimitedTotal: number;
  websocketActionKickTotal: number;
  socialFriendLeaderboardRequestsTotal: number;
  socialShareActivityRequestsTotal: number;
}

interface AuthObservabilityCounters {
  sessionChecksTotal: number;
  sessionFailuresTotal: number;
  guestLoginsTotal: number;
  accountLoginsTotal: number;
  accountBindingsTotal: number;
  accountRegistrationsTotal: number;
  refreshesTotal: number;
  logoutsTotal: number;
  rateLimitedTotal: number;
  credentialStuffingBlockedTotal: number;
  invalidCredentialsTotal: number;
  tokenDeliveryRequestsTotal: number;
  tokenDeliverySuccessesTotal: number;
  tokenDeliveryFailuresTotal: number;
  tokenDeliveryRetriesTotal: number;
  tokenDeliveryDeadLettersTotal: number;
}

interface MatchmakingObservabilityCounters {
  rateLimitedTotal: number;
  queueDepth: number;
}

interface LeaderboardAbuseObservabilityCounters {
  alertsTotal: number;
}

interface AntiCheatObservabilityCounters {
  alertsTotal: number;
}

interface PaymentGrantObservabilityCounters {
  retriesTotal: number;
  deadLetterTotal: number;
}

type ActionValidationScope = "world" | "battle";

export interface AntiCheatAlertEvent {
  roomId: string;
  playerId: string;
  sessionId: string;
  scope: ActionValidationScope;
  actionType: string;
  reason: string;
  rejectionCount: number;
  windowMs: number;
  recordedAt: string;
}

interface HistogramMetricState {
  buckets: number[];
  bucketCounts: number[];
  count: number;
  sum: number;
}

type AuthSessionFailureReason =
  | "unauthorized"
  | "token_expired"
  | "token_kind_invalid"
  | "session_revoked"
  | "account_banned";
type AuthTokenDeliveryFailureReason =
  | "misconfigured"
  | "timeout"
  | "network"
  | "smtp_4xx"
  | "smtp_5xx"
  | "smtp_protocol"
  | "webhook_4xx"
  | "webhook_429"
  | "webhook_5xx";
type AuthTokenDeliveryAttemptStatus = "disabled" | "dev-token" | "delivered" | "retry_scheduled" | "dead-lettered";

interface AuthTokenDeliveryAttemptLogEntry {
  timestamp: string;
  kind: "account-registration" | "password-recovery";
  loginId: string;
  deliveryMode: "disabled" | "dev-token" | "smtp" | "webhook";
  status: AuthTokenDeliveryAttemptStatus;
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
  message: string;
  failureReason?: AuthTokenDeliveryFailureReason;
  statusCode?: number;
  nextAttemptAt?: string;
}

interface AuthObservabilityState {
  counters: AuthObservabilityCounters;
  activeGuestSessionCount: number;
  activeAccountSessions: Map<string, { playerId: string; provider: string }>;
  activeAccountLockCount: number;
  activeCredentialStuffingSourceCount: number;
  pendingRegistrationCount: number;
  pendingRecoveryCount: number;
  sessionFailureReasons: Record<AuthSessionFailureReason, number>;
  tokenDeliveryQueueCount: number;
  tokenDeliveryDeadLetterCount: number;
  tokenDeliveryOldestQueuedLatencyMs: number | null;
  tokenDeliveryNextAttemptDelayMs: number | null;
  tokenDeliveryFailureReasons: Record<AuthTokenDeliveryFailureReason, number>;
  tokenDeliveryRecentAttempts: AuthTokenDeliveryAttemptLogEntry[];
}

interface ReconnectObservabilityCounters {
  attemptsTotal: number;
  successesTotal: number;
  failuresTotal: number;
}

interface RoomLifecycleObservabilityCounters {
  roomCreatesTotal: number;
  roomDisposalsTotal: number;
  battleCompletionsTotal: number;
  battleAbortsTotal: number;
}

interface HttpObservabilityCounters {
  rateLimitedTotal: number;
}

type RoomLifecycleEventKind =
  | "room.created"
  | "room.disposed"
  | "reconnect.succeeded"
  | "reconnect.failed"
  | "battle.completed"
  | "battle.aborted";

export interface RoomLifecycleEvent {
  timestamp: string;
  kind: RoomLifecycleEventKind;
  roomId: string;
  playerId?: string;
  battleId?: string;
  reason?: string;
  failureReason?: ReconnectFailureReason;
}

interface RuntimeObservabilityState {
  startedAt: number;
  rooms: Map<string, RuntimeRoomSnapshot>;
  errorEvents: RuntimeDiagnosticsErrorEvent[];
  counters: RuntimeObservabilityCounters;
  prometheus: {
    configCenterStoreType: 0 | 1;
    dbBackupLastSuccessTimestamp: number | null;
    battleDurationSeconds: HistogramMetricState;
    httpRequestDurationSeconds: HistogramMetricState;
    actionValidationFailuresTotal: Map<string, number>;
    runtimeErrorEventsTotal: Map<string, number>;
  };
  auth: AuthObservabilityState;
  reconnect: {
    pendingWindowCount: number;
    counters: ReconnectObservabilityCounters;
  };
  roomLifecycle: {
    counters: RoomLifecycleObservabilityCounters;
    recentEvents: RoomLifecycleEvent[];
  };
  http: {
    counters: HttpObservabilityCounters;
  };
  matchmaking: {
    counters: MatchmakingObservabilityCounters;
  };
  leaderboardAbuse: {
    counters: LeaderboardAbuseObservabilityCounters;
    recentAlerts: LeaderboardAlertEvent[];
  };
  antiCheat: {
    counters: AntiCheatObservabilityCounters;
    recentAlerts: AntiCheatAlertEvent[];
  };
  paymentGrant: {
    queueCount: number;
    deadLetterCount: number;
    oldestQueuedLatencyMs: number | null;
    nextAttemptDelayMs: number | null;
    counters: PaymentGrantObservabilityCounters;
  };
}

export interface RuntimePersistenceHealth {
  status: "ok" | "degraded";
  storage: "memory" | "mysql";
  message: string;
}

interface RuntimeHealthPayload {
  status: "ok" | "warn";
  service: string;
  checkedAt: string;
  startedAt: string;
  uptimeSeconds: number;
  runtime: {
    persistence: RuntimePersistenceHealth;
    activeRoomCount: number;
    connectionCount: number;
    activeBattleCount: number;
    heroCount: number;
    gameplayTraffic: {
      connectMessagesTotal: number;
      worldActionsTotal: number;
      battleActionsTotal: number;
      actionMessagesTotal: number;
      websocketActionRateLimitedTotal: number;
      websocketActionKickTotal: number;
      socialFriendLeaderboardRequestsTotal: number;
      socialShareActivityRequestsTotal: number;
    };
    auth: {
      reconnect: {
        pendingWindowCount: number;
        counters: ReconnectObservabilityCounters;
      };
      activeGuestSessionCount: number;
      activeAccountSessionCount: number;
      activeAccountSessionByProvider: Record<string, number>;
      activeAccountLockCount: number;
      activeCredentialStuffingSourceCount: number;
      pendingRegistrationCount: number;
      pendingRecoveryCount: number;
      counters: AuthObservabilityCounters;
      sessionFailureReasons: Record<AuthSessionFailureReason, number>;
      tokenDelivery: {
        queueCount: number;
        deadLetterCount: number;
        oldestQueuedLatencyMs: number | null;
        nextAttemptDelayMs: number | null;
        counters: Pick<
          AuthObservabilityCounters,
          | "tokenDeliveryRequestsTotal"
          | "tokenDeliverySuccessesTotal"
          | "tokenDeliveryFailuresTotal"
          | "tokenDeliveryRetriesTotal"
          | "tokenDeliveryDeadLettersTotal"
        >;
        failureReasons: Record<AuthTokenDeliveryFailureReason, number>;
      };
    };
    roomLifecycle: {
      counters: RoomLifecycleObservabilityCounters;
      recentEventsTracked: number;
    };
    http: {
      counters: HttpObservabilityCounters;
    };
    matchmaking: {
      counters: MatchmakingObservabilityCounters;
    };
    leaderboardAbuse: {
      counters: LeaderboardAbuseObservabilityCounters;
      alertsTracked: number;
    };
    antiCheat: {
      counters: AntiCheatObservabilityCounters;
      alertsTracked: number;
    };
  };
}

interface AuthReadinessPayload {
  status: "ok" | "warn";
  service: string;
  checkedAt: string;
  headline: string;
  alerts: string[];
  auth: RuntimeHealthPayload["runtime"]["auth"] & {
    wechatLogin: {
      mode: "disabled" | "mock" | "production";
      credentialsStatus: "not_required" | "missing" | "configured";
      route: string;
    };
  };
}

interface AuthTokenDeliveryPayload {
  status: "ok" | "warn";
  service: string;
  checkedAt: string;
  headline: string;
  delivery: RuntimeHealthPayload["runtime"]["auth"]["tokenDelivery"] & {
    recentAttempts: AuthTokenDeliveryAttemptLogEntry[];
  };
}

interface FeatureFlagObservabilityPayload {
  status: "ok" | "warn";
  service: string;
  checkedAt: string;
  headline: string;
  config: {
    source: "env_override" | "file" | "default_fallback";
    configuredPath: string;
    checksum: string;
    loadedAt: string;
    lastCheckedAt: string;
    sourceUpdatedAt?: string;
    reloadIntervalMs: number;
    staleThresholdMs: number;
    cacheAgeMs: number;
    stale: boolean;
    lastError?: string;
  };
  flags: Array<{
    flagKey: FeatureFlagKey;
    enabled: boolean;
    rollout: number;
    owner?: string;
    alertThresholds?: FeatureFlagRolloutPolicy["alertThresholds"];
    rollback?: FeatureFlagRolloutPolicy["rollback"];
    stages: FeatureFlagRolloutPolicy["stages"];
  }>;
  auditHistory: FeatureFlagAuditEntry[];
}

export interface RoomLifecycleSummaryPayload {
  status: "ok" | "warn";
  service: string;
  checkedAt: string;
  headline: string;
  alerts: string[];
  summary: {
    activeRoomCount: number;
    pendingReconnectCount: number;
    counters: RoomLifecycleObservabilityCounters;
    recentEvents: RoomLifecycleEvent[];
  };
}

const RECENT_TOKEN_DELIVERY_ATTEMPTS_LIMIT = 25;
const RECENT_ROOM_LIFECYCLE_EVENTS_LIMIT = 25;
const BATTLE_DURATION_SECONDS_BUCKETS = [1, 5, 10, 30, 60, 120, 300, 600];
const HTTP_REQUEST_DURATION_SECONDS_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

function createHistogramMetricState(buckets: number[]): HistogramMetricState {
  return {
    buckets: [...buckets].sort((left, right) => left - right),
    bucketCounts: new Array(buckets.length).fill(0),
    count: 0,
    sum: 0
  };
}

const runtimeObservability: RuntimeObservabilityState = {
  startedAt: Date.now(),
  rooms: new Map<string, RuntimeRoomSnapshot>(),
  errorEvents: [],
  counters: {
    connectMessagesTotal: 0,
    worldActionsTotal: 0,
    battleActionsTotal: 0,
    websocketActionRateLimitedTotal: 0,
    websocketActionKickTotal: 0,
    socialFriendLeaderboardRequestsTotal: 0,
    socialShareActivityRequestsTotal: 0
  },
  prometheus: {
    configCenterStoreType: 1,
    dbBackupLastSuccessTimestamp: null,
    battleDurationSeconds: createHistogramMetricState(BATTLE_DURATION_SECONDS_BUCKETS),
    httpRequestDurationSeconds: createHistogramMetricState(HTTP_REQUEST_DURATION_SECONDS_BUCKETS),
    actionValidationFailuresTotal: new Map<string, number>(),
    runtimeErrorEventsTotal: new Map<string, number>()
  },
  auth: {
    counters: {
      sessionChecksTotal: 0,
      sessionFailuresTotal: 0,
      guestLoginsTotal: 0,
      accountLoginsTotal: 0,
      accountBindingsTotal: 0,
      accountRegistrationsTotal: 0,
      refreshesTotal: 0,
      logoutsTotal: 0,
      rateLimitedTotal: 0,
      credentialStuffingBlockedTotal: 0,
      invalidCredentialsTotal: 0,
      tokenDeliveryRequestsTotal: 0,
      tokenDeliverySuccessesTotal: 0,
      tokenDeliveryFailuresTotal: 0,
      tokenDeliveryRetriesTotal: 0,
      tokenDeliveryDeadLettersTotal: 0
    },
    activeGuestSessionCount: 0,
    activeAccountSessions: new Map<string, { playerId: string; provider: string }>(),
    activeAccountLockCount: 0,
    activeCredentialStuffingSourceCount: 0,
    pendingRegistrationCount: 0,
    pendingRecoveryCount: 0,
    sessionFailureReasons: {
      unauthorized: 0,
      token_expired: 0,
      token_kind_invalid: 0,
      session_revoked: 0,
      account_banned: 0
    },
    tokenDeliveryQueueCount: 0,
    tokenDeliveryDeadLetterCount: 0,
    tokenDeliveryOldestQueuedLatencyMs: null,
    tokenDeliveryNextAttemptDelayMs: null,
    tokenDeliveryFailureReasons: {
      misconfigured: 0,
      timeout: 0,
      network: 0,
      smtp_4xx: 0,
      smtp_5xx: 0,
      smtp_protocol: 0,
      webhook_4xx: 0,
      webhook_429: 0,
      webhook_5xx: 0
    },
    tokenDeliveryRecentAttempts: []
  },
  reconnect: {
    pendingWindowCount: 0,
    counters: {
      attemptsTotal: 0,
      successesTotal: 0,
      failuresTotal: 0
    }
  },
  roomLifecycle: {
    counters: {
      roomCreatesTotal: 0,
      roomDisposalsTotal: 0,
      battleCompletionsTotal: 0,
      battleAbortsTotal: 0
    },
    recentEvents: []
  },
  http: {
    counters: {
      rateLimitedTotal: 0
    }
  },
  matchmaking: {
    counters: {
      rateLimitedTotal: 0,
      queueDepth: 0
    }
  },
  leaderboardAbuse: {
    counters: {
      alertsTotal: 0
    },
    recentAlerts: []
  },
  antiCheat: {
    counters: {
      alertsTotal: 0
    },
    recentAlerts: []
  },
  paymentGrant: {
    queueCount: 0,
    deadLetterCount: 0,
    oldestQueuedLatencyMs: null,
    nextAttemptDelayMs: null,
    counters: {
      retriesTotal: 0,
      deadLetterTotal: 0
    }
  }
};

function pushRoomLifecycleEvent(event: RoomLifecycleEvent): void {
  runtimeObservability.roomLifecycle.recentEvents.unshift(event);
  if (runtimeObservability.roomLifecycle.recentEvents.length > RECENT_ROOM_LIFECYCLE_EVENTS_LIMIT) {
    runtimeObservability.roomLifecycle.recentEvents.length = RECENT_ROOM_LIFECYCLE_EVENTS_LIMIT;
  }
}

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

function escapePrometheusLabelValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"").replaceAll("\n", "\\n");
}

function formatPrometheusLabels(labels: Record<string, string>): string {
  const entries = Object.entries(labels).filter(([, value]) => value.length > 0);
  if (entries.length === 0) {
    return "";
  }

  return `{${entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}="${escapePrometheusLabelValue(value)}"`)
    .join(",")}}`;
}

function observeHistogram(state: HistogramMetricState, value: number): void {
  const normalized = Number.isFinite(value) ? Math.max(0, value) : 0;
  state.count += 1;
  state.sum += normalized;

  for (let index = 0; index < state.buckets.length; index += 1) {
    if (normalized <= state.buckets[index]!) {
      state.bucketCounts[index] = (state.bucketCounts[index] ?? 0) + 1;
    }
  }
}

function resetHistogram(state: HistogramMetricState): void {
  state.bucketCounts.fill(0);
  state.count = 0;
  state.sum = 0;
}

function renderHistogramMetric(name: string, help: string, state: HistogramMetricState): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
  for (let index = 0; index < state.buckets.length; index += 1) {
    lines.push(`${name}_bucket{le="${state.buckets[index]}"}` + ` ${state.bucketCounts[index]}`);
  }
  lines.push(`${name}_bucket{le="+Inf"} ${state.count}`);
  lines.push(`${name}_sum ${state.sum}`);
  lines.push(`${name}_count ${state.count}`);
  return lines;
}

function buildHealthPayload(
  service = "project-veil-server",
  persistence: RuntimePersistenceHealth = {
    status: "ok",
    storage: "mysql",
    message: "Persistent room storage available."
  }
): RuntimeHealthPayload {
  const roomSnapshots = Array.from(runtimeObservability.rooms.values());
  const activeRoomCount = roomSnapshots.length;
  const connectionCount = roomSnapshots.reduce((total, room) => total + room.connectedPlayers, 0);
  const activeBattleCount = roomSnapshots.reduce((total, room) => total + room.activeBattles, 0);
  const heroCount = roomSnapshots.reduce((total, room) => total + room.heroCount, 0);
  const actionMessagesTotal =
    runtimeObservability.counters.worldActionsTotal + runtimeObservability.counters.battleActionsTotal;
  const activeAccountSessionByProvider = Array.from(runtimeObservability.auth.activeAccountSessions.values()).reduce<Record<string, number>>(
    (summary, session) => {
      summary[session.provider] = (summary[session.provider] ?? 0) + 1;
      return summary;
    },
    {}
  );

  return {
    status:
      persistence.status === "degraded" ||
      runtimeObservability.leaderboardAbuse.recentAlerts.length > 0 ||
      runtimeObservability.antiCheat.recentAlerts.length > 0
        ? "warn"
        : "ok",
    service,
    checkedAt: new Date().toISOString(),
    startedAt: new Date(runtimeObservability.startedAt).toISOString(),
    uptimeSeconds: Number(((Date.now() - runtimeObservability.startedAt) / 1_000).toFixed(3)),
    runtime: {
      persistence: { ...persistence },
      activeRoomCount,
      connectionCount,
      activeBattleCount,
      heroCount,
      gameplayTraffic: {
        connectMessagesTotal: runtimeObservability.counters.connectMessagesTotal,
        worldActionsTotal: runtimeObservability.counters.worldActionsTotal,
        battleActionsTotal: runtimeObservability.counters.battleActionsTotal,
        actionMessagesTotal,
        websocketActionRateLimitedTotal: runtimeObservability.counters.websocketActionRateLimitedTotal,
        websocketActionKickTotal: runtimeObservability.counters.websocketActionKickTotal,
        socialFriendLeaderboardRequestsTotal: runtimeObservability.counters.socialFriendLeaderboardRequestsTotal,
        socialShareActivityRequestsTotal: runtimeObservability.counters.socialShareActivityRequestsTotal
      },
      auth: {
        reconnect: {
          pendingWindowCount: runtimeObservability.reconnect.pendingWindowCount,
          counters: { ...runtimeObservability.reconnect.counters }
        },
        activeGuestSessionCount: runtimeObservability.auth.activeGuestSessionCount,
        activeAccountSessionCount: runtimeObservability.auth.activeAccountSessions.size,
        activeAccountSessionByProvider,
        activeAccountLockCount: runtimeObservability.auth.activeAccountLockCount,
        activeCredentialStuffingSourceCount: runtimeObservability.auth.activeCredentialStuffingSourceCount,
        pendingRegistrationCount: runtimeObservability.auth.pendingRegistrationCount,
        pendingRecoveryCount: runtimeObservability.auth.pendingRecoveryCount,
        counters: { ...runtimeObservability.auth.counters },
        sessionFailureReasons: { ...runtimeObservability.auth.sessionFailureReasons },
        tokenDelivery: {
          queueCount: runtimeObservability.auth.tokenDeliveryQueueCount,
          deadLetterCount: runtimeObservability.auth.tokenDeliveryDeadLetterCount,
          oldestQueuedLatencyMs: runtimeObservability.auth.tokenDeliveryOldestQueuedLatencyMs,
          nextAttemptDelayMs: runtimeObservability.auth.tokenDeliveryNextAttemptDelayMs,
          counters: {
            tokenDeliveryRequestsTotal: runtimeObservability.auth.counters.tokenDeliveryRequestsTotal,
            tokenDeliverySuccessesTotal: runtimeObservability.auth.counters.tokenDeliverySuccessesTotal,
            tokenDeliveryFailuresTotal: runtimeObservability.auth.counters.tokenDeliveryFailuresTotal,
            tokenDeliveryRetriesTotal: runtimeObservability.auth.counters.tokenDeliveryRetriesTotal,
            tokenDeliveryDeadLettersTotal: runtimeObservability.auth.counters.tokenDeliveryDeadLettersTotal
          },
          failureReasons: { ...runtimeObservability.auth.tokenDeliveryFailureReasons }
        }
      },
      roomLifecycle: {
        counters: { ...runtimeObservability.roomLifecycle.counters },
        recentEventsTracked: runtimeObservability.roomLifecycle.recentEvents.length
      },
      http: {
        counters: { ...runtimeObservability.http.counters }
      },
      matchmaking: {
        counters: { ...runtimeObservability.matchmaking.counters }
      },
      leaderboardAbuse: {
        counters: { ...runtimeObservability.leaderboardAbuse.counters },
        alertsTracked: runtimeObservability.leaderboardAbuse.recentAlerts.length
      },
      antiCheat: {
        counters: { ...runtimeObservability.antiCheat.counters },
        alertsTracked: runtimeObservability.antiCheat.recentAlerts.length
      }
    }
  };
}

function buildAuthReadinessPayload(service = "project-veil-server"): AuthReadinessPayload {
  const health = buildHealthPayload(service);
  const alerts: string[] = [];
  const isTestEnvironment = process.env.NODE_ENV?.trim().toLowerCase() === "test";
  const normalizedWechatMode = process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE?.trim().toLowerCase();
  const wechatAppSecret = readRuntimeSecret("WECHAT_APP_SECRET");
  const hasWechatCredentials = Boolean(process.env.WECHAT_APP_ID?.trim() && wechatAppSecret);
  const wechatMode =
    normalizedWechatMode === "mock" && isTestEnvironment
      ? "mock"
      : normalizedWechatMode === "production" || normalizedWechatMode === "code2session"
        ? "production"
        : normalizedWechatMode === "disabled"
          ? "disabled"
          : isTestEnvironment
            ? "mock"
            : hasWechatCredentials
              ? "production"
              : "disabled";
  const wechatCredentialsStatus =
    wechatMode === "production"
      ? process.env.WECHAT_APP_ID?.trim() && wechatAppSecret
        ? "configured"
        : "missing"
      : "not_required";

  if (health.runtime.auth.activeAccountLockCount > 0) {
    alerts.push(`${health.runtime.auth.activeAccountLockCount} account lockout(s) active`);
  }

  if (health.runtime.auth.activeCredentialStuffingSourceCount > 0) {
    alerts.push(`${health.runtime.auth.activeCredentialStuffingSourceCount} credential-stuffing source block(s) active`);
  }

  if (health.runtime.auth.pendingRecoveryCount > 10) {
    alerts.push(`${health.runtime.auth.pendingRecoveryCount} password recovery tokens pending`);
  }

  if (health.runtime.auth.pendingRegistrationCount > 10) {
    alerts.push(`${health.runtime.auth.pendingRegistrationCount} account registration tokens pending`);
  }

  if (health.runtime.auth.tokenDelivery.deadLetterCount > 0) {
    alerts.push(`${health.runtime.auth.tokenDelivery.deadLetterCount} token delivery dead-letter(s) need operator attention`);
  }

  if (health.runtime.auth.tokenDelivery.queueCount > 5) {
    alerts.push(`${health.runtime.auth.tokenDelivery.queueCount} token deliveries waiting for retry`);
  }

  if (wechatCredentialsStatus === "missing") {
    alerts.push("WeChat login production credentials are missing");
  }

  return {
    status: alerts.length > 0 ? "warn" : "ok",
    service,
    checkedAt: health.checkedAt,
    headline:
      `auth ready; guest=${health.runtime.auth.activeGuestSessionCount} ` +
      `account=${health.runtime.auth.activeAccountSessionCount} ` +
      `lockouts=${health.runtime.auth.activeAccountLockCount} ` +
      `sourceBlocks=${health.runtime.auth.activeCredentialStuffingSourceCount} ` +
      `wechat=${wechatMode}/${wechatCredentialsStatus}`,
    alerts,
    auth: {
      ...health.runtime.auth,
      wechatLogin: {
        mode: wechatMode,
        credentialsStatus: wechatCredentialsStatus,
        route: "/api/auth/wechat-login"
      }
    }
  };
}

function buildAuthTokenDeliveryPayload(service = "project-veil-server"): AuthTokenDeliveryPayload {
  const health = buildHealthPayload(service);
  const recentAttempts = runtimeObservability.auth.tokenDeliveryRecentAttempts.map((entry) => ({ ...entry }));
  const warn = health.runtime.auth.tokenDelivery.deadLetterCount > 0 || health.runtime.auth.tokenDelivery.queueCount > 0;
  return {
    status: warn ? "warn" : "ok",
    service,
    checkedAt: health.checkedAt,
    headline: `token delivery queue=${health.runtime.auth.tokenDelivery.queueCount} deadLetters=${health.runtime.auth.tokenDelivery.deadLetterCount}`,
    delivery: {
      ...health.runtime.auth.tokenDelivery,
      recentAttempts
    }
  };
}

export function buildRoomLifecycleSummaryPayload(service = "project-veil-server"): RoomLifecycleSummaryPayload {
  const health = buildHealthPayload(service);
  const recentEvents = runtimeObservability.roomLifecycle.recentEvents.map((event) => ({ ...event }));
  const alerts: string[] = [];

  if (health.runtime.auth.reconnect.pendingWindowCount > 0) {
    alerts.push(`${health.runtime.auth.reconnect.pendingWindowCount} reconnect window(s) still pending`);
  }

  const recentBattleAbort = recentEvents.find((event) => event.kind === "battle.aborted");
  if (recentBattleAbort) {
    alerts.push(`recent battle abort recorded for room ${recentBattleAbort.roomId}`);
  }

  return {
    status: alerts.length > 0 ? "warn" : "ok",
    service,
    checkedAt: health.checkedAt,
    headline:
      `rooms=${health.runtime.activeRoomCount} ` +
      `reconnectPending=${health.runtime.auth.reconnect.pendingWindowCount} ` +
      `created=${health.runtime.roomLifecycle.counters.roomCreatesTotal} ` +
      `disposed=${health.runtime.roomLifecycle.counters.roomDisposalsTotal} ` +
      `battleCompleted=${health.runtime.roomLifecycle.counters.battleCompletionsTotal} ` +
      `battleAborted=${health.runtime.roomLifecycle.counters.battleAbortsTotal}`,
    alerts,
    summary: {
      activeRoomCount: health.runtime.activeRoomCount,
      pendingReconnectCount: health.runtime.auth.reconnect.pendingWindowCount,
      counters: { ...health.runtime.roomLifecycle.counters },
      recentEvents
    }
  };
}

export function renderRoomLifecycleSummaryText(report: RoomLifecycleSummaryPayload): string {
  const header =
    `room_lifecycle status=${report.status}` +
    ` | rooms=${report.summary.activeRoomCount}` +
    ` | reconnect_pending=${report.summary.pendingReconnectCount}` +
    ` | room_creates=${report.summary.counters.roomCreatesTotal}` +
    ` | room_disposals=${report.summary.counters.roomDisposalsTotal}` +
    ` | battle_completed=${report.summary.counters.battleCompletionsTotal}` +
    ` | battle_aborted=${report.summary.counters.battleAbortsTotal}`;
  const eventLines = report.summary.recentEvents.map((event) => {
    const parts = [`${event.timestamp}`, event.kind, `room=${event.roomId}`];
    if (event.playerId) {
      parts.push(`player=${event.playerId}`);
    }
    if (event.battleId) {
      parts.push(`battle=${event.battleId}`);
    }
    if (event.reason) {
      parts.push(`reason=${event.reason}`);
    }
    if (event.failureReason) {
      parts.push(`failure_reason=${event.failureReason}`);
    }
    return parts.join(" | ");
  });

  return `${[header, ...eventLines].join("\n")}\n`;
}

function buildRuntimeDiagnosticSnapshot(service = "project-veil-server"): RuntimeDiagnosticsSnapshot {
  const health = buildHealthPayload(service);
  const roomSummaries = Array.from(runtimeObservability.rooms.values()).sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.roomId.localeCompare(right.roomId)
  );
  const checkedAt = new Date().toISOString();
  const errorEvents = runtimeObservability.errorEvents.map((event) => ({ ...event }));

  return {
    schemaVersion: 1,
    exportedAt: checkedAt,
    source: {
      surface: "server-observability",
      devOnly: false,
      mode: "server"
    },
    room: null,
    world: null,
    battle: null,
    account: null,
    overview: {
      service,
      activeRoomCount: health.runtime.activeRoomCount,
      connectionCount: health.runtime.connectionCount,
      activeBattleCount: health.runtime.activeBattleCount,
      heroCount: health.runtime.heroCount,
      gameplayTraffic: { ...health.runtime.gameplayTraffic },
      auth: {
        activeGuestSessionCount: health.runtime.auth.activeGuestSessionCount,
        activeAccountSessionCount: health.runtime.auth.activeAccountSessionCount,
        pendingRegistrationCount: health.runtime.auth.pendingRegistrationCount,
        pendingRecoveryCount: health.runtime.auth.pendingRecoveryCount,
        tokenDeliveryQueueCount: health.runtime.auth.tokenDelivery.queueCount,
        tokenDeliveryDeadLetterCount: health.runtime.auth.tokenDelivery.deadLetterCount
      },
      roomSummaries: roomSummaries.map((room) => ({
        roomId: room.roomId,
        day: room.day,
        connectedPlayers: room.connectedPlayers,
        heroCount: room.heroCount,
        activeBattles: room.activeBattles,
        updatedAt: room.updatedAt
      }))
    },
    diagnostics: {
      eventTypes: [],
      timelineTail: roomSummaries.slice(0, 5).map((room) => ({
        id: `room:${room.roomId}:${room.updatedAt}`,
        tone: room.activeBattles > 0 ? "battle" : "system",
        source: "runtime-observability",
        text: `Room ${room.roomId} day=${room.day ?? "?"} players=${room.connectedPlayers} heroes=${room.heroCount} battles=${room.activeBattles}`
      })),
      logTail: [
        `service ${service} rooms=${health.runtime.activeRoomCount} connections=${health.runtime.connectionCount}`,
        `traffic connect=${health.runtime.gameplayTraffic.connectMessagesTotal} world=${health.runtime.gameplayTraffic.worldActionsTotal} battle=${health.runtime.gameplayTraffic.battleActionsTotal}`,
        `ws_action_rate_limit violations=${health.runtime.gameplayTraffic.websocketActionRateLimitedTotal} kicks=${health.runtime.gameplayTraffic.websocketActionKickTotal}`,
        `social friend_leaderboard=${health.runtime.gameplayTraffic.socialFriendLeaderboardRequestsTotal} share_activity=${health.runtime.gameplayTraffic.socialShareActivityRequestsTotal}`,
        `auth guest=${health.runtime.auth.activeGuestSessionCount} account=${health.runtime.auth.activeAccountSessionCount} queue=${health.runtime.auth.tokenDelivery.queueCount} rateLimited=${health.runtime.auth.counters.rateLimitedTotal}`,
        `matchmaking rateLimited=${health.runtime.matchmaking.counters.rateLimitedTotal}`
      ],
      recoverySummary: null,
      predictionStatus: "server-observability",
      pendingUiTasks: 0,
      replay: null,
      primaryClientTelemetry: [],
      errorEvents,
      errorSummary: summarizeRuntimeDiagnosticsErrors(errorEvents)
    }
  };
}

function buildFeatureFlagObservabilityPayload(service = "project-veil-server"): FeatureFlagObservabilityPayload {
  const snapshot = getFeatureFlagRuntimeSnapshot();
  const flags = listFeatureFlagRuntimeSummaries().map((entry) => ({
    flagKey: entry.flagKey,
    enabled: entry.enabled,
    rollout: entry.rollout,
    ...(entry.owner ? { owner: entry.owner } : {}),
    ...(entry.rolloutPolicy?.alertThresholds ? { alertThresholds: entry.rolloutPolicy.alertThresholds } : {}),
    ...(entry.rolloutPolicy?.rollback ? { rollback: entry.rolloutPolicy.rollback } : {}),
    stages: entry.rolloutPolicy?.stages ?? []
  }));

  return {
    status: snapshot.metadata.stale ? "warn" : "ok",
    service,
    checkedAt: new Date().toISOString(),
    headline: snapshot.metadata.stale
      ? `feature_flags stale checksum=${snapshot.metadata.checksum.slice(0, 12)} age_ms=${snapshot.metadata.cacheAgeMs}`
      : `feature_flags checksum=${snapshot.metadata.checksum.slice(0, 12)} source=${snapshot.metadata.source} flags=${flags.length}`,
    config: { ...snapshot.metadata },
    flags,
    auditHistory: snapshot.config.operations?.auditHistory ?? []
  };
}

export function buildPrometheusMetricsDocument(): string {
  const health = buildHealthPayload();
  const featureFlags = buildFeatureFlagObservabilityPayload();
  const analyticsPipeline = getAnalyticsPipelineSnapshot();
  const mysqlPools = getMySqlPoolMetricsSnapshot();
  const lines = [
    "# HELP veil_up Process health status.",
    "# TYPE veil_up gauge",
    "veil_up 1",
    "# HELP veil_active_rooms Active room count.",
    "# TYPE veil_active_rooms gauge",
    `veil_active_rooms ${health.runtime.activeRoomCount}`,
    "# HELP veil_connected_players Connected player count across active rooms.",
    "# TYPE veil_connected_players gauge",
    `veil_connected_players ${health.runtime.connectionCount}`
  ];

  lines.push(
    "# HELP veil_db_pool_active_connections Active database connections borrowed from the pool.",
    "# TYPE veil_db_pool_active_connections gauge",
    "# HELP veil_db_pool_queue_depth Database pool wait queue depth.",
    "# TYPE veil_db_pool_queue_depth gauge",
    "# HELP veil_mysql_pool_connection_limit Configured MySQL pool connection limit.",
    "# TYPE veil_mysql_pool_connection_limit gauge",
    "# HELP veil_mysql_pool_connections_active Active MySQL connections borrowed from the pool.",
    "# TYPE veil_mysql_pool_connections_active gauge",
    "# HELP veil_mysql_pool_connections_idle Idle MySQL connections retained by the pool.",
    "# TYPE veil_mysql_pool_connections_idle gauge",
    "# HELP veil_mysql_pool_queue_depth MySQL pool wait queue depth.",
    "# TYPE veil_mysql_pool_queue_depth gauge",
    "# HELP veil_mysql_pool_connection_utilization_ratio Ratio of active connections to configured connection limit.",
    "# TYPE veil_mysql_pool_connection_utilization_ratio gauge"
  );
  if (mysqlPools.length === 0) {
    lines.push("veil_db_pool_active_connections 0");
    lines.push("veil_db_pool_queue_depth 0");
    lines.push("veil_mysql_pool_connection_limit 0");
    lines.push("veil_mysql_pool_connections_active 0");
    lines.push("veil_mysql_pool_connections_idle 0");
    lines.push("veil_mysql_pool_queue_depth 0");
    lines.push("veil_mysql_pool_connection_utilization_ratio 0");
  } else {
    for (const pool of mysqlPools) {
      const labels = formatPrometheusLabels({ pool: pool.pool });
      lines.push(`veil_db_pool_active_connections${labels} ${pool.activeConnections}`);
      lines.push(`veil_db_pool_queue_depth${labels} ${pool.queueDepth}`);
      lines.push(`veil_mysql_pool_connection_limit${labels} ${pool.connectionLimit}`);
      lines.push(`veil_mysql_pool_connections_active${labels} ${pool.activeConnections}`);
      lines.push(`veil_mysql_pool_connections_idle${labels} ${pool.idleConnections}`);
      lines.push(`veil_mysql_pool_queue_depth${labels} ${pool.queueDepth}`);
      lines.push(`veil_mysql_pool_connection_utilization_ratio${labels} ${pool.utilizationRatio.toFixed(4)}`);
    }
  }

  lines.push(
    "# HELP veil_config_center_store_type Config center storage backend for this process (0=mysql, 1=filesystem).",
    "# TYPE veil_config_center_store_type gauge",
    `veil_config_center_store_type ${runtimeObservability.prometheus.configCenterStoreType}`,
    "# HELP veil_db_backup_last_success_timestamp Unix timestamp of the latest verified database backup success marker.",
    "# TYPE veil_db_backup_last_success_timestamp gauge",
    `veil_db_backup_last_success_timestamp ${runtimeObservability.prometheus.dbBackupLastSuccessTimestamp ?? 0}`,
    ...renderHistogramMetric(
      "veil_battle_duration_seconds",
      "Battle duration from start until resolution.",
      runtimeObservability.prometheus.battleDurationSeconds
    )
  );

  lines.push("# HELP veil_action_validation_failures_total Total rejected gameplay actions.");
  lines.push("# TYPE veil_action_validation_failures_total counter");
  const actionValidationEntries = Array.from(runtimeObservability.prometheus.actionValidationFailuresTotal.entries()).sort(
    ([left], [right]) => left.localeCompare(right)
  );
  if (actionValidationEntries.length === 0) {
    lines.push("veil_action_validation_failures_total 0");
  } else {
    for (const [key, value] of actionValidationEntries) {
      const [scope, reason] = key.split("::");
      lines.push(
        `veil_action_validation_failures_total${formatPrometheusLabels({
          reason: reason ?? "unknown",
          scope: scope ?? "unknown"
        })} ${value}`
      );
    }
  }

  lines.push("# HELP veil_runtime_error_events_total Total runtime error events captured by the server.");
  lines.push("# TYPE veil_runtime_error_events_total counter");
  const runtimeErrorEntries = Array.from(runtimeObservability.prometheus.runtimeErrorEventsTotal.entries()).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (runtimeErrorEntries.length === 0) {
    lines.push("veil_runtime_error_events_total 0");
  } else {
    for (const [key, value] of runtimeErrorEntries) {
      const [featureArea, ownerArea, severity, errorCode] = key.split("::");
      lines.push(
        `veil_runtime_error_events_total${formatPrometheusLabels({
          error_code: errorCode ?? "unknown",
          feature_area: featureArea ?? "unknown",
          owner_area: ownerArea ?? "unknown",
          severity: severity ?? "unknown"
        })} ${value}`
      );
    }
  }

  lines.push(
    "# HELP veil_analytics_events_buffered Events currently waiting in the server-side analytics flush buffer.",
    "# TYPE veil_analytics_events_buffered gauge",
    `veil_analytics_events_buffered ${analyticsPipeline.buffering.pendingEvents}`,
    "# HELP veil_analytics_ingested_events_total Total analytics events accepted into the server-side delivery buffer.",
    "# TYPE veil_analytics_ingested_events_total counter",
    "# HELP veil_analytics_events_flushed_total Total analytics events flushed successfully to the configured sink.",
    "# TYPE veil_analytics_events_flushed_total counter",
    "# HELP veil_analytics_flush_batches_total Total analytics batch flushes completed successfully.",
    "# TYPE veil_analytics_flush_batches_total counter",
    `veil_analytics_flush_batches_total ${analyticsPipeline.delivery.flushBatchesTotal}`,
    "# HELP veil_analytics_flush_failures_total Total analytics batch flush failures.",
    "# TYPE veil_analytics_flush_failures_total counter",
    `veil_analytics_flush_failures_total ${analyticsPipeline.delivery.flushFailuresTotal}`,
    "# HELP veil_analytics_last_flush_timestamp_seconds Unix timestamp for the last successful analytics batch flush.",
    "# TYPE veil_analytics_last_flush_timestamp_seconds gauge",
    `veil_analytics_last_flush_timestamp_seconds ${
      analyticsPipeline.delivery.lastFlushAt == null ? 0 : Math.floor(new Date(analyticsPipeline.delivery.lastFlushAt).getTime() / 1_000)
    }`,
    "# HELP veil_analytics_last_error_timestamp_seconds Unix timestamp for the last analytics flush failure.",
    "# TYPE veil_analytics_last_error_timestamp_seconds gauge",
    `veil_analytics_last_error_timestamp_seconds ${
      analyticsPipeline.delivery.lastErrorAt == null ? 0 : Math.floor(new Date(analyticsPipeline.delivery.lastErrorAt).getTime() / 1_000)
    }`,
    "# HELP veil_analytics_sink_configured Whether the configured analytics sink is active for this runtime.",
    "# TYPE veil_analytics_sink_configured gauge",
    `veil_analytics_sink_configured${formatPrometheusLabels({ sink: analyticsPipeline.sink })} 1`,
    "# HELP veil_analytics_retention_days Configured analytics retention window in days.",
    "# TYPE veil_analytics_retention_days gauge",
    `veil_analytics_retention_days ${analyticsPipeline.warehouse.retentionDays}`
  );

  if (analyticsPipeline.delivery.events.length === 0) {
    lines.push("veil_analytics_ingested_events_total 0");
    lines.push("veil_analytics_events_flushed_total 0");
  } else {
    for (const event of analyticsPipeline.delivery.events) {
      lines.push(
        `veil_analytics_ingested_events_total${formatPrometheusLabels({ name: event.name, source: event.source })} ${event.ingestedTotal}`
      );
      lines.push(
        `veil_analytics_events_flushed_total${formatPrometheusLabels({ name: event.name, source: event.source })} ${event.flushedTotal}`
      );
    }
  }

  lines.push(
    ...renderHistogramMetric(
      "veil_http_request_duration_seconds",
      "HTTP request duration for the dev server.",
      runtimeObservability.prometheus.httpRequestDurationSeconds
    )
  );

  lines.push(
    "# HELP veil_feature_flag_config_stale Whether the current feature-flag config snapshot is stale.",
    "# TYPE veil_feature_flag_config_stale gauge",
    `veil_feature_flag_config_stale ${featureFlags.config.stale ? 1 : 0}`,
    "# HELP veil_feature_flag_config_cache_age_seconds Age of the loaded feature-flag config in seconds.",
    "# TYPE veil_feature_flag_config_cache_age_seconds gauge",
    `veil_feature_flag_config_cache_age_seconds ${(featureFlags.config.cacheAgeMs / 1_000).toFixed(3)}`,
    "# HELP veil_feature_flag_config_reload_interval_seconds Expected feature-flag file recheck interval in seconds.",
    "# TYPE veil_feature_flag_config_reload_interval_seconds gauge",
    `veil_feature_flag_config_reload_interval_seconds ${(featureFlags.config.reloadIntervalMs / 1_000).toFixed(3)}`,
    "# HELP veil_feature_flag_config_last_loaded_timestamp_seconds Unix timestamp for the last successful feature-flag load.",
    "# TYPE veil_feature_flag_config_last_loaded_timestamp_seconds gauge",
    `veil_feature_flag_config_last_loaded_timestamp_seconds ${Math.floor(new Date(featureFlags.config.loadedAt).getTime() / 1_000)}`,
    "# HELP veil_feature_flag_config_last_checked_timestamp_seconds Unix timestamp for the last feature-flag source freshness check.",
    "# TYPE veil_feature_flag_config_last_checked_timestamp_seconds gauge",
    `veil_feature_flag_config_last_checked_timestamp_seconds ${Math.floor(new Date(featureFlags.config.lastCheckedAt).getTime() / 1_000)}`,
    "# HELP veil_feature_flag_enabled Whether a feature flag is enabled at the definition level.",
    "# TYPE veil_feature_flag_enabled gauge",
    "# HELP veil_feature_flag_rollout_ratio Rollout ratio for a feature flag.",
    "# TYPE veil_feature_flag_rollout_ratio gauge",
    "# HELP veil_active_rooms_total Active room count.",
    "# TYPE veil_active_rooms_total gauge",
    `veil_active_rooms_total ${health.runtime.activeRoomCount}`,
    "# HELP veil_active_room_count Active room count.",
    "# TYPE veil_active_room_count gauge",
    `veil_active_room_count ${health.runtime.activeRoomCount}`,
    "# HELP veil_connection_count Active room connection count.",
    "# TYPE veil_connection_count gauge",
    `veil_connection_count ${health.runtime.connectionCount}`,
    "# HELP veil_active_battle_count Active battle count across rooms.",
    "# TYPE veil_active_battle_count gauge",
    `veil_active_battle_count ${health.runtime.activeBattleCount}`,
    "# HELP veil_hero_count Hero count across active rooms.",
    "# TYPE veil_hero_count gauge",
    `veil_hero_count ${health.runtime.heroCount}`,
    "# HELP veil_connect_messages_total Total processed connect messages.",
    "# TYPE veil_connect_messages_total counter",
    `veil_connect_messages_total ${health.runtime.gameplayTraffic.connectMessagesTotal}`,
    "# HELP veil_world_actions_total Total processed world action messages.",
    "# TYPE veil_world_actions_total counter",
    `veil_world_actions_total ${health.runtime.gameplayTraffic.worldActionsTotal}`,
    "# HELP veil_battle_actions_total Total processed battle action messages.",
    "# TYPE veil_battle_actions_total counter",
    `veil_battle_actions_total ${health.runtime.gameplayTraffic.battleActionsTotal}`,
    "# HELP veil_gameplay_action_messages_total Total processed gameplay action messages.",
    "# TYPE veil_gameplay_action_messages_total counter",
    `veil_gameplay_action_messages_total ${health.runtime.gameplayTraffic.actionMessagesTotal}`,
    "# HELP veil_ws_action_rate_limited_total Total gameplay action messages rejected by the WebSocket per-player rate limiter.",
    "# TYPE veil_ws_action_rate_limited_total counter",
    `veil_ws_action_rate_limited_total ${health.runtime.gameplayTraffic.websocketActionRateLimitedTotal}`,
    "# HELP veil_ws_action_kicks_total Total client disconnects triggered by WebSocket action rate-limit violations.",
    "# TYPE veil_ws_action_kicks_total counter",
    `veil_ws_action_kicks_total ${health.runtime.gameplayTraffic.websocketActionKickTotal}`,
    "# HELP veil_social_friend_leaderboard_requests_total Total friend leaderboard websocket requests processed.",
    "# TYPE veil_social_friend_leaderboard_requests_total counter",
    `veil_social_friend_leaderboard_requests_total ${health.runtime.gameplayTraffic.socialFriendLeaderboardRequestsTotal}`,
    "# HELP veil_social_share_activity_requests_total Total share activity websocket requests processed.",
    "# TYPE veil_social_share_activity_requests_total counter",
    `veil_social_share_activity_requests_total ${health.runtime.gameplayTraffic.socialShareActivityRequestsTotal}`,
    "# HELP veil_reconnect_backlog_count Players currently waiting inside the Colyseus reconnection window.",
    "# TYPE veil_reconnect_backlog_count gauge",
    `veil_reconnect_backlog_count ${health.runtime.auth.reconnect.pendingWindowCount}`,
    "# HELP veil_reconnect_attempts_total Total reconnect windows opened after a drop.",
    "# TYPE veil_reconnect_attempts_total counter",
    `veil_reconnect_attempts_total ${health.runtime.auth.reconnect.counters.attemptsTotal}`,
    "# HELP veil_reconnect_successes_total Total reconnect windows resolved successfully.",
    "# TYPE veil_reconnect_successes_total counter",
    `veil_reconnect_successes_total ${health.runtime.auth.reconnect.counters.successesTotal}`,
    "# HELP veil_reconnect_failures_total Total reconnect windows that expired or failed.",
    "# TYPE veil_reconnect_failures_total counter",
    `veil_reconnect_failures_total ${health.runtime.auth.reconnect.counters.failuresTotal}`,
    "# HELP veil_room_creates_total Total logical room instances created successfully.",
    "# TYPE veil_room_creates_total counter",
    `veil_room_creates_total ${health.runtime.roomLifecycle.counters.roomCreatesTotal}`,
    "# HELP veil_room_disposals_total Total logical room instances retired or disposed.",
    "# TYPE veil_room_disposals_total counter",
    `veil_room_disposals_total ${health.runtime.roomLifecycle.counters.roomDisposalsTotal}`,
    "# HELP veil_battle_completions_total Total battles that resolved to a gameplay outcome.",
    "# TYPE veil_battle_completions_total counter",
    `veil_battle_completions_total ${health.runtime.roomLifecycle.counters.battleCompletionsTotal}`,
    "# HELP veil_battle_aborts_total Total battles aborted because a room was retired before resolution.",
    "# TYPE veil_battle_aborts_total counter",
    `veil_battle_aborts_total ${health.runtime.roomLifecycle.counters.battleAbortsTotal}`,
    "# HELP veil_auth_guest_sessions Active guest auth sessions tracked by this process.",
    "# TYPE veil_auth_guest_sessions gauge",
    `veil_auth_guest_sessions ${health.runtime.auth.activeGuestSessionCount}`,
    "# HELP veil_auth_account_sessions Active account device sessions tracked by this process.",
    "# TYPE veil_auth_account_sessions gauge",
    `veil_auth_account_sessions ${health.runtime.auth.activeAccountSessionCount}`,
    "# HELP veil_auth_account_locks Active account login lockouts.",
    "# TYPE veil_auth_account_locks gauge",
    `veil_auth_account_locks ${health.runtime.auth.activeAccountLockCount}`,
    "# HELP veil_auth_credential_stuffing_sources Active source-IP blocks triggered by credential-stuffing detection.",
    "# TYPE veil_auth_credential_stuffing_sources gauge",
    `veil_auth_credential_stuffing_sources ${health.runtime.auth.activeCredentialStuffingSourceCount}`,
    "# HELP veil_auth_pending_registrations Pending account registration tokens.",
    "# TYPE veil_auth_pending_registrations gauge",
    `veil_auth_pending_registrations ${health.runtime.auth.pendingRegistrationCount}`,
    "# HELP veil_auth_pending_recoveries Pending password recovery tokens.",
    "# TYPE veil_auth_pending_recoveries gauge",
    `veil_auth_pending_recoveries ${health.runtime.auth.pendingRecoveryCount}`,
    "# HELP veil_auth_session_checks_total Total auth session validations.",
    "# TYPE veil_auth_session_checks_total counter",
    `veil_auth_session_checks_total ${health.runtime.auth.counters.sessionChecksTotal}`,
    "# HELP veil_auth_session_failures_total Total failed auth session validations.",
    "# TYPE veil_auth_session_failures_total counter",
    `veil_auth_session_failures_total ${health.runtime.auth.counters.sessionFailuresTotal}`,
    "# HELP veil_auth_guest_logins_total Total guest login issuances.",
    "# TYPE veil_auth_guest_logins_total counter",
    `veil_auth_guest_logins_total ${health.runtime.auth.counters.guestLoginsTotal}`,
    "# HELP veil_auth_account_logins_total Total account login issuances.",
    "# TYPE veil_auth_account_logins_total counter",
    `veil_auth_account_logins_total ${health.runtime.auth.counters.accountLoginsTotal}`,
    "# HELP veil_auth_account_bindings_total Total guest-to-account binding issuances.",
    "# TYPE veil_auth_account_bindings_total counter",
    `veil_auth_account_bindings_total ${health.runtime.auth.counters.accountBindingsTotal}`,
    "# HELP veil_auth_account_registrations_total Total account registration confirmations.",
    "# TYPE veil_auth_account_registrations_total counter",
    `veil_auth_account_registrations_total ${health.runtime.auth.counters.accountRegistrationsTotal}`,
    "# HELP veil_auth_refreshes_total Total account refresh rotations.",
    "# TYPE veil_auth_refreshes_total counter",
    `veil_auth_refreshes_total ${health.runtime.auth.counters.refreshesTotal}`,
    "# HELP veil_auth_logouts_total Total successful auth logouts.",
    "# TYPE veil_auth_logouts_total counter",
    `veil_auth_logouts_total ${health.runtime.auth.counters.logoutsTotal}`,
    "# HELP veil_auth_rate_limited_total Total auth requests rejected by rate limiting.",
    "# TYPE veil_auth_rate_limited_total counter",
    `veil_auth_rate_limited_total ${health.runtime.auth.counters.rateLimitedTotal}`,
    "# HELP veil_http_rate_limited_total Total HTTP requests rejected by rate limiting.",
    "# TYPE veil_http_rate_limited_total counter",
    `veil_http_rate_limited_total ${health.runtime.http.counters.rateLimitedTotal}`,
    "# HELP veil_auth_credential_stuffing_blocked_total Total auth requests rejected by credential-stuffing source blocks.",
    "# TYPE veil_auth_credential_stuffing_blocked_total counter",
    `veil_auth_credential_stuffing_blocked_total ${health.runtime.auth.counters.credentialStuffingBlockedTotal}`,
    "# HELP veil_matchmaking_rate_limited_total Total matchmaking requests rejected by rate limiting.",
    "# TYPE veil_matchmaking_rate_limited_total counter",
    `veil_matchmaking_rate_limited_total ${health.runtime.matchmaking.counters.rateLimitedTotal}`,
    "# HELP veil_matchmaking_queue_depth Current matchmaking queue depth across the active backing store.",
    "# TYPE veil_matchmaking_queue_depth gauge",
    `veil_matchmaking_queue_depth ${health.runtime.matchmaking.counters.queueDepth}`,
    "# HELP veil_leaderboard_abuse_alerts_total Total leaderboard anti-abuse alerts emitted by this process.",
    "# TYPE veil_leaderboard_abuse_alerts_total counter",
    `veil_leaderboard_abuse_alerts_total ${health.runtime.leaderboardAbuse.counters.alertsTotal}`,
    "# HELP veil_anti_cheat_alerts_total Total anti-cheat alerts emitted by this process.",
    "# TYPE veil_anti_cheat_alerts_total counter",
    `veil_anti_cheat_alerts_total ${health.runtime.antiCheat.counters.alertsTotal}`,
    "# HELP veil_auth_invalid_credentials_total Total auth requests rejected for invalid credentials.",
    "# TYPE veil_auth_invalid_credentials_total counter",
    `veil_auth_invalid_credentials_total ${health.runtime.auth.counters.invalidCredentialsTotal}`,
    "# HELP veil_auth_token_delivery_queue_count Account token deliveries currently queued for retry.",
    "# TYPE veil_auth_token_delivery_queue_count gauge",
    `veil_auth_token_delivery_queue_count ${health.runtime.auth.tokenDelivery.queueCount}`,
    "# HELP veil_auth_token_delivery_dead_letter_count Account token deliveries currently held in the dead-letter set.",
    "# TYPE veil_auth_token_delivery_dead_letter_count gauge",
    `veil_auth_token_delivery_dead_letter_count ${health.runtime.auth.tokenDelivery.deadLetterCount}`,
    "# HELP veil_auth_token_delivery_oldest_queued_latency_ms Oldest queued token delivery age in milliseconds.",
    "# TYPE veil_auth_token_delivery_oldest_queued_latency_ms gauge",
    `veil_auth_token_delivery_oldest_queued_latency_ms ${health.runtime.auth.tokenDelivery.oldestQueuedLatencyMs ?? 0}`,
    "# HELP veil_auth_token_delivery_next_attempt_delay_ms Delay until the next queued token delivery retry attempt in milliseconds.",
    "# TYPE veil_auth_token_delivery_next_attempt_delay_ms gauge",
    `veil_auth_token_delivery_next_attempt_delay_ms ${health.runtime.auth.tokenDelivery.nextAttemptDelayMs ?? 0}`,
    "# HELP veil_auth_token_delivery_requests_total Total account token delivery requests.",
    "# TYPE veil_auth_token_delivery_requests_total counter",
    `veil_auth_token_delivery_requests_total ${health.runtime.auth.tokenDelivery.counters.tokenDeliveryRequestsTotal}`,
    "# HELP veil_auth_token_delivery_successes_total Total successful account token deliveries.",
    "# TYPE veil_auth_token_delivery_successes_total counter",
    `veil_auth_token_delivery_successes_total ${health.runtime.auth.tokenDelivery.counters.tokenDeliverySuccessesTotal}`,
    "# HELP veil_auth_token_delivery_failures_total Total failed account token delivery attempts.",
    "# TYPE veil_auth_token_delivery_failures_total counter",
    `veil_auth_token_delivery_failures_total ${health.runtime.auth.tokenDelivery.counters.tokenDeliveryFailuresTotal}`,
    "# HELP veil_auth_token_delivery_retries_total Total account token deliveries scheduled for retry.",
    "# TYPE veil_auth_token_delivery_retries_total counter",
    `veil_auth_token_delivery_retries_total ${health.runtime.auth.tokenDelivery.counters.tokenDeliveryRetriesTotal}`,
    "# HELP veil_auth_token_delivery_dead_letters_total Total account token deliveries that exhausted retries or failed non-retryably.",
    "# TYPE veil_auth_token_delivery_dead_letters_total counter",
    `veil_auth_token_delivery_dead_letters_total ${health.runtime.auth.tokenDelivery.counters.tokenDeliveryDeadLettersTotal}`,
    "# HELP veil_auth_token_delivery_failures_timeout_total Total token delivery failures caused by timeouts.",
    "# TYPE veil_auth_token_delivery_failures_timeout_total counter",
    `veil_auth_token_delivery_failures_timeout_total ${health.runtime.auth.tokenDelivery.failureReasons.timeout}`,
    "# HELP veil_auth_token_delivery_failures_network_total Total token delivery failures caused by network errors.",
    "# TYPE veil_auth_token_delivery_failures_network_total counter",
    `veil_auth_token_delivery_failures_network_total ${health.runtime.auth.tokenDelivery.failureReasons.network}`,
    "# HELP veil_auth_token_delivery_failures_smtp_4xx_total Total token delivery failures caused by retryable 4xx SMTP responses.",
    "# TYPE veil_auth_token_delivery_failures_smtp_4xx_total counter",
    `veil_auth_token_delivery_failures_smtp_4xx_total ${health.runtime.auth.tokenDelivery.failureReasons.smtp_4xx}`,
    "# HELP veil_auth_token_delivery_failures_smtp_5xx_total Total token delivery failures caused by non-retryable 5xx SMTP responses.",
    "# TYPE veil_auth_token_delivery_failures_smtp_5xx_total counter",
    `veil_auth_token_delivery_failures_smtp_5xx_total ${health.runtime.auth.tokenDelivery.failureReasons.smtp_5xx}`,
    "# HELP veil_auth_token_delivery_failures_smtp_protocol_total Total token delivery failures caused by invalid SMTP protocol responses.",
    "# TYPE veil_auth_token_delivery_failures_smtp_protocol_total counter",
    `veil_auth_token_delivery_failures_smtp_protocol_total ${health.runtime.auth.tokenDelivery.failureReasons.smtp_protocol}`,
    "# HELP veil_auth_token_delivery_failures_webhook_4xx_total Total token delivery failures caused by non-retryable 4xx webhook responses.",
    "# TYPE veil_auth_token_delivery_failures_webhook_4xx_total counter",
    `veil_auth_token_delivery_failures_webhook_4xx_total ${health.runtime.auth.tokenDelivery.failureReasons.webhook_4xx}`,
    "# HELP veil_auth_token_delivery_failures_webhook_429_total Total token delivery failures caused by retryable 429 webhook responses.",
    "# TYPE veil_auth_token_delivery_failures_webhook_429_total counter",
    `veil_auth_token_delivery_failures_webhook_429_total ${health.runtime.auth.tokenDelivery.failureReasons.webhook_429}`,
    "# HELP veil_auth_token_delivery_failures_webhook_5xx_total Total token delivery failures caused by retryable 5xx webhook responses.",
    "# TYPE veil_auth_token_delivery_failures_webhook_5xx_total counter",
    `veil_auth_token_delivery_failures_webhook_5xx_total ${health.runtime.auth.tokenDelivery.failureReasons.webhook_5xx}`,
    "# HELP veil_payment_grant_queue_count Payment orders currently queued for grant retry.",
    "# TYPE veil_payment_grant_queue_count gauge",
    `veil_payment_grant_queue_count ${runtimeObservability.paymentGrant.queueCount}`,
    "# HELP veil_payment_grant_dead_letter_count Payment orders currently parked in the dead-letter set.",
    "# TYPE veil_payment_grant_dead_letter_count gauge",
    `veil_payment_grant_dead_letter_count ${runtimeObservability.paymentGrant.deadLetterCount}`,
    "# HELP veil_payment_grant_oldest_queued_latency_ms Oldest queued payment grant retry age in milliseconds.",
    "# TYPE veil_payment_grant_oldest_queued_latency_ms gauge",
    `veil_payment_grant_oldest_queued_latency_ms ${runtimeObservability.paymentGrant.oldestQueuedLatencyMs ?? 0}`,
    "# HELP veil_payment_grant_next_attempt_delay_ms Delay until the next queued payment grant retry attempt in milliseconds.",
    "# TYPE veil_payment_grant_next_attempt_delay_ms gauge",
    `veil_payment_grant_next_attempt_delay_ms ${runtimeObservability.paymentGrant.nextAttemptDelayMs ?? 0}`,
    "# HELP veil_payment_grant_retries_total Total payment grant retries attempted by this process.",
    "# TYPE veil_payment_grant_retries_total counter",
    `veil_payment_grant_retries_total ${runtimeObservability.paymentGrant.counters.retriesTotal}`,
    "# HELP veil_payment_dead_letter_total Total payment orders moved to dead-letter by this process.",
    "# TYPE veil_payment_dead_letter_total counter",
    `veil_payment_dead_letter_total ${runtimeObservability.paymentGrant.counters.deadLetterTotal}`,
    "# HELP veil_auth_session_failures_unauthorized_total Total auth session failures caused by missing or invalid credentials.",
    "# TYPE veil_auth_session_failures_unauthorized_total counter",
    `veil_auth_session_failures_unauthorized_total ${health.runtime.auth.sessionFailureReasons.unauthorized}`,
    "# HELP veil_auth_session_failures_token_expired_total Total auth session failures caused by expired tokens.",
    "# TYPE veil_auth_session_failures_token_expired_total counter",
    `veil_auth_session_failures_token_expired_total ${health.runtime.auth.sessionFailureReasons.token_expired}`,
    "# HELP veil_auth_session_failures_token_kind_invalid_total Total auth session failures caused by wrong token kind.",
    "# TYPE veil_auth_session_failures_token_kind_invalid_total counter",
    `veil_auth_session_failures_token_kind_invalid_total ${health.runtime.auth.sessionFailureReasons.token_kind_invalid}`,
    "# HELP veil_auth_session_failures_session_revoked_total Total auth session failures caused by revoked sessions.",
    "# TYPE veil_auth_session_failures_session_revoked_total counter",
    `veil_auth_session_failures_session_revoked_total ${health.runtime.auth.sessionFailureReasons.session_revoked}`
  );

  for (const flag of featureFlags.flags) {
    const labels = formatPrometheusLabels({
      flag: flag.flagKey,
      owner: flag.owner ?? "unassigned"
    });
    lines.push(`veil_feature_flag_enabled${labels} ${flag.enabled ? 1 : 0}`);
    lines.push(`veil_feature_flag_rollout_ratio${labels} ${flag.rollout}`);
  }

  return lines.join("\n");
}

export type RuntimeSloStatus = "pass" | "warn" | "fail";
export type RuntimeSloProfileId = "local_smoke" | "pr_diagnostics" | "candidate_gate";

export interface RuntimeSloCheck {
  id:
    | "room_count"
    | "reconnect_backlog"
    | "queue_latency"
    | "action_throughput"
    | "gameplay_error_rate"
    | "reconnect_error_rate"
    | "token_delivery_error_rate";
  label: string;
  unit: "rooms" | "count" | "ms" | "actions_per_second" | "ratio";
  operator: "min" | "max";
  actual: number | null;
  passThreshold: number;
  warnThreshold: number;
  status: RuntimeSloStatus;
  summary: string;
}

export interface RuntimeSloProfileReport {
  id: RuntimeSloProfileId;
  label: string;
  status: RuntimeSloStatus;
  headline: string;
  checks: RuntimeSloCheck[];
}

export interface RuntimeSloSummaryPayload {
  schemaVersion: 1;
  checkedAt: string;
  service: string;
  status: RuntimeSloStatus;
  headline: string;
  snapshot: {
    uptimeSeconds: number;
    roomCount: number;
    reconnectBacklog: number;
    queueLatencyMs: number | null;
    queueNextAttemptDelayMs: number | null;
    actionThroughputPerSecond: number;
    gameplayErrorRate: number | null;
    reconnectErrorRate: number | null;
    tokenDeliveryErrorRate: number | null;
    totals: {
      actionMessagesTotal: number;
      gameplayErrorCount: number;
      reconnectAttemptsTotal: number;
      reconnectFailuresTotal: number;
      tokenDeliveryRequestsTotal: number;
      tokenDeliveryFailuresTotal: number;
    };
  };
  profiles: RuntimeSloProfileReport[];
  alerts: string[];
}

const RUNTIME_SLO_THRESHOLDS: Record<
  RuntimeSloProfileId,
  {
    label: string;
    checks: Record<RuntimeSloCheck["id"], { operator: RuntimeSloCheck["operator"]; pass: number; warn: number }>;
  }
> = {
  local_smoke: {
    label: "Local smoke",
    checks: {
      room_count: { operator: "min", pass: 1, warn: 1 },
      reconnect_backlog: { operator: "max", pass: 0, warn: 1 },
      queue_latency: { operator: "max", pass: 1000, warn: 5000 },
      action_throughput: { operator: "min", pass: 1, warn: 0.25 },
      gameplay_error_rate: { operator: "max", pass: 0.05, warn: 0.1 },
      reconnect_error_rate: { operator: "max", pass: 0.02, warn: 0.05 },
      token_delivery_error_rate: { operator: "max", pass: 0.05, warn: 0.1 }
    }
  },
  pr_diagnostics: {
    label: "PR diagnostics",
    checks: {
      room_count: { operator: "min", pass: 12, warn: 8 },
      reconnect_backlog: { operator: "max", pass: 0, warn: 1 },
      queue_latency: { operator: "max", pass: 500, warn: 2000 },
      action_throughput: { operator: "min", pass: 25, warn: 15 },
      gameplay_error_rate: { operator: "max", pass: 0.02, warn: 0.05 },
      reconnect_error_rate: { operator: "max", pass: 0.01, warn: 0.02 },
      token_delivery_error_rate: { operator: "max", pass: 0.02, warn: 0.05 }
    }
  },
  candidate_gate: {
    label: "Candidate gate",
    checks: {
      room_count: { operator: "min", pass: 48, warn: 32 },
      reconnect_backlog: { operator: "max", pass: 0, warn: 1 },
      queue_latency: { operator: "max", pass: 250, warn: 1000 },
      action_throughput: { operator: "min", pass: 150, warn: 120 },
      gameplay_error_rate: { operator: "max", pass: 0.01, warn: 0.03 },
      reconnect_error_rate: { operator: "max", pass: 0, warn: 0.01 },
      token_delivery_error_rate: { operator: "max", pass: 0.01, warn: 0.03 }
    }
  }
};

function sumActionValidationFailures(): number {
  return Array.from(runtimeObservability.prometheus.actionValidationFailuresTotal.values()).reduce((total, value) => total + value, 0);
}

function roundMetric(value: number, digits = 3): number {
  return Number(value.toFixed(digits));
}

function formatSloValue(value: number | null, unit: RuntimeSloCheck["unit"]): string {
  if (value == null) {
    return "missing";
  }
  if (unit === "ratio") {
    return `${(value * 100).toFixed(2)}%`;
  }
  if (unit === "actions_per_second") {
    return `${value.toFixed(2)}/s`;
  }
  if (unit === "ms") {
    return `${Math.round(value)}ms`;
  }
  return `${value}`;
}

function classifySloCheck(
  id: RuntimeSloCheck["id"],
  label: string,
  unit: RuntimeSloCheck["unit"],
  actual: number | null,
  thresholds: { operator: RuntimeSloCheck["operator"]; pass: number; warn: number }
): RuntimeSloCheck {
  let status: RuntimeSloStatus = "fail";
  if (actual != null) {
    if (thresholds.operator === "min") {
      status = actual >= thresholds.pass ? "pass" : actual >= thresholds.warn ? "warn" : "fail";
    } else {
      status = actual <= thresholds.pass ? "pass" : actual <= thresholds.warn ? "warn" : "fail";
    }
  }

  return {
    id,
    label,
    unit,
    operator: thresholds.operator,
    actual,
    passThreshold: thresholds.pass,
    warnThreshold: thresholds.warn,
    status,
    summary:
      actual == null
        ? `${label} is missing.`
        : thresholds.operator === "min"
          ? `${label} ${formatSloValue(actual, unit)} against min ${formatSloValue(thresholds.pass, unit)} (warn ${formatSloValue(thresholds.warn, unit)}).`
          : `${label} ${formatSloValue(actual, unit)} against max ${formatSloValue(thresholds.pass, unit)} (warn ${formatSloValue(thresholds.warn, unit)}).`
  };
}

function buildSloProfileReport(
  id: RuntimeSloProfileId,
  snapshot: RuntimeSloSummaryPayload["snapshot"]
): RuntimeSloProfileReport {
  const config = RUNTIME_SLO_THRESHOLDS[id];
  const checks: RuntimeSloCheck[] = [
    classifySloCheck("room_count", "Room count", "rooms", snapshot.roomCount, config.checks.room_count),
    classifySloCheck("reconnect_backlog", "Reconnect backlog", "count", snapshot.reconnectBacklog, config.checks.reconnect_backlog),
    classifySloCheck("queue_latency", "Queue latency", "ms", snapshot.queueLatencyMs, config.checks.queue_latency),
    classifySloCheck(
      "action_throughput",
      "Action throughput",
      "actions_per_second",
      snapshot.actionThroughputPerSecond,
      config.checks.action_throughput
    ),
    classifySloCheck(
      "gameplay_error_rate",
      "Gameplay error rate",
      "ratio",
      snapshot.gameplayErrorRate,
      config.checks.gameplay_error_rate
    ),
    classifySloCheck(
      "reconnect_error_rate",
      "Reconnect error rate",
      "ratio",
      snapshot.reconnectErrorRate,
      config.checks.reconnect_error_rate
    ),
    classifySloCheck(
      "token_delivery_error_rate",
      "Token delivery error rate",
      "ratio",
      snapshot.tokenDeliveryErrorRate,
      config.checks.token_delivery_error_rate
    )
  ];

  const status = checks.some((check) => check.status === "fail")
    ? "fail"
    : checks.some((check) => check.status === "warn")
      ? "warn"
      : "pass";
  const failingChecks = checks.filter((check) => check.status !== "pass");

  return {
    id,
    label: config.label,
    status,
    headline:
      failingChecks.length === 0
        ? `${config.label} thresholds passed.`
        : `${config.label} ${status === "fail" ? "failed" : "warned"} on ${failingChecks.map((check) => check.label).join(", ")}.`,
    checks
  };
}

export function buildRuntimeSloSummaryPayload(service = "project-veil-server"): RuntimeSloSummaryPayload {
  const health = buildHealthPayload(service);
  const gameplayErrorCount =
    sumActionValidationFailures() + health.runtime.gameplayTraffic.websocketActionRateLimitedTotal;
  const actionMessagesTotal = health.runtime.gameplayTraffic.actionMessagesTotal;
  const reconnectAttemptsTotal = health.runtime.auth.reconnect.counters.attemptsTotal;
  const reconnectFailuresTotal = health.runtime.auth.reconnect.counters.failuresTotal;
  const tokenDeliveryRequestsTotal = health.runtime.auth.tokenDelivery.counters.tokenDeliveryRequestsTotal;
  const tokenDeliveryFailuresTotal = health.runtime.auth.tokenDelivery.counters.tokenDeliveryFailuresTotal;
  const snapshot: RuntimeSloSummaryPayload["snapshot"] = {
    uptimeSeconds: health.uptimeSeconds,
    roomCount: health.runtime.activeRoomCount,
    reconnectBacklog: health.runtime.auth.reconnect.pendingWindowCount,
    queueLatencyMs: health.runtime.auth.tokenDelivery.oldestQueuedLatencyMs,
    queueNextAttemptDelayMs: health.runtime.auth.tokenDelivery.nextAttemptDelayMs,
    actionThroughputPerSecond:
      health.uptimeSeconds > 0 ? roundMetric(actionMessagesTotal / Math.max(health.uptimeSeconds, 0.001)) : 0,
    gameplayErrorRate: actionMessagesTotal > 0 ? roundMetric(gameplayErrorCount / actionMessagesTotal, 6) : 0,
    reconnectErrorRate: reconnectAttemptsTotal > 0 ? roundMetric(reconnectFailuresTotal / reconnectAttemptsTotal, 6) : 0,
    tokenDeliveryErrorRate:
      tokenDeliveryRequestsTotal > 0 ? roundMetric(tokenDeliveryFailuresTotal / tokenDeliveryRequestsTotal, 6) : 0,
    totals: {
      actionMessagesTotal,
      gameplayErrorCount,
      reconnectAttemptsTotal,
      reconnectFailuresTotal,
      tokenDeliveryRequestsTotal,
      tokenDeliveryFailuresTotal
    }
  };
  const profiles = (Object.keys(RUNTIME_SLO_THRESHOLDS) as RuntimeSloProfileId[]).map((profileId) =>
    buildSloProfileReport(profileId, snapshot)
  );
  const status = profiles.some((profile) => profile.status === "fail")
    ? "fail"
    : profiles.some((profile) => profile.status === "warn")
      ? "warn"
      : "pass";
  const alerts = profiles
    .flatMap((profile) =>
      profile.checks
        .filter((check) => check.status !== "pass")
        .map((check) => `${profile.label}: ${check.summary}`)
    );

  return {
    schemaVersion: 1,
    checkedAt: health.checkedAt,
    service,
    status,
    headline:
      status === "pass"
        ? "Runtime SLO summary passed local smoke, PR diagnostics, and candidate gate recommendations."
        : status === "warn"
          ? "Runtime SLO summary is warning on at least one recommended threshold."
          : "Runtime SLO summary failed at least one recommended threshold.",
    snapshot,
    profiles,
    alerts
  };
}

export function renderRuntimeSloSummaryMarkdown(report: RuntimeSloSummaryPayload): string {
  const lines = [
    "# Runtime SLO Summary",
    "",
    `Overall status: **${report.status.toUpperCase()}**`,
    "",
    `Snapshot: rooms=${report.snapshot.roomCount} | reconnect backlog=${report.snapshot.reconnectBacklog} | queue latency=${formatSloValue(report.snapshot.queueLatencyMs, "ms")} | throughput=${formatSloValue(report.snapshot.actionThroughputPerSecond, "actions_per_second")} | gameplay error=${formatSloValue(report.snapshot.gameplayErrorRate, "ratio")} | reconnect error=${formatSloValue(report.snapshot.reconnectErrorRate, "ratio")} | token delivery error=${formatSloValue(report.snapshot.tokenDeliveryErrorRate, "ratio")}`,
    "",
    "## Threshold Recommendations",
    "",
    "| Profile | Status | Headline |",
    "| --- | --- | --- |"
  ];

  for (const profile of report.profiles) {
    lines.push(`| ${profile.label} | ${profile.status.toUpperCase()} | ${profile.headline} |`);
  }

  lines.push("", "## Alert-Friendly Diagnostics", "");
  if (report.alerts.length === 0) {
    lines.push("- No warning or failing SLO diagnostics.");
  } else {
    for (const alert of report.alerts) {
      lines.push(`- ${alert}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderRuntimeSloSummaryText(report: RuntimeSloSummaryPayload): string {
  const parts = [
    `runtime_slo status=${report.status}`,
    `rooms=${report.snapshot.roomCount}`,
    `reconnect_backlog=${report.snapshot.reconnectBacklog}`,
    `queue_latency=${formatSloValue(report.snapshot.queueLatencyMs, "ms")}`,
    `throughput=${formatSloValue(report.snapshot.actionThroughputPerSecond, "actions_per_second")}`,
    `gameplay_error=${formatSloValue(report.snapshot.gameplayErrorRate, "ratio")}`,
    `reconnect_error=${formatSloValue(report.snapshot.reconnectErrorRate, "ratio")}`,
    `token_delivery_error=${formatSloValue(report.snapshot.tokenDeliveryErrorRate, "ratio")}`
  ];
  return `${parts.join(" | ")}\n`;
}

export function recordRuntimeRoom(snapshot: RuntimeRoomSnapshot): void {
  runtimeObservability.rooms.set(snapshot.roomId, { ...snapshot });
}

export function recordRuntimeErrorEvent(
  input: Omit<RuntimeDiagnosticsErrorEvent, "fingerprint" | "tags"> & { fingerprint?: string; tags?: string[] }
): void {
  const event = buildRuntimeDiagnosticsErrorEvent(input);
  runtimeObservability.errorEvents.unshift(event);
  if (runtimeObservability.errorEvents.length > 100) {
    runtimeObservability.errorEvents.length = 100;
  }
  const counterKey = [event.featureArea, event.ownerArea, event.severity, event.errorCode].join("::");
  runtimeObservability.prometheus.runtimeErrorEventsTotal.set(
    counterKey,
    (runtimeObservability.prometheus.runtimeErrorEventsTotal.get(counterKey) ?? 0) + 1
  );
}

export function countRuntimeErrorEventsSince(
  sinceMs: number,
  filters: Partial<Pick<RuntimeDiagnosticsErrorEvent, "featureArea" | "ownerArea" | "severity">> = {}
): number {
  return runtimeObservability.errorEvents.filter((event) => {
    const recordedAtMs = Date.parse(event.recordedAt);
    if (!Number.isFinite(recordedAtMs) || recordedAtMs < sinceMs) {
      return false;
    }

    if (filters.featureArea && event.featureArea !== filters.featureArea) {
      return false;
    }

    if (filters.ownerArea && event.ownerArea !== filters.ownerArea) {
      return false;
    }

    if (filters.severity && event.severity !== filters.severity) {
      return false;
    }

    return true;
  }).length;
}

export function removeRuntimeRoom(roomId: string): void {
  runtimeObservability.rooms.delete(roomId);
}

export function recordConnectMessage(): void {
  runtimeObservability.counters.connectMessagesTotal += 1;
}

export function recordWorldActionMessage(): void {
  runtimeObservability.counters.worldActionsTotal += 1;
}

export function recordBattleActionMessage(): void {
  runtimeObservability.counters.battleActionsTotal += 1;
}

export function recordBattleDuration(durationSeconds: number): void {
  observeHistogram(runtimeObservability.prometheus.battleDurationSeconds, durationSeconds);
}

export function recordRoomCreated(roomId: string): void {
  runtimeObservability.roomLifecycle.counters.roomCreatesTotal += 1;
  pushRoomLifecycleEvent({
    timestamp: new Date().toISOString(),
    kind: "room.created",
    roomId
  });
}

export function recordRoomDisposed(roomId: string, reason = "dispose"): void {
  runtimeObservability.roomLifecycle.counters.roomDisposalsTotal += 1;
  pushRoomLifecycleEvent({
    timestamp: new Date().toISOString(),
    kind: "room.disposed",
    roomId,
    reason
  });
}

export function recordBattleLifecycleResolved(input: {
  roomId: string;
  battleId: string;
  outcome: "completed" | "aborted";
  reason?: string;
}): void {
  if (input.outcome === "completed") {
    runtimeObservability.roomLifecycle.counters.battleCompletionsTotal += 1;
  } else {
    runtimeObservability.roomLifecycle.counters.battleAbortsTotal += 1;
  }

  pushRoomLifecycleEvent({
    timestamp: new Date().toISOString(),
    kind: input.outcome === "completed" ? "battle.completed" : "battle.aborted",
    roomId: input.roomId,
    battleId: input.battleId,
    ...(input.reason ? { reason: input.reason } : {})
  });
}

export function recordActionValidationFailure(scope: ActionValidationScope, reason: string): void {
  const normalizedReason = reason.trim() || "unknown";
  const key = `${scope}::${normalizedReason}`;
  runtimeObservability.prometheus.actionValidationFailuresTotal.set(
    key,
    (runtimeObservability.prometheus.actionValidationFailuresTotal.get(key) ?? 0) + 1
  );
}

configureAuthoritativeRoomTelemetry({
  recordBattleDuration,
  recordBattleResolved: recordBattleLifecycleResolved,
  recordActionValidationFailure
});

export function recordHttpRequestDuration(durationSeconds: number): void {
  observeHistogram(runtimeObservability.prometheus.httpRequestDurationSeconds, durationSeconds);
}

export function recordWebSocketActionRateLimited(): void {
  runtimeObservability.counters.websocketActionRateLimitedTotal += 1;
}

export function recordWebSocketActionKick(): void {
  runtimeObservability.counters.websocketActionKickTotal += 1;
}

export function recordSocialFriendLeaderboardRequest(): void {
  runtimeObservability.counters.socialFriendLeaderboardRequestsTotal += 1;
}

export function recordSocialShareActivityRequest(): void {
  runtimeObservability.counters.socialShareActivityRequestsTotal += 1;
}

export function setAuthGuestSessionCount(count: number): void {
  runtimeObservability.auth.activeGuestSessionCount = Math.max(0, Math.floor(count));
}

export function upsertAuthAccountSession(playerId: string, sessionId: string, provider: string): void {
  const normalizedPlayerId = playerId.trim();
  const normalizedSessionId = sessionId.trim();
  if (!normalizedPlayerId || !normalizedSessionId) {
    return;
  }

  runtimeObservability.auth.activeAccountSessions.set(normalizedSessionId, {
    playerId: normalizedPlayerId,
    provider: provider.trim() || "account-password"
  });
}

export function removeAuthAccountSession(sessionId: string): void {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return;
  }

  runtimeObservability.auth.activeAccountSessions.delete(normalizedSessionId);
}

export function removeAuthAccountSessionsForPlayer(playerId: string): void {
  const normalizedPlayerId = playerId.trim();
  if (!normalizedPlayerId) {
    return;
  }

  for (const [sessionId, session] of runtimeObservability.auth.activeAccountSessions.entries()) {
    if (session.playerId === normalizedPlayerId) {
      runtimeObservability.auth.activeAccountSessions.delete(sessionId);
    }
  }
}

export function setAuthAccountLockCount(count: number): void {
  runtimeObservability.auth.activeAccountLockCount = Math.max(0, Math.floor(count));
}

export function setAuthCredentialStuffingSourceCount(count: number): void {
  runtimeObservability.auth.activeCredentialStuffingSourceCount = Math.max(0, Math.floor(count));
}

export function setPendingAuthRegistrationCount(count: number): void {
  runtimeObservability.auth.pendingRegistrationCount = Math.max(0, Math.floor(count));
}

export function setPendingAuthRecoveryCount(count: number): void {
  runtimeObservability.auth.pendingRecoveryCount = Math.max(0, Math.floor(count));
}

export function recordAuthSessionCheck(): void {
  runtimeObservability.auth.counters.sessionChecksTotal += 1;
}

export function recordAuthSessionFailure(reason: AuthSessionFailureReason): void {
  runtimeObservability.auth.counters.sessionFailuresTotal += 1;
  runtimeObservability.auth.sessionFailureReasons[reason] += 1;
}

export function recordAuthGuestLogin(): void {
  runtimeObservability.auth.counters.guestLoginsTotal += 1;
}

export function recordAuthAccountLogin(): void {
  runtimeObservability.auth.counters.accountLoginsTotal += 1;
}

export function recordAuthAccountBinding(): void {
  runtimeObservability.auth.counters.accountBindingsTotal += 1;
}

export function recordAuthAccountRegistration(): void {
  runtimeObservability.auth.counters.accountRegistrationsTotal += 1;
}

export function recordAuthRefresh(): void {
  runtimeObservability.auth.counters.refreshesTotal += 1;
}

export function recordAuthLogout(): void {
  runtimeObservability.auth.counters.logoutsTotal += 1;
}

export function recordAuthRateLimited(): void {
  runtimeObservability.auth.counters.rateLimitedTotal += 1;
}

export function recordHttpRateLimited(): void {
  runtimeObservability.http.counters.rateLimitedTotal += 1;
}

export function recordAuthCredentialStuffingBlocked(): void {
  runtimeObservability.auth.counters.credentialStuffingBlockedTotal += 1;
}

export function recordMatchmakingRateLimited(): void {
  runtimeObservability.matchmaking.counters.rateLimitedTotal += 1;
}

export function setMatchmakingQueueDepth(count: number): void {
  runtimeObservability.matchmaking.counters.queueDepth = Math.max(0, Math.floor(count));
}

export function recordLeaderboardAbuseAlert(alert: LeaderboardAlertEvent): void {
  runtimeObservability.leaderboardAbuse.counters.alertsTotal += 1;
  runtimeObservability.leaderboardAbuse.recentAlerts.unshift({ ...alert });
  if (runtimeObservability.leaderboardAbuse.recentAlerts.length > 20) {
    runtimeObservability.leaderboardAbuse.recentAlerts.length = 20;
  }
}

export function recordAntiCheatAlert(alert: AntiCheatAlertEvent): void {
  runtimeObservability.antiCheat.counters.alertsTotal += 1;
  runtimeObservability.antiCheat.recentAlerts.unshift({ ...alert });
  if (runtimeObservability.antiCheat.recentAlerts.length > 20) {
    runtimeObservability.antiCheat.recentAlerts.length = 20;
  }
}

export function recordAuthInvalidCredentials(): void {
  runtimeObservability.auth.counters.invalidCredentialsTotal += 1;
}

export function setAuthTokenDeliveryQueueCount(count: number): void {
  runtimeObservability.auth.tokenDeliveryQueueCount = Math.max(0, Math.floor(count));
}

export function setAuthTokenDeliveryDeadLetterCount(count: number): void {
  runtimeObservability.auth.tokenDeliveryDeadLetterCount = Math.max(0, Math.floor(count));
}

export function setAuthTokenDeliveryQueueLatency(metrics: {
  oldestQueuedLatencyMs: number | null;
  nextAttemptDelayMs: number | null;
}): void {
  runtimeObservability.auth.tokenDeliveryOldestQueuedLatencyMs =
    metrics.oldestQueuedLatencyMs != null ? Math.max(0, Math.floor(metrics.oldestQueuedLatencyMs)) : null;
  runtimeObservability.auth.tokenDeliveryNextAttemptDelayMs =
    metrics.nextAttemptDelayMs != null ? Math.max(0, Math.floor(metrics.nextAttemptDelayMs)) : null;
}

export function recordAuthTokenDeliveryRequest(): void {
  runtimeObservability.auth.counters.tokenDeliveryRequestsTotal += 1;
}

export function recordAuthTokenDeliverySuccess(): void {
  runtimeObservability.auth.counters.tokenDeliverySuccessesTotal += 1;
}

export function recordAuthTokenDeliveryFailure(reason: AuthTokenDeliveryFailureReason): void {
  runtimeObservability.auth.counters.tokenDeliveryFailuresTotal += 1;
  runtimeObservability.auth.tokenDeliveryFailureReasons[reason] += 1;
}

export function recordAuthTokenDeliveryRetry(): void {
  runtimeObservability.auth.counters.tokenDeliveryRetriesTotal += 1;
}

export function recordAuthTokenDeliveryDeadLetter(): void {
  runtimeObservability.auth.counters.tokenDeliveryDeadLettersTotal += 1;
}

export function setPaymentGrantQueueCount(count: number): void {
  runtimeObservability.paymentGrant.queueCount = Math.max(0, Math.floor(count));
}

export function setPaymentGrantDeadLetterCount(count: number): void {
  runtimeObservability.paymentGrant.deadLetterCount = Math.max(0, Math.floor(count));
}

export function setPaymentGrantQueueLatency(metrics: {
  oldestQueuedLatencyMs: number | null;
  nextAttemptDelayMs: number | null;
}): void {
  runtimeObservability.paymentGrant.oldestQueuedLatencyMs =
    metrics.oldestQueuedLatencyMs != null ? Math.max(0, Math.floor(metrics.oldestQueuedLatencyMs)) : null;
  runtimeObservability.paymentGrant.nextAttemptDelayMs =
    metrics.nextAttemptDelayMs != null ? Math.max(0, Math.floor(metrics.nextAttemptDelayMs)) : null;
}

export function recordPaymentGrantRetry(): void {
  runtimeObservability.paymentGrant.counters.retriesTotal += 1;
}

export function recordPaymentDeadLetter(): void {
  runtimeObservability.paymentGrant.counters.deadLetterTotal += 1;
}

export function recordAuthTokenDeliveryAttempt(entry: {
  kind: "account-registration" | "password-recovery";
  loginId: string;
  deliveryMode: "disabled" | "dev-token" | "smtp" | "webhook";
  status: AuthTokenDeliveryAttemptStatus;
  attemptCount: number;
  maxAttempts: number;
  retryable: boolean;
  message: string;
  failureReason?: AuthTokenDeliveryFailureReason;
  statusCode?: number;
  nextAttemptAt?: string;
}): void {
  runtimeObservability.auth.tokenDeliveryRecentAttempts.unshift({
    timestamp: new Date().toISOString(),
    ...entry
  });
  if (runtimeObservability.auth.tokenDeliveryRecentAttempts.length > RECENT_TOKEN_DELIVERY_ATTEMPTS_LIMIT) {
    runtimeObservability.auth.tokenDeliveryRecentAttempts.length = RECENT_TOKEN_DELIVERY_ATTEMPTS_LIMIT;
  }
}

export function recordReconnectWindowOpened(): void {
  runtimeObservability.reconnect.pendingWindowCount += 1;
  runtimeObservability.reconnect.counters.attemptsTotal += 1;
}

export function recordReconnectWindowResolved(
  outcome: "success" | "failure",
  details?: {
    roomId?: string;
    playerId?: string;
    reason?: ReconnectFailureReason;
  }
): void {
  runtimeObservability.reconnect.pendingWindowCount = Math.max(0, runtimeObservability.reconnect.pendingWindowCount - 1);
  if (outcome === "success") {
    runtimeObservability.reconnect.counters.successesTotal += 1;
  } else {
    runtimeObservability.reconnect.counters.failuresTotal += 1;
  }

  if (details?.roomId) {
    pushRoomLifecycleEvent({
      timestamp: new Date().toISOString(),
      kind: outcome === "success" ? "reconnect.succeeded" : "reconnect.failed",
      roomId: details.roomId,
      ...(details.playerId ? { playerId: details.playerId } : {}),
      ...(details.reason ? { reason: details.reason, failureReason: details.reason } : {})
    });
  }
}

export function setConfigCenterStoreType(mode: "mysql" | "filesystem"): void {
  runtimeObservability.prometheus.configCenterStoreType = mode === "mysql" ? 0 : 1;
}

export function setDbBackupLastSuccessTimestamp(timestampSeconds: number | null): void {
  runtimeObservability.prometheus.dbBackupLastSuccessTimestamp =
    timestampSeconds != null && Number.isFinite(timestampSeconds) ? Math.max(0, Math.floor(timestampSeconds)) : null;
}

export function resetRuntimeObservability(): void {
  resetTrackedMySqlPools();
  runtimeObservability.startedAt = Date.now();
  runtimeObservability.rooms.clear();
  runtimeObservability.errorEvents.length = 0;
  runtimeObservability.counters.connectMessagesTotal = 0;
  runtimeObservability.counters.worldActionsTotal = 0;
  runtimeObservability.counters.battleActionsTotal = 0;
  runtimeObservability.counters.websocketActionRateLimitedTotal = 0;
  runtimeObservability.counters.websocketActionKickTotal = 0;
  runtimeObservability.prometheus.configCenterStoreType = 1;
  runtimeObservability.prometheus.dbBackupLastSuccessTimestamp = null;
  resetHistogram(runtimeObservability.prometheus.battleDurationSeconds);
  resetHistogram(runtimeObservability.prometheus.httpRequestDurationSeconds);
  runtimeObservability.prometheus.actionValidationFailuresTotal.clear();
  runtimeObservability.prometheus.runtimeErrorEventsTotal.clear();
  runtimeObservability.auth.counters.sessionChecksTotal = 0;
  runtimeObservability.auth.counters.sessionFailuresTotal = 0;
  runtimeObservability.auth.counters.guestLoginsTotal = 0;
  runtimeObservability.auth.counters.accountLoginsTotal = 0;
  runtimeObservability.auth.counters.accountBindingsTotal = 0;
  runtimeObservability.auth.counters.accountRegistrationsTotal = 0;
  runtimeObservability.auth.counters.refreshesTotal = 0;
  runtimeObservability.auth.counters.logoutsTotal = 0;
  runtimeObservability.auth.counters.rateLimitedTotal = 0;
  runtimeObservability.auth.counters.credentialStuffingBlockedTotal = 0;
  runtimeObservability.auth.counters.invalidCredentialsTotal = 0;
  runtimeObservability.auth.counters.tokenDeliveryRequestsTotal = 0;
  runtimeObservability.auth.counters.tokenDeliverySuccessesTotal = 0;
  runtimeObservability.auth.counters.tokenDeliveryFailuresTotal = 0;
  runtimeObservability.auth.counters.tokenDeliveryRetriesTotal = 0;
  runtimeObservability.auth.counters.tokenDeliveryDeadLettersTotal = 0;
  runtimeObservability.auth.activeGuestSessionCount = 0;
  runtimeObservability.auth.activeAccountSessions.clear();
  runtimeObservability.auth.activeAccountLockCount = 0;
  runtimeObservability.auth.activeCredentialStuffingSourceCount = 0;
  runtimeObservability.auth.pendingRegistrationCount = 0;
  runtimeObservability.auth.pendingRecoveryCount = 0;
  runtimeObservability.auth.sessionFailureReasons.unauthorized = 0;
  runtimeObservability.auth.sessionFailureReasons.token_expired = 0;
  runtimeObservability.auth.sessionFailureReasons.token_kind_invalid = 0;
  runtimeObservability.auth.sessionFailureReasons.session_revoked = 0;
  runtimeObservability.auth.tokenDeliveryQueueCount = 0;
  runtimeObservability.auth.tokenDeliveryDeadLetterCount = 0;
  runtimeObservability.auth.tokenDeliveryOldestQueuedLatencyMs = null;
  runtimeObservability.auth.tokenDeliveryNextAttemptDelayMs = null;
  runtimeObservability.auth.tokenDeliveryFailureReasons.misconfigured = 0;
  runtimeObservability.auth.tokenDeliveryFailureReasons.timeout = 0;
  runtimeObservability.auth.tokenDeliveryFailureReasons.network = 0;
  runtimeObservability.auth.tokenDeliveryFailureReasons.smtp_4xx = 0;
  runtimeObservability.auth.tokenDeliveryFailureReasons.smtp_5xx = 0;
  runtimeObservability.auth.tokenDeliveryFailureReasons.smtp_protocol = 0;
  runtimeObservability.auth.tokenDeliveryFailureReasons.webhook_4xx = 0;
  runtimeObservability.auth.tokenDeliveryFailureReasons.webhook_429 = 0;
  runtimeObservability.auth.tokenDeliveryFailureReasons.webhook_5xx = 0;
  runtimeObservability.auth.tokenDeliveryRecentAttempts.length = 0;
  runtimeObservability.reconnect.pendingWindowCount = 0;
  runtimeObservability.reconnect.counters.attemptsTotal = 0;
  runtimeObservability.reconnect.counters.successesTotal = 0;
  runtimeObservability.reconnect.counters.failuresTotal = 0;
  runtimeObservability.roomLifecycle.counters.roomCreatesTotal = 0;
  runtimeObservability.roomLifecycle.counters.roomDisposalsTotal = 0;
  runtimeObservability.roomLifecycle.counters.battleCompletionsTotal = 0;
  runtimeObservability.roomLifecycle.counters.battleAbortsTotal = 0;
  runtimeObservability.roomLifecycle.recentEvents.length = 0;
  runtimeObservability.http.counters.rateLimitedTotal = 0;
  runtimeObservability.matchmaking.counters.rateLimitedTotal = 0;
  runtimeObservability.matchmaking.counters.queueDepth = 0;
  runtimeObservability.leaderboardAbuse.counters.alertsTotal = 0;
  runtimeObservability.leaderboardAbuse.recentAlerts.length = 0;
  runtimeObservability.antiCheat.counters.alertsTotal = 0;
  runtimeObservability.antiCheat.recentAlerts.length = 0;
  runtimeObservability.paymentGrant.queueCount = 0;
  runtimeObservability.paymentGrant.deadLetterCount = 0;
  runtimeObservability.paymentGrant.oldestQueuedLatencyMs = null;
  runtimeObservability.paymentGrant.nextAttemptDelayMs = null;
  runtimeObservability.paymentGrant.counters.retriesTotal = 0;
  runtimeObservability.paymentGrant.counters.deadLetterTotal = 0;
}

export function registerRuntimeObservabilityRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  options?: {
    serviceName?: string;
    store?: { clearAll?: () => void };
    persistence?: RuntimePersistenceHealth;
  }
): void {
  const serviceName = options?.serviceName ?? "project-veil-server";
  const store = options?.store;
  const persistence = options?.persistence;

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/runtime/health", async (_request, response) => {
    try {
      const payload = buildHealthPayload(serviceName, persistence);
      sendJson(response, payload.status === "ok" ? 200 : 503, payload);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/metrics", async (_request, response) => {
    try {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      response.end(`${buildPrometheusMetricsDocument()}\n`);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/room-lifecycle-summary", async (request, response) => {
    try {
      const summary = buildRoomLifecycleSummaryPayload(serviceName);
      const url = new URL(request.url ?? "/api/runtime/room-lifecycle-summary", "http://runtime.local");

      if (url.searchParams.get("format") === "text") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(renderRoomLifecycleSummaryText(summary));
        return;
      }

      sendJson(response, 200, summary);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/auth-readiness", async (_request, response) => {
    try {
      sendJson(response, 200, buildAuthReadinessPayload(serviceName));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/diagnostic-snapshot", async (request, response) => {
    try {
      const snapshot = buildRuntimeDiagnosticSnapshot(serviceName);
      const url = new URL(request.url ?? "/api/runtime/diagnostic-snapshot", "http://runtime.local");

      if (url.searchParams.get("format") === "text") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(`${renderRuntimeDiagnosticsSnapshotText(snapshot)}\n`);
        return;
      }

      sendJson(response, 200, snapshot);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/account-token-delivery", async (_request, response) => {
    try {
      sendJson(response, 200, buildAuthTokenDeliveryPayload(serviceName));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/analytics-pipeline", async (request, response) => {
    try {
      const snapshot = getAnalyticsPipelineSnapshot();
      const url = new URL(request.url ?? "/api/runtime/analytics-pipeline", "http://runtime.local");

      if (url.searchParams.get("format") === "text") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(renderAnalyticsPipelineSnapshotText(snapshot));
        return;
      }

      sendJson(response, 200, snapshot);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/feature-flags", async (_request, response) => {
    try {
      sendJson(response, 200, buildFeatureFlagObservabilityPayload(serviceName));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/slo-summary", async (request, response) => {
    try {
      const summary = buildRuntimeSloSummaryPayload(serviceName);
      const url = new URL(request.url ?? "/api/runtime/slo-summary", "http://runtime.local");

      if (url.searchParams.get("format") === "markdown") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/markdown; charset=utf-8");
        response.end(renderRuntimeSloSummaryMarkdown(summary));
        return;
      }

      if (url.searchParams.get("format") === "text") {
        response.statusCode = 200;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end(renderRuntimeSloSummaryText(summary));
        return;
      }

      sendJson(response, 200, summary);
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  // Test-only endpoint to reset in-memory state
  app.post("/api/test/reset-store", async (_request, response) => {
    try {
      if (store?.clearAll) {
        store.clearAll();
        resetCapturedAnalyticsEventsForTest();
        // Also reset guest auth sessions to clear cached tokens/sessions
        // that were persisted in module-level maps in auth.ts
        resetGuestAuthSessions();
        sendJson(response, 200, { status: "ok", message: "Store and auth sessions cleared" });
      } else {
        sendJson(response, 400, { error: { message: "Store does not support clearing" } });
      }
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
