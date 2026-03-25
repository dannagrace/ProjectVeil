import assert from "node:assert/strict";
import test from "node:test";
import {
  createGuestPlayerId,
  createLobbyPreferences,
  getLobbyPreferencesStorageKey
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
