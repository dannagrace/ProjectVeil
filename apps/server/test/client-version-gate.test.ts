import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "@veil/shared/protocol";
import { clearCachedFeatureFlagConfig } from "../src/feature-flags";
import { configureRoomSnapshotStore, resetLobbyRoomRegistry, VeilColyseusRoom } from "../src/colyseus-room";

async function startServer(port: number): Promise<Server> {
  clearCachedFeatureFlagConfig();
  configureRoomSnapshotStore(null);
  resetLobbyRoomRegistry();
  const transport = new WebSocketTransport();
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

test("connect handshake rejects clients older than MIN_SUPPORTED_CLIENT_VERSION", async (t) => {
  const originalMinimumVersion = process.env.MIN_SUPPORTED_CLIENT_VERSION;
  process.env.MIN_SUPPORTED_CLIENT_VERSION = "1.0.3";
  const port = 42600 + Math.floor(Math.random() * 1000);
  const server = await startServer(port);
  const room = await joinRoom(port, "room-version-gate", "player-1");

  t.after(async () => {
    if (originalMinimumVersion === undefined) {
      delete process.env.MIN_SUPPORTED_CLIENT_VERSION;
    } else {
      process.env.MIN_SUPPORTED_CLIENT_VERSION = originalMinimumVersion;
    }
    await room.leave(true).catch(() => undefined);
    resetLobbyRoomRegistry();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await assert.rejects(
    () =>
      sendRequest(
        room,
        {
          type: "connect",
          requestId: "connect-old-client",
          roomId: "room-version-gate",
          playerId: "player-1",
          clientVersion: "1.0.2"
        },
        "session.state"
      ),
    /upgrade_required/
  );
});

test("connect handshake accepts clients at or above MIN_SUPPORTED_CLIENT_VERSION", async (t) => {
  const originalMinimumVersion = process.env.MIN_SUPPORTED_CLIENT_VERSION;
  process.env.MIN_SUPPORTED_CLIENT_VERSION = "1.0.3";
  const port = 42700 + Math.floor(Math.random() * 1000);
  const server = await startServer(port);
  const room = await joinRoom(port, "room-version-supported", "player-1");

  t.after(async () => {
    if (originalMinimumVersion === undefined) {
      delete process.env.MIN_SUPPORTED_CLIENT_VERSION;
    } else {
      process.env.MIN_SUPPORTED_CLIENT_VERSION = originalMinimumVersion;
    }
    await room.leave(true).catch(() => undefined);
    resetLobbyRoomRegistry();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await sendRequest(
    room,
    {
      type: "connect",
      requestId: "connect-supported-client",
      roomId: "room-version-supported",
      playerId: "player-1",
      clientVersion: "1.0.3"
    },
    "session.state"
  );

  assert.equal(response.type, "session.state");
  assert.equal(response.payload.world.playerId, "player-1");
});

test("connect handshake applies channel-specific minimum versions from feature-flag config", async (t) => {
  const originalFlagsPath = process.env.VEIL_FEATURE_FLAGS_PATH;
  const originalMinimumVersion = process.env.MIN_SUPPORTED_CLIENT_VERSION;
  const workspace = process.cwd();
  const tempConfigPath = `${workspace}/.tmp-feature-flags-${Date.now()}.json`;
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(
      tempConfigPath,
      JSON.stringify({
        schemaVersion: 1,
        flags: {
          quest_system_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true, rollout: 1 },
          battle_pass_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true, rollout: 1 },
          pve_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true, rollout: 1 },
          tutorial_enabled: { type: "boolean", value: true, defaultValue: true, enabled: true, rollout: 1 }
        },
        runtimeGates: {
          clientMinVersion: {
            defaultVersion: "1.0.0",
            channels: {
              wechat: "1.0.6"
            }
          }
        }
      }),
      "utf8"
    )
  );
  process.env.VEIL_FEATURE_FLAGS_PATH = tempConfigPath;
  delete process.env.MIN_SUPPORTED_CLIENT_VERSION;
  const port = 42800 + Math.floor(Math.random() * 1000);
  const server = await startServer(port);
  const room = await joinRoom(port, "room-channel-version-gate", "player-1");

  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    if (originalFlagsPath === undefined) {
      delete process.env.VEIL_FEATURE_FLAGS_PATH;
    } else {
      process.env.VEIL_FEATURE_FLAGS_PATH = originalFlagsPath;
    }
    if (originalMinimumVersion === undefined) {
      delete process.env.MIN_SUPPORTED_CLIENT_VERSION;
    } else {
      process.env.MIN_SUPPORTED_CLIENT_VERSION = originalMinimumVersion;
    }
    await rm(tempConfigPath, { force: true }).catch(() => undefined);
    await room.leave(true).catch(() => undefined);
    resetLobbyRoomRegistry();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  await assert.rejects(
    () =>
      sendRequest(
        room,
        {
          type: "connect",
          requestId: "connect-wechat-old-client",
          roomId: "room-channel-version-gate",
          playerId: "player-1",
          clientVersion: "1.0.5",
          clientChannel: "wechat"
        },
        "session.state"
      ),
    /upgrade_required/
  );

  const response = await sendRequest(
    room,
    {
      type: "connect",
      requestId: "connect-h5-same-client",
      roomId: "room-channel-version-gate",
      playerId: "player-1",
      clientVersion: "1.0.5",
      clientChannel: "h5"
    },
    "session.state"
  );

  assert.equal(response.type, "session.state");
});
