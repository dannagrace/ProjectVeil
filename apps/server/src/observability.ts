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

interface RuntimeObservabilityState {
  startedAt: number;
  rooms: Map<string, RuntimeRoomSnapshot>;
  counters: RuntimeObservabilityCounters;
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
  };
}

const runtimeObservability: RuntimeObservabilityState = {
  startedAt: Date.now(),
  rooms: new Map<string, RuntimeRoomSnapshot>(),
  counters: {
    connectMessagesTotal: 0,
    worldActionsTotal: 0,
    battleActionsTotal: 0
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
      }
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
    `veil_gameplay_action_messages_total ${health.runtime.gameplayTraffic.actionMessagesTotal}`
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

export function resetRuntimeObservability(): void {
  runtimeObservability.startedAt = Date.now();
  runtimeObservability.rooms.clear();
  runtimeObservability.counters.connectMessagesTotal = 0;
  runtimeObservability.counters.worldActionsTotal = 0;
  runtimeObservability.counters.battleActionsTotal = 0;
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
}
