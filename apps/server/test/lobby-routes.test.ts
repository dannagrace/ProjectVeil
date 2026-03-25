import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import {
  configureRoomSnapshotStore,
  listLobbyRooms,
  resetLobbyRoomRegistry,
  type LobbyRoomSummary,
  VeilColyseusRoom
} from "../src/colyseus-room";
import { registerLobbyRoutes } from "../src/lobby";

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startLobbyRouteServer(port: number): Promise<Server> {
  configureRoomSnapshotStore(null);
  resetLobbyRoomRegistry();
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
    resetLobbyRoomRegistry();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await wait(100);

  const response = await fetch(`http://127.0.0.1:${port}/api/lobby/rooms`);
  const payload = (await response.json()) as { items: LobbyRoomSummary[] };
  const roomSummary = payload.items.find((item) => item.roomId === "room-lobby-alpha");

  assert.equal(response.status, 200);
  assert.ok(roomSummary);
  assert.equal(roomSummary?.connectedPlayers, 1);
  assert.equal(roomSummary?.activeBattles, 0);
  assert.equal(roomSummary?.seed, 1001);
});
