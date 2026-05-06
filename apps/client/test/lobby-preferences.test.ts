import assert from "node:assert/strict";
import test from "node:test";
import {
  createGuestPlayerId,
  createLobbyPreferences,
  getLobbyPreferencesStorageKey,
  loadLobbyRooms
} from "../src/lobby-preferences";

test("lobby preferences use a stable storage key", () => {
  assert.equal(getLobbyPreferencesStorageKey(), "project-veil:lobby-preferences");
});

test("lobby preferences can create deterministic guest player ids", () => {
  assert.equal(createGuestPlayerId(0), "guest-000000");
  assert.equal(createGuestPlayerId(0.345678), "guest-345678");
});

test("lobby preferences honor explicit room and player overrides", () => {
  assert.deepEqual(createLobbyPreferences({ playerId: "  scout-7 ", roomId: "  room-bravo " }), {
    playerId: "scout-7",
    roomId: "room-bravo"
  });
});

test("loadLobbyRooms skips the protected room-list request until an auth token exists", async (t) => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("unexpected lobby request");
  }) as typeof fetch;

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  assert.deepEqual(await loadLobbyRooms(12, "  "), []);
  assert.equal(fetchCalled, false);
});
