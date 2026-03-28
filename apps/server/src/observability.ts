import type { IncomingMessage, ServerResponse } from "node:http";

export interface RuntimeRoomSnapshot {
  roomId: string;
  connectedPlayers: number;
  heroCount: number;
  activeBattles: number;
}

interface RuntimeObservabilityCounters {
  connectMessagesTotal: number;
  worldActionsTotal: number;
  battleActionsTotal: number;
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
}

type AuthSessionFailureReason = "unauthorized" | "token_expired" | "token_kind_invalid" | "session_revoked";

interface AuthObservabilityState {
  counters: AuthObservabilityCounters;
  activeGuestSessionCount: number;
  activeAccountSessions: Map<string, { playerId: string; provider: string }>;
  activeAccountLockCount: number;
  pendingRegistrationCount: number;
  pendingRecoveryCount: number;
  sessionFailureReasons: Record<AuthSessionFailureReason, number>;
}

interface RuntimeObservabilityState {
  startedAt: number;
  rooms: Map<string, RuntimeRoomSnapshot>;
  counters: RuntimeObservabilityCounters;
  auth: AuthObservabilityState;
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
    };
  };
}

interface AuthReadinessPayload {
  status: "ok" | "warn";
  service: string;
  checkedAt: string;
  headline: string;
  alerts: string[];
  auth: RuntimeHealthPayload["runtime"]["auth"];
}

const runtimeObservability: RuntimeObservabilityState = {
  startedAt: Date.now(),
  rooms: new Map<string, RuntimeRoomSnapshot>(),
  counters: {
    connectMessagesTotal: 0,
    worldActionsTotal: 0,
    battleActionsTotal: 0
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
      invalidCredentialsTotal: 0
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
      session_revoked: 0
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
        actionMessagesTotal
      },
      auth: {
        activeGuestSessionCount: runtimeObservability.auth.activeGuestSessionCount,
        activeAccountSessionCount: runtimeObservability.auth.activeAccountSessions.size,
        activeAccountSessionByProvider,
        activeAccountLockCount: runtimeObservability.auth.activeAccountLockCount,
        pendingRegistrationCount: runtimeObservability.auth.pendingRegistrationCount,
        pendingRecoveryCount: runtimeObservability.auth.pendingRecoveryCount,
        counters: { ...runtimeObservability.auth.counters },
        sessionFailureReasons: { ...runtimeObservability.auth.sessionFailureReasons }
      }
    }
  };
}

function buildAuthReadinessPayload(service = "project-veil-server"): AuthReadinessPayload {
  const health = buildHealthPayload(service);
  const alerts: string[] = [];

  if (health.runtime.auth.activeAccountLockCount > 0) {
    alerts.push(`${health.runtime.auth.activeAccountLockCount} account lockout(s) active`);
  }

  if (health.runtime.auth.pendingRecoveryCount > 10) {
    alerts.push(`${health.runtime.auth.pendingRecoveryCount} password recovery tokens pending`);
  }

  if (health.runtime.auth.pendingRegistrationCount > 10) {
    alerts.push(`${health.runtime.auth.pendingRegistrationCount} account registration tokens pending`);
  }

  return {
    status: alerts.length > 0 ? "warn" : "ok",
    service,
    checkedAt: health.checkedAt,
    headline: `auth ready; guest=${health.runtime.auth.activeGuestSessionCount} account=${health.runtime.auth.activeAccountSessionCount} lockouts=${health.runtime.auth.activeAccountLockCount}`,
    alerts,
    auth: health.runtime.auth
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
    "# HELP veil_auth_invalid_credentials_total Total auth requests rejected for invalid credentials.",
    "# TYPE veil_auth_invalid_credentials_total counter",
    `veil_auth_invalid_credentials_total ${health.runtime.auth.counters.invalidCredentialsTotal}`,
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

export function recordAuthInvalidCredentials(): void {
  runtimeObservability.auth.counters.invalidCredentialsTotal += 1;
}

export function resetRuntimeObservability(): void {
  runtimeObservability.startedAt = Date.now();
  runtimeObservability.rooms.clear();
  runtimeObservability.counters.connectMessagesTotal = 0;
  runtimeObservability.counters.worldActionsTotal = 0;
  runtimeObservability.counters.battleActionsTotal = 0;
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
  runtimeObservability.auth.activeGuestSessionCount = 0;
  runtimeObservability.auth.activeAccountSessions.clear();
  runtimeObservability.auth.activeAccountLockCount = 0;
  runtimeObservability.auth.pendingRegistrationCount = 0;
  runtimeObservability.auth.pendingRecoveryCount = 0;
  runtimeObservability.auth.sessionFailureReasons.unauthorized = 0;
  runtimeObservability.auth.sessionFailureReasons.token_expired = 0;
  runtimeObservability.auth.sessionFailureReasons.token_kind_invalid = 0;
  runtimeObservability.auth.sessionFailureReasons.session_revoked = 0;
}

export function registerRuntimeObservabilityRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  options?: {
    serviceName?: string;
  }
): void {
  const serviceName = options?.serviceName ?? "project-veil-server";

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
}
