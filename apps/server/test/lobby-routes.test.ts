import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import {
  configureRoomSnapshotStore,
  listLobbyRooms,
  resetLobbyRoomRegistry,
  VeilColyseusRoom
} from "@server/transport/colyseus-room/VeilColyseusRoom";
import { registerLobbyRoutes } from "@server/domain/social/lobby";
import { issueGuestAuthSession, resetGuestAuthSessions } from "@server/domain/account/auth";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startLobbyRouteServer(port: number): Promise<Server> {
  configureRoomSnapshotStore(null);
  resetLobbyRoomRegistry();
  resetGuestAuthSessions();
  const transport = new WebSocketTransport();
  registerLobbyRoutes(transport.getExpressApp() as never, { listRooms: listLobbyRooms });
  const server = new Server({ transport });
  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

async function joinLobbyRoom(port: number, logicalRoomId: string, playerId: string): Promise<ColyseusRoom> {
  const client = new Client(`http://127.0.0.1:${port}`);
  return client.joinOrCreate("veil", {
    logicalRoomId,
    playerId,
    seed: 1001
  });
}

test("lobby routes list active room summaries", async (t) => {
  const port = 42000 + Math.floor(Math.random() * 1000);
  const server = await startLobbyRouteServer(port);
  const room = await joinLobbyRoom(port, "room-lobby-alpha", "player-1");

  t.after(async () => {
    await room.leave(true).catch(() => undefined);
    resetGuestAuthSessions();
    resetLobbyRoomRegistry();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await wait(100);

  const session = issueGuestAuthSession({ playerId: "player-1", displayName: "Player One" });
  const response = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const payload = (await response.json()) as { items: Array<Record<string, unknown>> };
  const roomSummary = payload.items.find((item) => item.roomId === "room-lobby-alpha");

  assert.equal(response.status, 200);
  assert.ok(roomSummary);
  assert.equal(roomSummary?.connectedPlayers, 1);
  assert.equal(roomSummary?.activeBattles, 0);
  assert.equal(Object.prototype.hasOwnProperty.call(roomSummary, "seed"), false);
});

test("lobby room list requires an authenticated session", async (t) => {
  const port = 42000 + Math.floor(Math.random() * 1000);
  const server = await startLobbyRouteServer(port);
  const room = await joinLobbyRoom(port, "room-lobby-private", "player-1");

  t.after(async () => {
    await room.leave(true).catch(() => undefined);
    resetGuestAuthSessions();
    resetLobbyRoomRegistry();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await wait(100);

  const response = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`);
  const payload = (await response.json()) as { error?: { code?: string; message?: string } };

  assert.equal(response.status, 401);
  assert.equal(payload.error?.code, "unauthorized");
});
