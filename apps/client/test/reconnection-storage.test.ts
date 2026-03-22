import assert from "node:assert/strict";
import test from "node:test";
import {
  clearSessionReplay,
  clearReconnectionToken,
  getReconnectionStorageKey,
  getSessionReplayStorageKey,
  readSessionReplay,
  readReconnectionToken,
  writeSessionReplay,
  writeReconnectionToken
} from "../src/local-session";

test("reconnection token helpers use a stable room/player scoped storage key", () => {
  assert.equal(
    getReconnectionStorageKey("room-alpha", "player-1"),
    "project-veil:reconnection:room-alpha:player-1"
  );
  assert.equal(
    getSessionReplayStorageKey("room-alpha", "player-1"),
    "project-veil:session-replay:room-alpha:player-1"
  );
});

test("reconnection token helpers can persist and clear tokens", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    }
  };

  assert.equal(readReconnectionToken(storage, "room-alpha", "player-1"), null);

  writeReconnectionToken(storage, "room-alpha", "player-1", "room-id:reconnect-token");
  assert.equal(readReconnectionToken(storage, "room-alpha", "player-1"), "room-id:reconnect-token");

  clearReconnectionToken(storage, "room-alpha", "player-1");
  assert.equal(readReconnectionToken(storage, "room-alpha", "player-1"), null);
});

test("session replay helpers can persist and clear the latest session snapshot", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    }
  };

  const update = {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 2
      },
      map: {
        width: 2,
        height: 2,
        tiles: []
      },
      ownHeroes: [],
      visibleHeroes: [],
      resources: {
        gold: 300,
        wood: 5,
        ore: 1
      },
      playerId: "player-1"
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 0, y: 0 }]
  };

  assert.equal(readSessionReplay(storage, "room-alpha", "player-1"), null);

  writeSessionReplay(storage, "room-alpha", "player-1", update);
  assert.deepEqual(readSessionReplay(storage, "room-alpha", "player-1"), update);

  clearSessionReplay(storage, "room-alpha", "player-1");
  assert.equal(readSessionReplay(storage, "room-alpha", "player-1"), null);
});

test("session replay helpers ignore malformed cached payloads", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };

  storage.setItem(getSessionReplayStorageKey("room-alpha", "player-1"), "{\"version\":1,\"storedAt\":1}");
  assert.equal(readSessionReplay(storage, "room-alpha", "player-1"), null);

  storage.setItem(getSessionReplayStorageKey("room-alpha", "player-1"), "not-json");
  assert.equal(readSessionReplay(storage, "room-alpha", "player-1"), null);
});
