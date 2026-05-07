import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { joinRoomWithRetry } from "../stress-concurrent-rooms.ts";

function createCloseableRoom(onLeave: () => void) {
  return {
    connection: {
      close: onLeave
    },
    leave: async () => {
      onLeave();
    },
    removeAllListeners: () => undefined
  } as never;
}

test("joinRoomWithRetry times out hung room joins instead of waiting forever", async () => {
  let attempts = 0;
  const startedAt = performance.now();

  await assert.rejects(
    joinRoomWithRetry("127.0.0.1", 1, "hung-room", "player-1", {
      attempts: 2,
      retryDelayBaseMs: 1,
      timeoutMs: 5,
      clientFactory: () => ({
        joinOrCreate: async () => {
          attempts += 1;
          return await new Promise(() => undefined);
        }
      })
    }),
    /Timed out joining room hung-room after 5ms/
  );

  assert.equal(attempts, 2);
  assert.ok(performance.now() - startedAt < 250);
});

test("joinRoomWithRetry closes a room if it resolves after the timeout", async () => {
  let leaveCount = 0;

  await assert.rejects(
    joinRoomWithRetry("127.0.0.1", 1, "late-room", "player-1", {
      attempts: 1,
      retryDelayBaseMs: 1,
      timeoutMs: 5,
      clientFactory: () => ({
        joinOrCreate: async () => {
          await delay(20);
          return createCloseableRoom(() => {
            leaveCount += 1;
          });
        }
      })
    }),
    /Timed out joining room late-room after 5ms/
  );

  await delay(40);
  assert.equal(leaveCount, 1);
});

test("joinRoomWithRetry forwards auth tokens to the Colyseus join request", async () => {
  let joinOptions: { logicalRoomId: string; playerId: string; seed: number; authToken?: string } | undefined;

  const room = await joinRoomWithRetry("127.0.0.1", 1, "auth-room", "stress-player", {
    authToken: "stress-token",
    attempts: 1,
    clientFactory: () => ({
      joinOrCreate: async (_roomName, options) => {
        joinOptions = options;
        return createCloseableRoom(() => undefined);
      }
    })
  });

  assert.ok(room);
  assert.deepEqual(joinOptions, {
    logicalRoomId: "auth-room",
    playerId: "stress-player",
    seed: 1001,
    authToken: "stress-token"
  });
});
