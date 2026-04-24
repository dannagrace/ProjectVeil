import assert from "node:assert/strict";
import test from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import { DEFAULT_FEATURE_FLAG_CONFIG, type FeatureFlagConfigDocument } from "@veil/shared/platform";
import type { ClientMessage, ServerMessage } from "@veil/shared/protocol";
import { registerAnalyticsRoutes } from "@server/domain/ops/analytics";
import { resetAccountTokenDeliveryState } from "@server/adapters/account-token-delivery";
import { configureRoomSnapshotStore, resetLobbyRoomRegistry, VeilColyseusRoom } from "@server/transport/colyseus-room/VeilColyseusRoom";
import { registerPrometheusMetricsMiddleware, registerPrometheusMetricsRoute } from "@server/infra/dev-server";
import {
  recordRuntimeErrorEvent,
  recordMatchmakingRateLimited,
  registerRuntimeObservabilityRoutes,
  setMatchmakingQueueDepth,
  type RuntimePersistenceHealth,
  resetRuntimeObservability
} from "@server/domain/ops/observability";
import { clearCachedFeatureFlagConfig, resetFeatureFlagRuntimeDependencies } from "@server/domain/battle/feature-flags";
import { issueGuestAuthSession, resetGuestAuthSessions } from "@server/domain/account/auth";

const RUNTIME_ADMIN_TOKEN = process.env.VEIL_ADMIN_TOKEN?.trim() || "runtime-admin-token";
process.env.VEIL_ADMIN_TOKEN = RUNTIME_ADMIN_TOKEN;

type RuntimeRouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>;

function createRuntimeRouteRegistry() {
  const gets = new Map<string, RuntimeRouteHandler>();
  const posts = new Map<string, RuntimeRouteHandler>();
  return {
    app: {
      use: () => undefined,
      get: (path: string, handler: RuntimeRouteHandler) => {
        gets.set(path, handler);
      },
      post: (path: string, handler: RuntimeRouteHandler) => {
        posts.set(path, handler);
      }
    },
    gets,
    posts
  };
}

function createJsonRequest(payload: unknown, token = RUNTIME_ADMIN_TOKEN): IncomingMessage {
  return {
    headers: {
      "x-veil-admin-token": token,
      "content-type": "application/json"
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload));
    }
  } as unknown as IncomingMessage;
}

function createJsonResponse() {
  let body = "";
  const headers = new Map<string, string>();
  const response = {
    statusCode: 0,
    setHeader(name: string, value: string) {
      headers.set(name.toLowerCase(), value);
    },
    end(chunk?: unknown) {
      body += typeof chunk === "string" ? chunk : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : "";
    }
  } as unknown as ServerResponse;

  return {
    response,
    headers,
    json: () => JSON.parse(body) as Record<string, unknown>
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startObservabilityServer(port: number, persistence?: RuntimePersistenceHealth): Promise<Server> {
  configureRoomSnapshotStore(null);
  resetGuestAuthSessions();
  resetLobbyRoomRegistry();
  resetAccountTokenDeliveryState();
  resetRuntimeObservability();

  const transport = new WebSocketTransport();
  const app = transport.getExpressApp() as never;
  registerAnalyticsRoutes(app);
  registerPrometheusMetricsMiddleware(app);
  registerPrometheusMetricsRoute(app);
  registerRuntimeObservabilityRoutes(app, persistence ? { persistence } : undefined);
  const server = new Server({ transport });
  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

test("runtime observability registers authenticated POST routes for feature flags and kill switches", () => {
  const routes = createRuntimeRouteRegistry();

  registerRuntimeObservabilityRoutes(routes.app);

  assert.ok(routes.posts.has("/api/runtime/feature-flags"));
  assert.ok(routes.posts.has("/api/runtime/kill-switches"));
});

test("POST /api/runtime/feature-flags persists the config-center featureFlags document", async (t) => {
  clearCachedFeatureFlagConfig();
  resetFeatureFlagRuntimeDependencies();
  t.after(() => {
    clearCachedFeatureFlagConfig();
    resetFeatureFlagRuntimeDependencies();
  });

  const routes = createRuntimeRouteRegistry();
  let savedDocument: { id: string; content: string } | null = null;
  registerRuntimeObservabilityRoutes(routes.app, {
    configCenterStore: {
      async loadDocument() {
        return {
          content: JSON.stringify(DEFAULT_FEATURE_FLAG_CONFIG),
          updatedAt: "2026-04-24T00:00:00.000Z",
          storage: "mysql"
        };
      },
      async saveDocument(id, content) {
        savedDocument = { id, content };
        return {
          content,
          updatedAt: "2026-04-24T00:05:00.000Z",
          storage: "mysql"
        };
      }
    }
  });

  const handler = routes.posts.get("/api/runtime/feature-flags");
  assert.ok(handler);
  const nextConfig: FeatureFlagConfigDocument = {
    ...DEFAULT_FEATURE_FLAG_CONFIG,
    flags: {
      ...DEFAULT_FEATURE_FLAG_CONFIG.flags,
      battle_pass_enabled: {
        ...DEFAULT_FEATURE_FLAG_CONFIG.flags.battle_pass_enabled,
        enabled: false,
        value: false,
        rollout: 0
      }
    }
  };
  const output = createJsonResponse();

  await handler(
    createJsonRequest({
      config: nextConfig,
      actor: "ops-oncall",
      summary: "Disable battle pass while investigating issue #1698",
      flagKeys: ["battle_pass_enabled"],
      ticket: "#1698"
    }),
    output.response
  );

  assert.equal(output.response.statusCode, 200);
  assert.equal(savedDocument?.id, "featureFlags");
  const savedConfig = JSON.parse(savedDocument?.content ?? "{}") as FeatureFlagConfigDocument;
  assert.equal(savedConfig.flags.battle_pass_enabled.enabled, false);
  assert.equal(savedConfig.flags.battle_pass_enabled.rollout, 0);
  assert.equal(savedConfig.operations?.auditHistory?.[0]?.actor, "ops-oncall");
  assert.equal(savedConfig.operations?.auditHistory?.[0]?.ticket, "#1698");
  const payload = output.json();
  assert.equal(payload.persisted, true);
  assert.equal((payload.featureFlags as { config?: { source?: string } }).config?.source, "config_center");
});

test("POST /api/runtime/kill-switches persists runtime gates through featureFlags", async (t) => {
  clearCachedFeatureFlagConfig();
  resetFeatureFlagRuntimeDependencies();
  t.after(() => {
    clearCachedFeatureFlagConfig();
    resetFeatureFlagRuntimeDependencies();
  });

  const routes = createRuntimeRouteRegistry();
  let savedContent = "";
  registerRuntimeObservabilityRoutes(routes.app, {
    configCenterStore: {
      async loadDocument() {
        return {
          content: JSON.stringify(DEFAULT_FEATURE_FLAG_CONFIG),
          updatedAt: "2026-04-24T00:00:00.000Z",
          storage: "mysql"
        };
      },
      async saveDocument(_id, content) {
        savedContent = content;
        return {
          content,
          updatedAt: "2026-04-24T00:06:00.000Z",
          storage: "mysql"
        };
      }
    }
  });

  const handler = routes.posts.get("/api/runtime/kill-switches");
  assert.ok(handler);
  const output = createJsonResponse();

  await handler(
    createJsonRequest({
      killSwitches: {
        wechat_payments: {
          enabled: true,
          label: "微信支付入口",
          summary: "Emergency payment disable",
          channels: ["wechat"]
        }
      }
    }),
    output.response
  );

  assert.equal(output.response.statusCode, 200);
  const savedConfig = JSON.parse(savedContent) as FeatureFlagConfigDocument;
  assert.equal(savedConfig.runtimeGates?.killSwitches?.wechat_payments?.enabled, true);
  const payload = output.json();
  assert.equal(payload.persisted, true);
  assert.equal((payload.killSwitches as { status?: string }).status, "warn");
});

test("runtime health returns 503 when persistence is degraded to memory mode", async (t) => {
  const port = 45000 + Math.floor(Math.random() * 1000);
  const server = await startObservabilityServer(port, {
    status: "degraded",
    storage: "memory",
    message: "In-memory room persistence active; room data will not survive process restarts."
  });

  t.after(async () => {
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/health`);
  const healthPayload = (await healthResponse.json()) as {
    status: string;
    runtime: {
      persistence: {
        status: string;
        storage: string;
        message: string;
      };
    };
  };

  assert.equal(healthResponse.status, 503);
  assert.equal(healthPayload.status, "warn");
  assert.equal(healthPayload.runtime.persistence.status, "degraded");
  assert.equal(healthPayload.runtime.persistence.storage, "memory");
});

async function joinRoom(port: number, logicalRoomId: string, playerId: string): Promise<ColyseusRoom> {
  const client = new Client(`http://127.0.0.1:${port}`);
  return client.joinOrCreate("veil", {
    logicalRoomId,
    playerId,
    seed: 1001
  });
}

async function sendRequest<T extends ServerMessage["type"]>(
  room: ColyseusRoom,
  message: ClientMessage,
  expectedType: T
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, 5_000);

    const unsubscribe = room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }

      const incoming = { type, ...(payload as object) } as ServerMessage;
      if (!("requestId" in incoming) || incoming.requestId !== message.requestId) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();

      if (incoming.type === "error") {
        reject(new Error(incoming.reason));
        return;
      }

      if (incoming.type !== expectedType) {
        reject(new Error(`Unexpected response type: ${incoming.type}`));
        return;
      }

      resolve(incoming as Extract<ServerMessage, { type: T }>);
    });

    room.send(message.type, message);
  });
}

test("runtime observability routes expose live room counts and gameplay traffic", async (t) => {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const originalFeatureFlagJson = process.env.VEIL_FEATURE_FLAGS_JSON;
  const originalAnalyticsSink = process.env.ANALYTICS_SINK;
  const originalAnalyticsDataset = process.env.ANALYTICS_WAREHOUSE_DATASET;
  const originalAnalyticsTable = process.env.ANALYTICS_WAREHOUSE_EVENTS_TABLE;
  const originalAnalyticsDeletionWorkflow = process.env.ANALYTICS_DELETION_WORKFLOW;
  process.env.VEIL_FEATURE_FLAGS_JSON = JSON.stringify({
    schemaVersion: 1,
    flags: {
      quest_system_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true, rollout: 1 },
      battle_pass_enabled: { type: "boolean", value: true, defaultValue: false, enabled: true, rollout: 0.1 },
      pve_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true, rollout: 1 },
      tutorial_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true, rollout: 1 }
    },
    operations: {
      rolloutPolicies: {
        battle_pass_enabled: {
          owner: "ops-oncall",
          stages: [
            { key: "canary-1", rollout: 0.01, holdMinutes: 30, monitorWindowMinutes: 30 },
            { key: "batch-10", rollout: 0.1, holdMinutes: 30, monitorWindowMinutes: 30 },
            { key: "full", rollout: 1, holdMinutes: 60, monitorWindowMinutes: 60 }
          ],
          alertThresholds: {
            errorRate: 0.02,
            sessionFailureRate: 0.01,
            paymentFailureRate: 0.02
          },
          rollback: {
            mode: "automatic",
            maxConfigAgeMinutes: 5,
            cooldownMinutes: 30
          }
        }
      },
      auditHistory: [
        {
          at: "2026-04-11T01:20:00.000Z",
          actor: "ConfigOps",
          summary: "battle pass 10 percent canary approved",
          flagKeys: ["battle_pass_enabled"],
          ticket: "#1203"
        }
      ]
    }
  });
  process.env.ANALYTICS_SINK = "stdout";
  process.env.ANALYTICS_WAREHOUSE_DATASET = "analytics_prod";
  process.env.ANALYTICS_WAREHOUSE_EVENTS_TABLE = "veil_analytics_events";
  process.env.ANALYTICS_DELETION_WORKFLOW = "dsr-player-delete";
  const server = await startObservabilityServer(port);
  const room = await joinRoom(port, "room-observability-alpha", "player-1");
  const adminHeaders = {
    "x-veil-admin-token": RUNTIME_ADMIN_TOKEN
  };

  t.after(async () => {
    if (originalFeatureFlagJson === undefined) {
      delete process.env.VEIL_FEATURE_FLAGS_JSON;
    } else {
      process.env.VEIL_FEATURE_FLAGS_JSON = originalFeatureFlagJson;
    }
    if (originalAnalyticsSink === undefined) {
      delete process.env.ANALYTICS_SINK;
    } else {
      process.env.ANALYTICS_SINK = originalAnalyticsSink;
    }
    if (originalAnalyticsDataset === undefined) {
      delete process.env.ANALYTICS_WAREHOUSE_DATASET;
    } else {
      process.env.ANALYTICS_WAREHOUSE_DATASET = originalAnalyticsDataset;
    }
    if (originalAnalyticsTable === undefined) {
      delete process.env.ANALYTICS_WAREHOUSE_EVENTS_TABLE;
    } else {
      process.env.ANALYTICS_WAREHOUSE_EVENTS_TABLE = originalAnalyticsTable;
    }
    if (originalAnalyticsDeletionWorkflow === undefined) {
      delete process.env.ANALYTICS_DELETION_WORKFLOW;
    } else {
      process.env.ANALYTICS_DELETION_WORKFLOW = originalAnalyticsDeletionWorkflow;
    }
    await room.leave(true).catch(() => undefined);
    resetLobbyRoomRegistry();
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await sendRequest(
    room,
    {
      type: "connect",
      requestId: "connect-1",
      roomId: "room-observability-alpha",
      playerId: "player-1"
    },
    "session.state"
  );
  await sendRequest(
    room,
    {
      type: "world.action",
      requestId: "world-action-1",
      action: {
        type: "hero.move",
        heroId: "hero-1",
        destination: { x: 2, y: 1 }
      }
    },
    "session.state"
  );

  const analyticsIngestResponse = await fetch(`http://127.0.0.1:${port}/api/analytics/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${issueGuestAuthSession({ playerId: "player-1", displayName: "Veil Ranger" }).token}`
    },
    body: JSON.stringify({
      schemaVersion: 1,
      emittedAt: "2026-04-11T08:00:00.000Z",
      events: [
        {
          name: "tutorial_step",
          source: "cocos-client",
          playerId: "player-1",
          payload: { stepId: "tutorial_completed", status: "completed" }
        }
      ]
    })
  });
  assert.equal(analyticsIngestResponse.status, 202);

  await wait(350);
  recordMatchmakingRateLimited();
  recordMatchmakingRateLimited();
  setMatchmakingQueueDepth(7);
  recordRuntimeErrorEvent({
    id: "server-payment-1",
    recordedAt: "2026-04-03T08:35:00.000Z",
    source: "server",
    surface: "server",
    candidateRevision: "abc1234",
    featureArea: "payment",
    ownerArea: "commerce",
    severity: "error",
    errorCode: "wechat_pay_timeout",
    message: "WeChat payment confirmation timed out.",
    context: {
      roomId: "room-observability-alpha",
      playerId: "player-1",
      requestId: "pay-1",
      route: "/api/wechat/pay/confirm",
      action: "payment.confirm",
      statusCode: 504,
      crash: false,
      detail: "upstream timeout"
    }
  });

  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/health`);
  const healthPayload = (await healthResponse.json()) as {
    status: string;
    runtime: {
      activeRoomCount: number;
      connectionCount: number;
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
        counters: {
          sessionChecksTotal: number;
        };
      };
      matchmaking: {
        counters: {
          rateLimitedTotal: number;
        };
      };
      antiCheat: {
        counters: {
          alertsTotal: number;
        };
        alertsTracked: number;
      };
    };
  };

  assert.equal(healthResponse.status, 200);
  assert.equal(healthResponse.headers.get("access-control-allow-origin"), "*");
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.runtime.activeRoomCount, 1);
  assert.equal(healthPayload.runtime.connectionCount, 1);
  assert.ok(healthPayload.runtime.heroCount >= 1);
  assert.equal(healthPayload.runtime.gameplayTraffic.connectMessagesTotal, 1);
  assert.equal(healthPayload.runtime.gameplayTraffic.worldActionsTotal, 1);
  assert.equal(healthPayload.runtime.gameplayTraffic.battleActionsTotal, 0);
  assert.equal(healthPayload.runtime.gameplayTraffic.actionMessagesTotal, 1);
  assert.equal(healthPayload.runtime.auth.activeGuestSessionCount, 1);
  assert.equal(healthPayload.runtime.auth.activeAccountSessionCount, 0);
  assert.equal(healthPayload.runtime.auth.counters.sessionChecksTotal, 1);
  assert.equal(healthPayload.runtime.matchmaking.counters.rateLimitedTotal, 2);
  assert.equal(healthPayload.runtime.antiCheat.counters.alertsTotal, 0);
  assert.equal(healthPayload.runtime.antiCheat.alertsTracked, 0);

  const unauthorizedReadinessResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/auth-readiness`);
  const unauthorizedReadinessPayload = (await unauthorizedReadinessResponse.json()) as {
    error?: {
      code?: string;
    };
  };
  assert.equal(unauthorizedReadinessResponse.status, 403);
  assert.equal(unauthorizedReadinessPayload.error?.code, "forbidden");

  const readinessResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/auth-readiness`, {
    headers: adminHeaders
  });
  const readinessPayload = (await readinessResponse.json()) as {
    status: string;
    headline: string;
  };

  assert.equal(readinessResponse.status, 200);
  assert.equal(readinessResponse.headers.get("access-control-allow-origin"), null);
  assert.equal(readinessPayload.status, "ok");
  assert.match(readinessPayload.headline, /guest=1 account=0 lockouts=0/);

  const featureFlagResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/feature-flags`, {
    headers: adminHeaders
  });
  const featureFlagPayload = (await featureFlagResponse.json()) as {
    status: string;
    headline: string;
    config: {
      source: string;
      checksum: string;
      stale: boolean;
    };
    flags: Array<{
      flagKey: string;
      rollout: number;
      owner?: string;
      stages: Array<{ key: string }>;
    }>;
    auditHistory: Array<{
      ticket?: string;
    }>;
  };

  assert.equal(featureFlagResponse.status, 200);
  assert.equal(featureFlagPayload.status, "ok");
  assert.equal(featureFlagPayload.config.source, "env_override");
  assert.equal(featureFlagPayload.config.stale, false);
  assert.match(featureFlagPayload.config.checksum, /^[a-f0-9]{64}$/);
  assert.match(featureFlagPayload.headline, /feature_flags checksum=/);
  assert.equal(featureFlagPayload.flags.find((flag) => flag.flagKey === "battle_pass_enabled")?.rollout, 0.1);
  assert.equal(featureFlagPayload.flags.find((flag) => flag.flagKey === "battle_pass_enabled")?.owner, "ops-oncall");
  assert.equal(featureFlagPayload.flags.find((flag) => flag.flagKey === "battle_pass_enabled")?.stages[0]?.key, "canary-1");
  assert.equal(featureFlagPayload.auditHistory[0]?.ticket, "#1203");

  const killSwitchResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/kill-switches`, {
    headers: adminHeaders
  });
  const killSwitchPayload = (await killSwitchResponse.json()) as {
    status: string;
    headline: string;
    clientMinVersion: {
      defaultVersion: string;
      activeVersion: string;
      channels: Record<string, string>;
      upgradeMessage?: string;
    };
    killSwitches: Array<{
      key: string;
      enabled: boolean;
      label: string;
      channels?: string[];
    }>;
  };

  assert.equal(killSwitchResponse.status, 200);
  assert.equal(killSwitchPayload.status, "ok");
  assert.equal(killSwitchPayload.clientMinVersion.defaultVersion, "0.0.0");
  assert.equal(killSwitchPayload.clientMinVersion.channels.wechat, "1.0.3");
  assert.equal(killSwitchPayload.killSwitches.find((entry) => entry.key === "wechat_payments")?.enabled, false);
  assert.equal(killSwitchPayload.killSwitches.find((entry) => entry.key === "wechat_matchmaking")?.channels?.[0], "wechat");
  assert.match(killSwitchPayload.headline, /kill_switches active=0/);

  const diagnosticResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/diagnostic-snapshot`, {
    headers: adminHeaders
  });
  const diagnosticPayload = (await diagnosticResponse.json()) as {
    source: {
      surface: string;
      mode: string;
    };
    room: null;
    overview: {
      activeRoomCount: number;
      connectionCount: number;
      roomSummaries: Array<{
        roomId: string;
        day: number | null;
        connectedPlayers: number;
      }>;
    };
    diagnostics: {
      predictionStatus: string | null;
      logTail: string[];
      errorSummary: {
        totalEvents: number;
        topFingerprints: Array<{
          errorCode: string;
          featureArea: string;
        }>;
      };
    };
  };

  assert.equal(diagnosticResponse.status, 200);
  assert.equal(diagnosticResponse.headers.get("access-control-allow-origin"), null);
  assert.equal(diagnosticPayload.source.surface, "server-observability");
  assert.equal(diagnosticPayload.source.mode, "server");
  assert.equal(diagnosticPayload.room, null);
  assert.equal(diagnosticPayload.overview.activeRoomCount, 1);
  assert.equal(diagnosticPayload.overview.connectionCount, 1);
  assert.equal(diagnosticPayload.overview.roomSummaries[0]?.roomId, "room-observability-alpha");
  assert.equal(diagnosticPayload.overview.roomSummaries[0]?.day, 1);
  assert.equal(diagnosticPayload.overview.roomSummaries[0]?.connectedPlayers, 1);
  assert.equal(diagnosticPayload.diagnostics.predictionStatus, "server-observability");
  assert.equal(diagnosticPayload.diagnostics.errorSummary.totalEvents, 1);
  assert.equal(diagnosticPayload.diagnostics.errorSummary.topFingerprints[0]?.errorCode, "wechat_pay_timeout");
  assert.equal(diagnosticPayload.diagnostics.errorSummary.topFingerprints[0]?.featureArea, "payment");
  assert.match(diagnosticPayload.diagnostics.logTail[0] ?? "", /rooms=1 connections=1/);

  const diagnosticTextResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/diagnostic-snapshot?format=text`, {
    headers: adminHeaders
  });
  const diagnosticText = await diagnosticTextResponse.text();

  assert.equal(diagnosticTextResponse.status, 200);
  assert.equal(diagnosticTextResponse.headers.get("access-control-allow-origin"), null);
  assert.match(diagnosticTextResponse.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(diagnosticText, /Mode server \(server-observability\)/);
  assert.match(diagnosticText, /Runtime rooms 1 \/ connections 1 \/ battles 0/);
  assert.match(diagnosticText, /Errors 1 \/ fingerprints 1 \/ fatal 0 \/ crashes 0/);
  assert.match(diagnosticText, /Room summary room-observability-alpha \/ day 1 \/ players 1/);

  const metricsResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/metrics`, {
    headers: adminHeaders
  });
  const metricsText = await metricsResponse.text();

  assert.equal(metricsResponse.status, 200);
  assert.equal(metricsResponse.headers.get("access-control-allow-origin"), null);
  assert.match(metricsResponse.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(metricsText, /^veil_up 1$/m);
  assert.match(metricsText, /^veil_active_rooms_total 1$/m);
  assert.match(metricsText, /^veil_active_rooms 1$/m);
  assert.match(metricsText, /^veil_connected_players 1$/m);
  assert.match(metricsText, /^veil_active_room_count 1$/m);
  assert.match(metricsText, /^veil_connection_count 1$/m);
  assert.match(metricsText, /^veil_connect_messages_total 1$/m);
  assert.match(metricsText, /^veil_world_actions_total 1$/m);
  assert.match(metricsText, /^veil_gameplay_action_messages_total 1$/m);
  assert.match(metricsText, /^veil_room_creates_total 1$/m);
  assert.match(metricsText, /^veil_room_disposals_total 0$/m);
  assert.match(metricsText, /^veil_battle_completions_total 0$/m);
  assert.match(metricsText, /^veil_battle_aborts_total 0$/m);
  assert.match(metricsText, /^veil_auth_guest_sessions 1$/m);
  assert.match(metricsText, /^veil_auth_account_sessions 0$/m);
  assert.match(metricsText, /^veil_auth_session_checks_total 1$/m);
  assert.match(metricsText, /^veil_matchmaking_rate_limited_total 2$/m);
  assert.match(metricsText, /^veil_matchmaking_queue_depth 7$/m);
  assert.match(metricsText, /^veil_anti_cheat_alerts_total 0$/m);
  assert.match(metricsText, /^veil_feature_flag_config_stale 0$/m);
  assert.match(metricsText, /^veil_feature_flag_rollout_ratio\{flag="battle_pass_enabled",owner="ops-oncall"\} 0\.1$/m);
  assert.match(
    metricsText,
    /^veil_runtime_error_events_total\{error_code="wechat_pay_timeout",feature_area="payment",owner_area="commerce",severity="error"\} 1$/m
  );

  const roomLifecycleResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/room-lifecycle-summary`, {
    headers: adminHeaders
  });
  const roomLifecyclePayload = (await roomLifecycleResponse.json()) as {
    status: string;
    headline: string;
    summary: {
      activeRoomCount: number;
      pendingReconnectCount: number;
      counters: {
        roomCreatesTotal: number;
        roomDisposalsTotal: number;
        battleCompletionsTotal: number;
        battleAbortsTotal: number;
      };
      recentEvents: Array<{
        kind: string;
        roomId: string;
      }>;
    };
  };

  assert.equal(roomLifecycleResponse.status, 200);
  assert.equal(roomLifecycleResponse.headers.get("access-control-allow-origin"), null);
  assert.equal(roomLifecyclePayload.status, "ok");
  assert.match(roomLifecyclePayload.headline, /created=1/);
  assert.equal(roomLifecyclePayload.summary.activeRoomCount, 1);
  assert.equal(roomLifecyclePayload.summary.pendingReconnectCount, 0);
  assert.equal(roomLifecyclePayload.summary.counters.roomCreatesTotal, 1);
  assert.equal(roomLifecyclePayload.summary.counters.roomDisposalsTotal, 0);
  assert.equal(roomLifecyclePayload.summary.counters.battleCompletionsTotal, 0);
  assert.equal(roomLifecyclePayload.summary.counters.battleAbortsTotal, 0);
  assert.equal(roomLifecyclePayload.summary.recentEvents[0]?.kind, "room.created");
  assert.equal(roomLifecyclePayload.summary.recentEvents[0]?.roomId, "room-observability-alpha");

  const roomLifecycleTextResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/room-lifecycle-summary?format=text`, {
    headers: adminHeaders
  });
  const roomLifecycleText = await roomLifecycleTextResponse.text();

  assert.equal(roomLifecycleTextResponse.status, 200);
  assert.equal(roomLifecycleTextResponse.headers.get("access-control-allow-origin"), null);
  assert.match(roomLifecycleTextResponse.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(roomLifecycleText, /^room_lifecycle status=ok/m);
  assert.match(roomLifecycleText, /room_creates=1/);
  assert.match(roomLifecycleText, /room\.created/);

  const analyticsPipelineResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/analytics-pipeline`, {
    headers: adminHeaders
  });
  const analyticsPipelinePayload = (await analyticsPipelineResponse.json()) as {
    status: string;
    sink: string;
    warehouse: {
      dataset: string;
      eventsTable: string;
      deletionWorkflow: string;
    };
    delivery: {
      ingestedEventsTotal: number;
      flushedEventsTotal: number;
      events: Array<{
        name: string;
        source: string;
        flushedTotal: number;
      }>;
    };
  };

  assert.equal(analyticsPipelineResponse.status, 200);
  assert.equal(analyticsPipelinePayload.status, "ok");
  assert.equal(analyticsPipelinePayload.sink, "stdout");
  assert.equal(analyticsPipelinePayload.warehouse.dataset, "analytics_prod");
  assert.equal(analyticsPipelinePayload.warehouse.eventsTable, "veil_analytics_events");
  assert.equal(analyticsPipelinePayload.warehouse.deletionWorkflow, "dsr-player-delete");
  assert.equal(analyticsPipelinePayload.delivery.ingestedEventsTotal, 2);
  assert.equal(analyticsPipelinePayload.delivery.flushedEventsTotal, 2);
  assert.equal(
    analyticsPipelinePayload.delivery.events.find((event) => event.name === "tutorial_step" && event.source === "cocos-client")?.flushedTotal,
    1
  );

  const analyticsPipelineTextResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/analytics-pipeline?format=text`, {
    headers: adminHeaders
  });
  const analyticsPipelineText = await analyticsPipelineTextResponse.text();

  assert.equal(analyticsPipelineTextResponse.status, 200);
  assert.match(analyticsPipelineTextResponse.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(analyticsPipelineText, /^analytics_pipeline status=ok/m);
  assert.match(analyticsPipelineText, /dataset=analytics_prod\.veil_analytics_events/);
  assert.match(analyticsPipelineText, /deletion_workflow=dsr-player-delete/);

  const healthPreflightResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/health`, {
    method: "OPTIONS"
  });

  assert.equal(healthPreflightResponse.status, 204);
  assert.equal(healthPreflightResponse.headers.get("access-control-allow-origin"), "*");

  const prometheusResponse = await fetch(`http://127.0.0.1:${port}/metrics`, {
    headers: adminHeaders
  });
  const prometheusText = await prometheusResponse.text();

  assert.equal(prometheusResponse.status, 200);
  assert.match(prometheusResponse.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(prometheusText, /^veil_active_rooms_total 1$/m);
  assert.match(prometheusText, /^veil_active_rooms 1$/m);
  assert.match(prometheusText, /^veil_connected_players 1$/m);
  assert.match(prometheusText, /^veil_action_validation_failures_total 0$/m);
  assert.match(prometheusText, /^veil_analytics_events_buffered 0$/m);
  assert.match(prometheusText, /^veil_analytics_ingested_events_total\{name="session_start",source="server"\} 1$/m);
  assert.match(prometheusText, /^veil_analytics_events_flushed_total\{name="tutorial_step",source="cocos-client"\} 1$/m);
  assert.match(prometheusText, /^veil_analytics_sink_configured\{sink="stdout"\} 1$/m);
  assert.match(prometheusText, /^veil_http_request_duration_seconds_count [1-9]\d*$/m);
  assert.match(prometheusText, /^veil_battle_duration_seconds_count 0$/m);
});
