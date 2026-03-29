import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "../../../packages/shared/src/index";
import { resetAccountTokenDeliveryState } from "../src/account-token-delivery";
import { configureRoomSnapshotStore, resetLobbyRoomRegistry, VeilColyseusRoom } from "../src/colyseus-room";
import { registerRuntimeObservabilityRoutes, resetRuntimeObservability } from "../src/observability";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startObservabilityServer(port: number): Promise<Server> {
  configureRoomSnapshotStore(null);
  resetLobbyRoomRegistry();
  resetAccountTokenDeliveryState();
  resetRuntimeObservability();

  const transport = new WebSocketTransport();
  registerRuntimeObservabilityRoutes(transport.getExpressApp() as never);
  const server = new Server({ transport });
  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

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
  const server = await startObservabilityServer(port);
  const room = await joinRoom(port, "room-observability-alpha", "player-1");

  t.after(async () => {
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

  await wait(100);

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
    };
  };

  assert.equal(healthResponse.status, 200);
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.runtime.activeRoomCount, 1);
  assert.equal(healthPayload.runtime.connectionCount, 1);
  assert.ok(healthPayload.runtime.heroCount >= 1);
  assert.equal(healthPayload.runtime.gameplayTraffic.connectMessagesTotal, 1);
  assert.equal(healthPayload.runtime.gameplayTraffic.worldActionsTotal, 1);
  assert.equal(healthPayload.runtime.gameplayTraffic.battleActionsTotal, 0);
  assert.equal(healthPayload.runtime.gameplayTraffic.actionMessagesTotal, 1);
  assert.equal(healthPayload.runtime.auth.activeGuestSessionCount, 0);
  assert.equal(healthPayload.runtime.auth.activeAccountSessionCount, 0);
  assert.equal(healthPayload.runtime.auth.counters.sessionChecksTotal, 0);

  const readinessResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/auth-readiness`);
  const readinessPayload = (await readinessResponse.json()) as {
    status: string;
    headline: string;
  };

  assert.equal(readinessResponse.status, 200);
  assert.equal(readinessPayload.status, "ok");
  assert.match(readinessPayload.headline, /guest=0 account=0 lockouts=0/);

  const diagnosticResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/diagnostic-snapshot`);
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
    };
  };

  assert.equal(diagnosticResponse.status, 200);
  assert.equal(diagnosticPayload.source.surface, "server-observability");
  assert.equal(diagnosticPayload.source.mode, "server");
  assert.equal(diagnosticPayload.room, null);
  assert.equal(diagnosticPayload.overview.activeRoomCount, 1);
  assert.equal(diagnosticPayload.overview.connectionCount, 1);
  assert.equal(diagnosticPayload.overview.roomSummaries[0]?.roomId, "room-observability-alpha");
  assert.equal(diagnosticPayload.overview.roomSummaries[0]?.day, 1);
  assert.equal(diagnosticPayload.overview.roomSummaries[0]?.connectedPlayers, 1);
  assert.equal(diagnosticPayload.diagnostics.predictionStatus, "server-observability");
  assert.match(diagnosticPayload.diagnostics.logTail[0] ?? "", /rooms=1 connections=1/);

  const diagnosticTextResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/diagnostic-snapshot?format=text`);
  const diagnosticText = await diagnosticTextResponse.text();

  assert.equal(diagnosticTextResponse.status, 200);
  assert.match(diagnosticTextResponse.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(diagnosticText, /Mode server \(server-observability\)/);
  assert.match(diagnosticText, /Runtime rooms 1 \/ connections 1 \/ battles 0/);
  assert.match(diagnosticText, /Room summary room-observability-alpha \/ day 1 \/ players 1/);

  const metricsResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/metrics`);
  const metricsText = await metricsResponse.text();

  assert.equal(metricsResponse.status, 200);
  assert.match(metricsResponse.headers.get("content-type") ?? "", /^text\/plain/);
  assert.match(metricsText, /^veil_up 1$/m);
  assert.match(metricsText, /^veil_active_room_count 1$/m);
  assert.match(metricsText, /^veil_connection_count 1$/m);
  assert.match(metricsText, /^veil_connect_messages_total 1$/m);
  assert.match(metricsText, /^veil_world_actions_total 1$/m);
  assert.match(metricsText, /^veil_gameplay_action_messages_total 1$/m);
  assert.match(metricsText, /^veil_auth_guest_sessions 0$/m);
  assert.match(metricsText, /^veil_auth_account_sessions 0$/m);
  assert.match(metricsText, /^veil_auth_session_checks_total 0$/m);
});
