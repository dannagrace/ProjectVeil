import assert from "node:assert/strict";
import test from "node:test";
import {
  readStoredCocosAuthSession,
  resolveCocosLaunchIdentity
} from "../assets/scripts/cocos-session-launch.ts";

test("readStoredCocosAuthSession parses a cached guest session", () => {
  const values = new Map<string, string>();
  values.set(
    "project-veil:auth-session",
    JSON.stringify({
      token: "signed.token",
      playerId: "player-cocos",
      displayName: "晶塔旅人",
      source: "remote"
    })
  );
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    }
  };

  assert.deepEqual(readStoredCocosAuthSession(storage), {
    token: "signed.token",
    playerId: "player-cocos",
    displayName: "晶塔旅人",
    authMode: "guest",
    source: "remote"
  });
});

test("resolveCocosLaunchIdentity reuses the stored guest session when only roomId is provided", () => {
  const identity = resolveCocosLaunchIdentity({
    defaultRoomId: "test-room",
    defaultPlayerId: "player-1",
    defaultDisplayName: "",
    search: "?roomId=crystal-hall",
    storedSession: {
      token: "signed.token",
      playerId: "player-cocos",
      displayName: "晶塔旅人",
      authMode: "account",
      loginId: "veil-ranger",
      source: "remote"
    }
  });

  assert.deepEqual(identity, {
    roomId: "crystal-hall",
    playerId: "player-cocos",
    displayName: "晶塔旅人",
    authMode: "account",
    loginId: "veil-ranger",
    authToken: "signed.token",
    sessionSource: "remote",
    usedStoredSession: true,
    shouldOpenLobby: false
  });
});

test("resolveCocosLaunchIdentity does not reuse a mismatched stored token when playerId is explicit", () => {
  const identity = resolveCocosLaunchIdentity({
    defaultRoomId: "test-room",
    defaultPlayerId: "player-1",
    defaultDisplayName: "",
    search: "?roomId=crystal-hall&playerId=guest-alt",
    storedSession: {
      token: "signed.token",
      playerId: "player-cocos",
      displayName: "晶塔旅人",
      authMode: "account",
      loginId: "veil-ranger",
      source: "remote"
    }
  });

  assert.deepEqual(identity, {
    roomId: "crystal-hall",
    playerId: "guest-alt",
    displayName: "guest-alt",
    authMode: "guest",
    authToken: null,
    sessionSource: "manual",
    usedStoredSession: false,
    shouldOpenLobby: false
  });
});

test("resolveCocosLaunchIdentity opens lobby mode when roomId is omitted", () => {
  const identity = resolveCocosLaunchIdentity({
    defaultRoomId: "test-room",
    defaultPlayerId: "player-1",
    defaultDisplayName: "",
    search: "",
    storedSession: {
      token: "signed.token",
      playerId: "player-cocos",
      displayName: "晶塔旅人",
      authMode: "account",
      loginId: "veil-ranger",
      source: "remote"
    }
  });

  assert.deepEqual(identity, {
    roomId: "test-room",
    playerId: "player-cocos",
    displayName: "晶塔旅人",
    authMode: "account",
    loginId: "veil-ranger",
    authToken: "signed.token",
    sessionSource: "remote",
    usedStoredSession: true,
    shouldOpenLobby: true
  });
});
