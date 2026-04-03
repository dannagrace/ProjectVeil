import type { IncomingMessage, ServerResponse } from "node:http";
import {
  renderRuntimeDiagnosticsSnapshotText,
  type RuntimeDiagnosticsSnapshot
} from "../../../packages/shared/src/index";
import { resetGuestAuthSessions } from "./auth";

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
  invalidCredentialsTotal: number;
  tokenDeliveryRequestsTotal: number;
  tokenDeliverySuccessesTotal: number;
  tokenDeliveryFailuresTotal: number;
  tokenDeliveryRetriesTotal: number;
  tokenDeliveryDeadLettersTotal: number;
}

interface MatchmakingObservabilityCounters {
  rateLimitedTotal: number;
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
  pendingRegistrationCount: number;
  pendingRecoveryCount: number;
  sessionFailureReasons: Record<AuthSessionFailureReason, number>;
  tokenDeliveryQueueCount: number;
  tokenDeliveryDeadLetterCount: number;
  tokenDeliveryFailureReasons: Record<AuthTokenDeliveryFailureReason, number>;
  tokenDeliveryRecentAttempts: AuthTokenDeliveryAttemptLogEntry[];
}

interface RuntimeObservabilityState {
  startedAt: number;
  rooms: Map<string, RuntimeRoomSnapshot>;
  counters: RuntimeObservabilityCounters;
  auth: AuthObservabilityState;
  matchmaking: {
    counters: MatchmakingObservabilityCounters;
  };
}

interface RuntimeHealthPayload {
  status: "ok";
  service: string;
  checkedAt: string;
  startedAt: string;
  uptimeSeconds: number;
  runtime: {
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
      };
    auth: {
      activeGuestSessionCount: number;
      activeAccountSessionCount: number;
      activeAccountSessionByProvider: Record<string, number>;
      activeAccountLockCount: number;
      pendingRegistrationCount: number;
      pendingRecoveryCount: number;
      counters: AuthObservabilityCounters;
      sessionFailureReasons: Record<AuthSessionFailureReason, number>;
      tokenDelivery: {
        queueCount: number;
        deadLetterCount: number;
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
    matchmaking: {
      counters: MatchmakingObservabilityCounters;
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

const RECENT_TOKEN_DELIVERY_ATTEMPTS_LIMIT = 25;

const runtimeObservability: RuntimeObservabilityState = {
  startedAt: Date.now(),
  rooms: new Map<string, RuntimeRoomSnapshot>(),
  counters: {
    connectMessagesTotal: 0,
    worldActionsTotal: 0,
    battleActionsTotal: 0,
    websocketActionRateLimitedTotal: 0,
    websocketActionKickTotal: 0
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
  matchmaking: {
    counters: {
      rateLimitedTotal: 0
    }
  }
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

function buildHealthPayload(service = "project-veil-server"): RuntimeHealthPayload {
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
    status: "ok",
    service,
    checkedAt: new Date().toISOString(),
    startedAt: new Date(runtimeObservability.startedAt).toISOString(),
    uptimeSeconds: Number(((Date.now() - runtimeObservability.startedAt) / 1_000).toFixed(3)),
    runtime: {
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
        websocketActionKickTotal: runtimeObservability.counters.websocketActionKickTotal
      },
      auth: {
        activeGuestSessionCount: runtimeObservability.auth.activeGuestSessionCount,
        activeAccountSessionCount: runtimeObservability.auth.activeAccountSessions.size,
        activeAccountSessionByProvider,
        activeAccountLockCount: runtimeObservability.auth.activeAccountLockCount,
        pendingRegistrationCount: runtimeObservability.auth.pendingRegistrationCount,
        pendingRecoveryCount: runtimeObservability.auth.pendingRecoveryCount,
        counters: { ...runtimeObservability.auth.counters },
        sessionFailureReasons: { ...runtimeObservability.auth.sessionFailureReasons },
        tokenDelivery: {
          queueCount: runtimeObservability.auth.tokenDeliveryQueueCount,
          deadLetterCount: runtimeObservability.auth.tokenDeliveryDeadLetterCount,
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
      matchmaking: {
        counters: { ...runtimeObservability.matchmaking.counters }
      }
    }
  };
}

function buildAuthReadinessPayload(service = "project-veil-server"): AuthReadinessPayload {
  const health = buildHealthPayload(service);
  const alerts: string[] = [];
  const isTestEnvironment = process.env.NODE_ENV?.trim().toLowerCase() === "test";
  const normalizedWechatMode = process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE?.trim().toLowerCase();
  const hasWechatCredentials = Boolean(process.env.WECHAT_APP_ID?.trim() && process.env.WECHAT_APP_SECRET?.trim());
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
      ? process.env.WECHAT_APP_ID?.trim() && process.env.WECHAT_APP_SECRET?.trim()
        ? "configured"
        : "missing"
      : "not_required";

  if (health.runtime.auth.activeAccountLockCount > 0) {
    alerts.push(`${health.runtime.auth.activeAccountLockCount} account lockout(s) active`);
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

function buildRuntimeDiagnosticSnapshot(service = "project-veil-server"): RuntimeDiagnosticsSnapshot {
  const health = buildHealthPayload(service);
  const roomSummaries = Array.from(runtimeObservability.rooms.values()).sort(
    (left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.roomId.localeCompare(right.roomId)
  );
  const checkedAt = new Date().toISOString();

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
        `auth guest=${health.runtime.auth.activeGuestSessionCount} account=${health.runtime.auth.activeAccountSessionCount} queue=${health.runtime.auth.tokenDelivery.queueCount} rateLimited=${health.runtime.auth.counters.rateLimitedTotal}`,
        `matchmaking rateLimited=${health.runtime.matchmaking.counters.rateLimitedTotal}`
      ],
      recoverySummary: null,
      predictionStatus: "server-observability",
      pendingUiTasks: 0,
      replay: null,
      primaryClientTelemetry: []
    }
  };
}

function buildMetricsDocument(): string {
  const health = buildHealthPayload();

  return [
    "# HELP veil_up Process health status.",
    "# TYPE veil_up gauge",
    "veil_up 1",
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
    "# HELP veil_auth_guest_sessions Active guest auth sessions tracked by this process.",
    "# TYPE veil_auth_guest_sessions gauge",
    `veil_auth_guest_sessions ${health.runtime.auth.activeGuestSessionCount}`,
    "# HELP veil_auth_account_sessions Active account device sessions tracked by this process.",
    "# TYPE veil_auth_account_sessions gauge",
    `veil_auth_account_sessions ${health.runtime.auth.activeAccountSessionCount}`,
    "# HELP veil_auth_account_locks Active account login lockouts.",
    "# TYPE veil_auth_account_locks gauge",
    `veil_auth_account_locks ${health.runtime.auth.activeAccountLockCount}`,
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
    "# HELP veil_matchmaking_rate_limited_total Total matchmaking requests rejected by rate limiting.",
    "# TYPE veil_matchmaking_rate_limited_total counter",
    `veil_matchmaking_rate_limited_total ${health.runtime.matchmaking.counters.rateLimitedTotal}`,
    "# HELP veil_auth_invalid_credentials_total Total auth requests rejected for invalid credentials.",
    "# TYPE veil_auth_invalid_credentials_total counter",
    `veil_auth_invalid_credentials_total ${health.runtime.auth.counters.invalidCredentialsTotal}`,
    "# HELP veil_auth_token_delivery_queue_count Account token deliveries currently queued for retry.",
    "# TYPE veil_auth_token_delivery_queue_count gauge",
    `veil_auth_token_delivery_queue_count ${health.runtime.auth.tokenDelivery.queueCount}`,
    "# HELP veil_auth_token_delivery_dead_letter_count Account token deliveries currently held in the dead-letter set.",
    "# TYPE veil_auth_token_delivery_dead_letter_count gauge",
    `veil_auth_token_delivery_dead_letter_count ${health.runtime.auth.tokenDelivery.deadLetterCount}`,
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
  ].join("\n");
}

export function recordRuntimeRoom(snapshot: RuntimeRoomSnapshot): void {
  runtimeObservability.rooms.set(snapshot.roomId, { ...snapshot });
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

export function recordWebSocketActionRateLimited(): void {
  runtimeObservability.counters.websocketActionRateLimitedTotal += 1;
}

export function recordWebSocketActionKick(): void {
  runtimeObservability.counters.websocketActionKickTotal += 1;
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

export function recordMatchmakingRateLimited(): void {
  runtimeObservability.matchmaking.counters.rateLimitedTotal += 1;
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

export function resetRuntimeObservability(): void {
  runtimeObservability.startedAt = Date.now();
  runtimeObservability.rooms.clear();
  runtimeObservability.counters.connectMessagesTotal = 0;
  runtimeObservability.counters.worldActionsTotal = 0;
  runtimeObservability.counters.battleActionsTotal = 0;
  runtimeObservability.counters.websocketActionRateLimitedTotal = 0;
  runtimeObservability.counters.websocketActionKickTotal = 0;
  runtimeObservability.auth.counters.sessionChecksTotal = 0;
  runtimeObservability.auth.counters.sessionFailuresTotal = 0;
  runtimeObservability.auth.counters.guestLoginsTotal = 0;
  runtimeObservability.auth.counters.accountLoginsTotal = 0;
  runtimeObservability.auth.counters.accountBindingsTotal = 0;
  runtimeObservability.auth.counters.accountRegistrationsTotal = 0;
  runtimeObservability.auth.counters.refreshesTotal = 0;
  runtimeObservability.auth.counters.logoutsTotal = 0;
  runtimeObservability.auth.counters.rateLimitedTotal = 0;
  runtimeObservability.auth.counters.invalidCredentialsTotal = 0;
  runtimeObservability.auth.counters.tokenDeliveryRequestsTotal = 0;
  runtimeObservability.auth.counters.tokenDeliverySuccessesTotal = 0;
  runtimeObservability.auth.counters.tokenDeliveryFailuresTotal = 0;
  runtimeObservability.auth.counters.tokenDeliveryRetriesTotal = 0;
  runtimeObservability.auth.counters.tokenDeliveryDeadLettersTotal = 0;
  runtimeObservability.auth.activeGuestSessionCount = 0;
  runtimeObservability.auth.activeAccountSessions.clear();
  runtimeObservability.auth.activeAccountLockCount = 0;
  runtimeObservability.auth.pendingRegistrationCount = 0;
  runtimeObservability.auth.pendingRecoveryCount = 0;
  runtimeObservability.auth.sessionFailureReasons.unauthorized = 0;
  runtimeObservability.auth.sessionFailureReasons.token_expired = 0;
  runtimeObservability.auth.sessionFailureReasons.token_kind_invalid = 0;
  runtimeObservability.auth.sessionFailureReasons.session_revoked = 0;
  runtimeObservability.auth.tokenDeliveryQueueCount = 0;
  runtimeObservability.auth.tokenDeliveryDeadLetterCount = 0;
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
  runtimeObservability.matchmaking.counters.rateLimitedTotal = 0;
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
  }
): void {
  const serviceName = options?.serviceName ?? "project-veil-server";
  const store = options?.store;

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
      sendJson(response, 200, buildHealthPayload(serviceName));
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/runtime/metrics", async (_request, response) => {
    try {
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
      response.end(`${buildMetricsDocument()}\n`);
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

  // Test-only endpoint to reset in-memory state
  app.post("/api/test/reset-store", async (_request, response) => {
    try {
      if (store?.clearAll) {
        store.clearAll();
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
