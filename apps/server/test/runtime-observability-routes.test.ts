import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "../../../packages/shared/src/index";
import { configureRoomSnapshotStore, resetLobbyRoomRegistry, VeilColyseusRoom } from "../src/colyseus-room";
import { registerRuntimeObservabilityRoutes, resetRuntimeObservability } from "../src/observability";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startObservabilityServer(port: number): Promise<Server> {
  configureRoomSnapshotStore(null);
  resetLobbyRoomRegistry();
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
});
