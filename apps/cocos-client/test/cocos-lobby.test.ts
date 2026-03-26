import assert from "node:assert/strict";
import test from "node:test";
import {
  clearCurrentCocosAuthSession,
  createCocosLobbyPreferences,
  getCocosLobbyPreferencesStorageKey,
  getCocosPlayerAccountStorageKey,
  loadCocosLobbyRooms,
  loadCocosPlayerAccountProfile,
  loginCocosPasswordAuthSession,
  loginCocosGuestAuthSession,
  rememberPreferredCocosDisplayName,
  resolveCocosApiBaseUrl
} from "../assets/scripts/cocos-lobby.ts";

test("createCocosLobbyPreferences reuses stored values and falls back to room-alpha", () => {
  const values = new Map<string, string>();
  values.set(
    getCocosLobbyPreferencesStorageKey(),
    JSON.stringify({
      playerId: "guest-123456",
      roomId: "stored-room"
    })
  );
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    }
  };

  assert.deepEqual(createCocosLobbyPreferences({}, undefined, storage), {
    playerId: "guest-123456",
    roomId: "stored-room"
  });
  assert.deepEqual(createCocosLobbyPreferences({ playerId: "guest-654321" }, undefined, storage), {
    playerId: "guest-654321",
    roomId: "stored-room"
  });
});

test("rememberPreferredCocosDisplayName persists normalized names with the shared storage key", () => {
  const values = new Map<string, string>();
  const storage = {
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };

  const displayName = rememberPreferredCocosDisplayName("guest-111111", "  星霜旅人  ", storage);
  assert.equal(displayName, "星霜旅人");
  assert.equal(values.get(getCocosPlayerAccountStorageKey("guest-111111")), "星霜旅人");
});

test("resolveCocosApiBaseUrl converts websocket endpoints into http api roots", () => {
  assert.equal(resolveCocosApiBaseUrl("ws://127.0.0.1:2567/ws"), "http://127.0.0.1:2567");
  assert.equal(resolveCocosApiBaseUrl("wss://veil.example.com/socket"), "https://veil.example.com");
});

test("loadCocosLobbyRooms queries the lobby api from the resolved remote host", async () => {
  const requestedUrls: string[] = [];
  const rooms = await loadCocosLobbyRooms("ws://127.0.0.1:2567/ws", 3, {
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          items: [
            {
              roomId: "room-alpha",
              seed: 1001,
              day: 3,
              connectedPlayers: 1,
              heroCount: 1,
              activeBattles: 0,
              updatedAt: "2026-03-25T12:00:00.000Z"
            }
          ]
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
  });

  assert.equal(requestedUrls[0], "http://127.0.0.1:2567/api/lobby/rooms?limit=3");
  assert.equal(rooms[0]?.roomId, "room-alpha");
});

test("loginCocosGuestAuthSession stores remote sessions and clearCurrentCocosAuthSession removes them", async () => {
  const values = new Map<string, string>();
  const storage = {
    setItem(key: string, value: string): void {
      values.set(key, value);
    },
    removeItem(key: string): void {
      values.delete(key);
    }
  };

  const session = await loginCocosGuestAuthSession("http://127.0.0.1:2567", "guest-202503", "晶塔旅人", {
    storage,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          session: {
            token: "signed.token",
            playerId: "guest-202503",
            displayName: "晶塔旅人"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
  });

  assert.deepEqual(session, {
    token: "signed.token",
    playerId: "guest-202503",
    displayName: "晶塔旅人",
    authMode: "guest",
    source: "remote"
  });

  clearCurrentCocosAuthSession(storage);
  assert.equal(values.size, 0);
});

test("loginCocosPasswordAuthSession stores account sessions with loginId", async () => {
  const values = new Map<string, string>();
  const storage = {
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };

  const session = await loginCocosPasswordAuthSession("http://127.0.0.1:2567", "Veil-Ranger", "hunter2", {
    storage,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          session: {
            token: "account.token",
            playerId: "account-player",
            displayName: "暮潮守望",
            authMode: "account",
            loginId: "veil-ranger"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      )
  });

  assert.deepEqual(session, {
    token: "account.token",
    playerId: "account-player",
    displayName: "暮潮守望",
    authMode: "account",
    loginId: "veil-ranger",
    source: "remote"
  });
  assert.ok(values.get("project-veil:auth-session")?.includes("\"authMode\":\"account\""));
});

test("loadCocosPlayerAccountProfile uses /me for authenticated sessions and preserves the global vault", async () => {
  const values = new Map<string, string>();
  values.set(getCocosPlayerAccountStorageKey("account-player"), "旧档案名");
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

  const profile = await loadCocosPlayerAccountProfile("http://127.0.0.1:2567", "account-player", "room-beta", {
    storage,
    authSession: {
      token: "account.token",
      playerId: "account-player",
      displayName: "暮潮守望",
      authMode: "account",
      loginId: "veil-ranger",
      source: "remote"
    },
    fetchImpl: async (input) => {
      assert.equal(String(input), "http://127.0.0.1:2567/api/player-accounts/me");
      return new Response(
        JSON.stringify({
          account: {
            playerId: "account-player",
            displayName: "暮潮守望",
            loginId: "veil-ranger",
            lastRoomId: "room-beta",
            globalResources: {
              gold: 320,
              wood: 5,
              ore: 2
            }
          },
          session: {
            token: "account.token.next",
            playerId: "account-player",
            displayName: "暮潮守望",
            authMode: "account",
            loginId: "veil-ranger"
          }
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }
  });

  assert.deepEqual(profile, {
    playerId: "account-player",
    displayName: "暮潮守望",
    globalResources: {
      gold: 320,
      wood: 5,
      ore: 2
    },
    loginId: "veil-ranger",
    lastRoomId: "room-beta",
    source: "remote"
  });
  assert.ok(values.get("project-veil:auth-session")?.includes("\"loginId\":\"veil-ranger\""));
  assert.equal(values.get(getCocosPlayerAccountStorageKey("account-player")), "暮潮守望");
});
