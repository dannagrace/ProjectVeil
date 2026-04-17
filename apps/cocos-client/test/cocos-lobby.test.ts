import assert from "node:assert/strict";
import test from "node:test";
import {
  claimAllCocosMailboxMessages,
  claimCocosMailboxMessage,
  confirmCocosAccountRegistration,
  confirmCocosPasswordRecovery,
  clearCurrentCocosAuthSession,
  createCocosLobbyPreferences,
  getCocosLobbyPreferencesStorageKey,
  getCocosPlayerAccountStorageKey,
  loadCocosAnnouncements,
  loadCocosBattleReplayHistoryPage,
  loadCocosMaintenanceMode,
  loadCocosPlayerAchievementProgress,
  loadCocosLobbyRooms,
  loadCocosPlayerAccountProfile,
  loadCocosPlayerEventHistory,
  loadCocosPlayerEventLog,
  loadCocosPlayerProgressionSnapshot,
  loginCocosPasswordAuthSession,
  loginCocosGuestAuthSession,
  loginCocosWechatAuthSession,
  requestCocosAccountRegistration,
  requestCocosPasswordRecovery,
  rememberPreferredCocosDisplayName,
  resolveCocosApiBaseUrl,
  resolveCocosConfigCenterUrl,
  submitCocosSupportTicket,
  syncCurrentCocosAuthSession
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

test("resolveCocosConfigCenterUrl points Cocos web flows at the shared config center", () => {
  assert.equal(
    resolveCocosConfigCenterUrl("ws://127.0.0.1:2567/ws", {
      protocol: "http:",
      hostname: "127.0.0.1",
      port: "7456",
      origin: "http://127.0.0.1:7456",
      pathname: "/preview/index.html"
    }),
    "http://127.0.0.1:4173/config-center.html"
  );
  assert.equal(
    resolveCocosConfigCenterUrl("", {
      protocol: "https:",
      hostname: "veil.example.com",
      port: "4173",
      origin: "https://veil.example.com:4173",
      pathname: "/config-center.html"
    }),
    "https://veil.example.com:4173/config-center.html"
  );
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
              disconnectedPlayers: 0,
              heroCount: 1,
              activeBattles: 0,
              statusLabel: "探索中",
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

test("loadCocosAnnouncements returns the active server-side announcement banner list", async () => {
  const requestedUrls: string[] = [];
  const items = await loadCocosAnnouncements("ws://127.0.0.1:2567/ws", {
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "maintenance-preview",
              title: "停服预告",
              message: "10 分钟后进入维护。",
              tone: "warning",
              startsAt: "2026-04-17T08:00:00.000Z"
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

  assert.equal(requestedUrls[0], "http://127.0.0.1:2567/api/announcements/current");
  assert.deepEqual(items, [
    {
      id: "maintenance-preview",
      title: "停服预告",
      message: "10 分钟后进入维护。",
      tone: "warning",
      startsAt: "2026-04-17T08:00:00.000Z"
    }
  ]);
});

test("loadCocosMaintenanceMode normalizes the current maintenance snapshot", async () => {
  const requestedUrls: string[] = [];
  const snapshot = await loadCocosMaintenanceMode("http://127.0.0.1:2567", {
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          active: true,
          title: "停服维护中",
          message: "预计 10:00 恢复。",
          nextOpenAt: "2026-04-17T10:00:00.000Z"
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

  assert.equal(requestedUrls[0], "http://127.0.0.1:2567/api/runtime/maintenance-mode");
  assert.deepEqual(snapshot, {
    active: true,
    title: "停服维护中",
    message: "预计 10:00 恢复。",
    nextOpenAt: "2026-04-17T10:00:00.000Z"
  });
});

test("loadCocosPlayerEventHistory returns normalized paging metadata from the event-history route", async () => {
  const requestedUrls: string[] = [];
  const history = await loadCocosPlayerEventHistory("http://127.0.0.1:2567", "player-1", {
    limit: 2,
    offset: 2
  }, {
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "event-3",
              timestamp: "2026-03-29T12:04:00.000Z",
              roomId: "room-alpha",
              playerId: "player-1",
              category: "combat",
              description: "击退守军",
              worldEventType: "battle.resolved",
              rewards: []
            }
          ],
          total: 5,
          offset: 2,
          limit: 2,
          hasMore: true
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

  assert.equal(requestedUrls[0], "http://127.0.0.1:2567/api/player-accounts/player-1/event-history?limit=2&offset=2");
  assert.equal(history.total, 5);
  assert.equal(history.offset, 2);
  assert.equal(history.limit, 2);
  assert.equal(history.hasMore, true);
  assert.equal(history.items[0]?.id, "event-3");
});

test("loadCocosBattleReplayHistoryPage overfetches one replay to expose hasMore", async () => {
  const requestedUrls: string[] = [];
  const page = await loadCocosBattleReplayHistoryPage("http://127.0.0.1:2567", "player-1", {
    limit: 1,
    offset: 1
  }, {
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "replay-2",
              roomId: "room-alpha",
              playerId: "player-1",
              battleId: "battle-2",
              battleKind: "hero",
              playerCamp: "defender",
              heroId: "hero-1",
              opponentHeroId: "hero-2",
              startedAt: "2026-03-29T12:03:00.000Z",
              completedAt: "2026-03-29T12:04:00.000Z",
              initialState: {
                id: "battle-2",
                round: 1,
                lanes: 1,
                activeUnitId: "stack-1",
                turnOrder: ["stack-1"],
                units: {},
                environment: [],
                log: [],
                rng: { seed: 4, cursor: 0 }
              },
              steps: [],
              result: "defender_victory"
            },
            {
              id: "replay-3",
              roomId: "room-alpha",
              playerId: "player-1",
              battleId: "battle-3",
              battleKind: "neutral",
              playerCamp: "attacker",
              heroId: "hero-1",
              neutralArmyId: "neutral-2",
              startedAt: "2026-03-29T12:05:00.000Z",
              completedAt: "2026-03-29T12:06:00.000Z",
              initialState: {
                id: "battle-3",
                round: 1,
                lanes: 1,
                activeUnitId: "stack-1",
                turnOrder: ["stack-1"],
                units: {},
                environment: [],
                log: [],
                rng: { seed: 5, cursor: 0 }
              },
              steps: [],
              result: "attacker_victory"
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

  assert.equal(requestedUrls[0], "http://127.0.0.1:2567/api/player-accounts/player-1/battle-replays?limit=2&offset=1");
  assert.equal(page.limit, 1);
  assert.equal(page.offset, 1);
  assert.equal(page.hasMore, true);
  assert.deepEqual(page.items.map((item) => item.id), ["replay-3"]);
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
    provider: "guest",
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
    provider: "account-password",
    loginId: "veil-ranger",
    source: "remote"
  });
  assert.ok(values.get("project-veil:auth-session")?.includes("\"authMode\":\"account\""));
});

test("cocos account registration helpers request a dev token and persist the confirmed session", async () => {
  const values = new Map<string, string>();
  const storage = {
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };
  const requests: Array<{ url: string; body: string }> = [];
  let callIndex = 0;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: String(init?.body ?? "")
    });
    callIndex += 1;

    if (callIndex === 1) {
      return new Response(
        JSON.stringify({
          status: "registration_requested",
          expiresAt: "2026-03-28T12:34:56.000Z",
          registrationToken: "dev-registration-token"
        }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        account: {
          playerId: "account-player",
          displayName: "暮潮守望",
          loginId: "veil-ranger"
        },
        session: {
          token: "account.token",
          playerId: "account-player",
          displayName: "暮潮守望",
          authMode: "account",
          loginId: "veil-ranger"
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const requestResult = await requestCocosAccountRegistration("http://127.0.0.1:2567", "Veil-Ranger", "暮潮守望", {
    fetchImpl
  });
  assert.equal(requestResult.registrationToken, "dev-registration-token");

  const session = await confirmCocosAccountRegistration(
    "http://127.0.0.1:2567",
    "Veil-Ranger",
    "dev-registration-token",
    "hunter2",
    { fetchImpl, storage }
  );
  assert.equal(session.loginId, "veil-ranger");
  assert.match(requests[0]?.url ?? "", /\/api\/auth\/account-registration\/request$/);
  assert.match(requests[1]?.url ?? "", /\/api\/auth\/account-registration\/confirm$/);
  assert.ok(values.get("project-veil:auth-session")?.includes("\"loginId\":\"veil-ranger\""));
});

test("cocos password recovery helpers request a dev token and confirm reset", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  let callIndex = 0;
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      body: String(init?.body ?? "")
    });
    callIndex += 1;

    if (callIndex === 1) {
      return new Response(
        JSON.stringify({
          status: "recovery_requested",
          expiresAt: "2026-03-28T12:34:56.000Z",
          recoveryToken: "dev-recovery-token"
        }),
        { status: 202, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ account: { loginId: "veil-ranger" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  const requestResult = await requestCocosPasswordRecovery("http://127.0.0.1:2567", "Veil-Ranger", {
    fetchImpl
  });
  assert.equal(requestResult.recoveryToken, "dev-recovery-token");

  await confirmCocosPasswordRecovery("http://127.0.0.1:2567", "Veil-Ranger", "dev-recovery-token", "hunter3", {
    fetchImpl
  });
  assert.match(requests[0]?.url ?? "", /\/api\/auth\/password-recovery\/request$/);
  assert.match(requests[1]?.url ?? "", /\/api\/auth\/password-recovery\/confirm$/);
});

test("loginCocosWechatAuthSession exchanges wx.login code through the scaffold endpoint", async () => {
  let requestedBody = "";

  const session = await loginCocosWechatAuthSession("http://127.0.0.1:2567", "guest-wechat", "岚桥旅人", {
    wx: {
      login: ({ success }) => {
        success?.({ code: "wx-dev-code" });
      }
    },
    fetchImpl: async (_input, init) => {
      requestedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          session: {
            token: "wechat.token",
            playerId: "guest-wechat",
            displayName: "岚桥旅人",
            authMode: "guest",
            provider: "wechat-mini-game"
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

  assert.match(requestedBody, /"code":"wx-dev-code"/);
  assert.deepEqual(session, {
    token: "wechat.token",
    playerId: "guest-wechat",
    displayName: "岚桥旅人",
    authMode: "guest",
    provider: "wechat-mini-game",
    source: "remote"
  });
});

test("loginCocosWechatAuthSession forwards auth token and user profile details when wx.getUserProfile is available", async () => {
  let requestedBody = "";
  let requestedAuthorization = "";

  const session = await loginCocosWechatAuthSession("http://127.0.0.1:2567", "account-player", "回声旅人", {
    authToken: "account.token",
    wx: {
      login: ({ success }) => {
        success?.({ code: "wx-profile-code" });
      },
      getUserProfile: ({ success }) => {
        success?.({
          userInfo: {
            nickName: "雾海司灯",
            avatarUrl: "https://cdn.example/avatar-wechat.png"
          }
        });
      }
    },
    fetchImpl: async (_input, init) => {
      requestedAuthorization = new Headers(init?.headers).get("Authorization") ?? "";
      requestedBody = String(init?.body ?? "");
      return new Response(
        JSON.stringify({
          session: {
            token: "wechat.account.token",
            playerId: "account-player",
            displayName: "雾海司灯",
            authMode: "account",
            provider: "wechat-mini-game",
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

  assert.equal(requestedAuthorization, "Bearer account.token");
  assert.match(requestedBody, /"code":"wx-profile-code"/);
  assert.match(requestedBody, /"displayName":"雾海司灯"/);
  assert.match(requestedBody, /"avatarUrl":"https:\/\/cdn\.example\/avatar-wechat\.png"/);
  assert.deepEqual(session, {
    token: "wechat.account.token",
    playerId: "account-player",
    displayName: "雾海司灯",
    authMode: "account",
    provider: "wechat-mini-game",
    loginId: "veil-ranger",
    source: "remote"
  });
});

test("loadCocosPlayerAccountProfile uses /me for authenticated sessions and preserves the global vault", async () => {
  const values = new Map<string, string>();
  values.set(getCocosPlayerAccountStorageKey("account-player"), "旧档案名");
  const requestedUrls: string[] = [];
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
      const url = String(input);
      requestedUrls.push(url);
      if (url.endsWith("/api/player-accounts/me")) {
        return new Response(
          JSON.stringify({
            account: {
              playerId: "account-player",
              displayName: "暮潮守望",
              gems: 12,
              loginStreak: 4,
              loginId: "veil-ranger",
              lastRoomId: "room-beta",
              achievements: [
                {
                  id: "first_battle",
                  current: 1,
                  target: 1,
                  unlocked: true,
                  unlockedAt: "2026-03-25T13:00:00.000Z"
                }
              ],
              recentEventLog: [
                {
                  id: "account-player:2026-03-25T13:00:00.000Z:achievement:1:first_battle",
                  timestamp: "2026-03-25T13:00:00.000Z",
                  roomId: "room-beta",
                  playerId: "account-player",
                  category: "achievement",
                  description: "解锁成就：初次交锋",
                  achievementId: "first_battle",
                  rewards: [{ type: "badge", label: "初次交锋" }]
                }
              ],
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

      if (url.endsWith("/api/player-accounts/me/battle-reports")) {
        return new Response(
          JSON.stringify({
            latestReportId: "room-beta:battle-1:account-player",
            items: [
              {
                id: "room-beta:battle-1:account-player",
                replayId: "room-beta:battle-1:account-player",
                roomId: "room-beta",
                playerId: "account-player",
                battleId: "battle-1",
                battleKind: "neutral",
                playerCamp: "attacker",
                heroId: "hero-1",
                neutralArmyId: "neutral-1",
                startedAt: "2026-03-25T12:58:00.000Z",
                completedAt: "2026-03-25T13:00:00.000Z",
                result: "victory",
                turnCount: 1,
                actionCount: 0,
                rewards: [],
                evidence: {
                  replay: "available",
                  rewards: "missing"
                }
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

      if (url.endsWith("/api/player/daily-claim")) {
        return new Response(
          JSON.stringify({
            claimed: true,
            streak: 5,
            reward: {
              gems: 5,
              gold: 75
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

      return new Response(
        JSON.stringify({
          items: [
            {
              id: "room-beta:battle-1:account-player",
              roomId: "room-beta",
              playerId: "account-player",
              battleId: "battle-1",
              battleKind: "neutral",
              playerCamp: "attacker",
              heroId: "hero-1",
              neutralArmyId: "neutral-1",
              startedAt: "2026-03-25T12:58:00.000Z",
              completedAt: "2026-03-25T13:00:00.000Z",
              initialState: {
                id: "battle-1",
                round: 1,
                lanes: 1,
                activeUnitId: "unit-1",
                turnOrder: ["unit-1"],
                units: {
                  "unit-1": {
                    id: "unit-1",
                    camp: "attacker",
                    templateId: "hero_guard_basic",
                    lane: 0,
                    stackName: "暮潮守望",
                    initiative: 4,
                    attack: 2,
                    defense: 2,
                    minDamage: 1,
                    maxDamage: 2,
                    count: 12,
                    currentHp: 10,
                    maxHp: 10,
                    hasRetaliated: false,
                    defending: false
                  }
                },
                environment: [],
                log: [],
                rng: { seed: 7, cursor: 0 }
              },
              steps: [],
              result: "attacker_victory"
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

  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:2567/api/player-accounts/me",
    "http://127.0.0.1:2567/api/player-accounts/me/battle-replays",
    "http://127.0.0.1:2567/api/player-accounts/me/battle-reports",
    "http://127.0.0.1:2567/api/player/daily-claim"
  ]);
  assert.equal(profile.playerId, "account-player");
  assert.equal(profile.displayName, "暮潮守望");
  assert.equal(profile.eloRating, 1000);
  assert.equal(profile.gems, 17);
  assert.equal(profile.loginStreak, 5);
  assert.equal(profile.loginId, "veil-ranger");
  assert.equal(profile.lastRoomId, "room-beta");
  assert.equal(profile.source, "remote");
  assert.deepEqual(profile.globalResources, {
    gold: 395,
    wood: 5,
    ore: 2
  });
  assert.deepEqual(profile.recentEventLog, [
    {
      id: "account-player:2026-03-25T13:00:00.000Z:achievement:1:first_battle",
      timestamp: "2026-03-25T13:00:00.000Z",
      roomId: "room-beta",
      playerId: "account-player",
      category: "achievement",
      description: "解锁成就：初次交锋",
      achievementId: "first_battle",
      rewards: [{ type: "badge", label: "初次交锋" }]
    },
    {
      id: "account-player:2026-03-25T13:00:00.000Z:daily-login:5:client",
      timestamp: "2026-03-25T13:00:00.000Z",
      roomId: "room-beta",
      playerId: "account-player",
      category: "account",
      description: "每日签到奖励：连签第 5 天，获得 宝石 x5、金币 x75。",
      rewards: [
        { type: "resource", label: "gems", amount: 5 },
        { type: "resource", label: "gold", amount: 75 }
      ]
    }
  ]);
  assert.equal(profile.achievements.length, 5);
  assert.deepEqual(profile.achievements[0], {
    id: "first_battle",
    title: "初次交锋",
    description: "首次进入战斗。",
    metric: "battles_started",
    current: 1,
    target: 1,
    unlocked: true,
    progressUpdatedAt: "2026-03-25T13:00:00.000Z",
    unlockedAt: "2026-03-25T13:00:00.000Z"
  });
  assert.deepEqual(profile.achievements[1], {
    id: "enemy_slayer",
    title: "猎敌者",
    description: "击败 3 名敌人或中立守军。",
    metric: "battles_won",
    current: 0,
    target: 3,
    unlocked: false
  });
  assert.deepEqual(profile.achievements[2], {
    id: "skill_scholar",
    title: "求知者",
    description: "学习 5 个长期技能。",
    metric: "skills_learned",
    current: 0,
    target: 5,
    unlocked: false
  });
  assert.deepEqual(profile.achievements[3], {
    id: "world_explorer",
    title: "踏勘全境",
    description: "揭开整张地图的迷雾。",
    metric: "maps_fully_explored",
    current: 0,
    target: 1,
    unlocked: false
  });
  assert.deepEqual(profile.achievements[4], {
    id: "epic_collector",
    title: "史诗武装",
    description: "为同一名英雄装备全套史诗装备。",
    metric: "epic_equipment_slots",
    current: 0,
    target: 3,
    unlocked: false
  });
  assert.deepEqual(profile.recentBattleReplays, [
    {
      id: "room-beta:battle-1:account-player",
      roomId: "room-beta",
      playerId: "account-player",
      battleId: "battle-1",
      battleKind: "neutral",
      playerCamp: "attacker",
      heroId: "hero-1",
      neutralArmyId: "neutral-1",
      startedAt: "2026-03-25T12:58:00.000Z",
      completedAt: "2026-03-25T13:00:00.000Z",
      initialState: {
        id: "battle-1",
        round: 1,
        lanes: 1,
        activeUnitId: "unit-1",
        turnOrder: ["unit-1"],
        units: {
          "unit-1": {
            id: "unit-1",
            camp: "attacker",
            templateId: "hero_guard_basic",
            lane: 0,
            stackName: "暮潮守望",
            initiative: 4,
            attack: 2,
            attackRange: 1,
            defense: 2,
            minDamage: 1,
            maxDamage: 2,
            count: 12,
            currentHp: 10,
            maxHp: 10,
            hasRetaliated: false,
            defending: false,
            skills: [],
            statusEffects: []
          }
        },
        unitCooldowns: {
          "unit-1": {}
        },
        environment: [],
        log: [],
        rng: { seed: 7, cursor: 0 }
      },
      steps: [],
      result: "attacker_victory"
    }
  ]);
  assert.deepEqual(profile.battleReportCenter, {
    latestReportId: "room-beta:battle-1:account-player",
    items: [
      {
        id: "room-beta:battle-1:account-player",
        replayId: "room-beta:battle-1:account-player",
        roomId: "room-beta",
        playerId: "account-player",
        battleId: "battle-1",
        battleKind: "neutral",
        playerCamp: "attacker",
        heroId: "hero-1",
        neutralArmyId: "neutral-1",
        startedAt: "2026-03-25T12:58:00.000Z",
        completedAt: "2026-03-25T13:00:00.000Z",
        result: "victory",
        turnCount: 1,
        actionCount: 0,
        rewards: [],
        evidence: {
          replay: "available",
          rewards: "missing"
        }
      }
    ]
  });
  assert.ok(values.get("project-veil:auth-session")?.includes("\"loginId\":\"veil-ranger\""));
  assert.equal(values.get(getCocosPlayerAccountStorageKey("account-player")), "暮潮守望");
});

test("loadCocosPlayerAccountProfile preserves mailbox payload and summary from /me", async () => {
  const profile = await loadCocosPlayerAccountProfile("http://127.0.0.1:2567", "account-player", "room-beta", {
    authSession: {
      token: "account.token",
      playerId: "account-player",
      displayName: "暮潮守望",
      authMode: "account",
      source: "remote"
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.endsWith("/api/player-accounts/me")) {
        return new Response(
          JSON.stringify({
            account: {
              playerId: "account-player",
              displayName: "暮潮守望",
              globalResources: { gold: 10, wood: 0, ore: 0 },
              achievements: [],
              recentEventLog: [],
              mailbox: [
                {
                  id: "comp-1",
                  kind: "compensation",
                  title: "停机补偿",
                  body: "补发资源。",
                  sentAt: "2026-04-05T00:00:00.000Z",
                  expiresAt: "2026-04-12T00:00:00.000Z",
                  grant: {
                    gems: 30,
                    resources: { gold: 120 }
                  }
                }
              ],
              mailboxSummary: {
                totalCount: 1,
                unreadCount: 1,
                claimableCount: 1,
                expiredCount: 0
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(JSON.stringify({ items: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(profile.mailbox?.[0]?.id, "comp-1");
  assert.equal(profile.mailboxSummary?.claimableCount, 1);
});

test("mailbox claim helpers target the authenticated /me endpoints", async () => {
  const requestedUrls: string[] = [];
  const authSession = {
    token: "account.token",
    playerId: "account-player",
    displayName: "暮潮守望",
    authMode: "account" as const,
    source: "remote" as const
  };

  const claimPayload = await claimCocosMailboxMessage("http://127.0.0.1:2567", "comp-1", {
    authSession,
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ claimed: true, items: [], summary: { totalCount: 1, unreadCount: 0, claimableCount: 0, expiredCount: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  const claimAllPayload = await claimAllCocosMailboxMessages("http://127.0.0.1:2567", {
    authSession,
    fetchImpl: async (input) => {
      requestedUrls.push(String(input));
      return new Response(JSON.stringify({ claimed: true, claimedMessageIds: ["comp-1"], items: [], summary: { totalCount: 1, unreadCount: 0, claimableCount: 0, expiredCount: 0 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });

  assert.equal(claimPayload.claimed, true);
  assert.equal(claimAllPayload.claimed, true);
  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:2567/api/player-accounts/me/mailbox/comp-1/claim",
    "http://127.0.0.1:2567/api/player-accounts/me/mailbox/claim-all"
  ]);
});

test("submitCocosSupportTicket targets the authenticated player support route", async () => {
  const requestedUrls: string[] = [];
  const authSession = {
    token: "account.token",
    playerId: "account-player",
    displayName: "暮潮守望",
    authMode: "account" as const,
    source: "remote" as const
  };

  const payload = await submitCocosSupportTicket(
    "http://127.0.0.1:2567",
    {
      category: "bug",
      message: "设置页按钮重叠。",
      priority: "high"
    },
    {
      authSession,
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));
        return new Response(
          JSON.stringify({
            accepted: true,
            ticket: {
              ticketId: "ticket-1",
              playerId: "account-player",
              category: "bug",
              message: "设置页按钮重叠。",
              priority: "high",
              status: "open",
              createdAt: "2026-04-17T12:00:00.000Z",
              updatedAt: "2026-04-17T12:00:00.000Z"
            }
          }),
          {
            status: 202,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
    }
  );

  assert.equal(payload.accepted, true);
  assert.equal(payload.ticket.ticketId, "ticket-1");
  assert.equal(payload.ticket.priority, "high");
  assert.deepEqual(requestedUrls, [
    "http://127.0.0.1:2567/api/player-accounts/me/support-tickets"
  ]);
});

test("loadCocosPlayerEventLog sends shared filters through the public query route", async () => {
  let requestedUrl = "";

  const items = await loadCocosPlayerEventLog("ws://127.0.0.1:2567/ws", "player-1", {
    limit: 1,
    category: "achievement",
    heroId: "hero-1",
    achievementId: "first_battle",
    worldEventType: "battle.started"
  }, {
    fetchImpl: async (input) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "event-older",
              timestamp: "2026-03-27T12:01:00.000Z",
              roomId: "room-alpha",
              playerId: "player-1",
              category: "achievement",
              description: "older",
              heroId: "hero-1",
              achievementId: "first_battle",
              worldEventType: "battle.started",
              rewards: []
            },
            {
              id: "event-newer",
              timestamp: "2026-03-27T12:03:00.000Z",
              roomId: "room-alpha",
              playerId: "player-1",
              category: "achievement",
              description: "newer",
              heroId: "hero-1",
              achievementId: "first_battle",
              worldEventType: "battle.started",
              rewards: [{ type: "badge", label: "初次交锋" }]
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

  assert.equal(
    requestedUrl,
    "http://127.0.0.1:2567/api/player-accounts/player-1/event-log?limit=1&category=achievement&heroId=hero-1&achievementId=first_battle&worldEventType=battle.started"
  );
  assert.deepEqual(items.map((entry) => entry.id), ["event-newer", "event-older"]);
});

test("loadCocosPlayerAchievementProgress uses /me for authenticated queries and normalizes progress", async () => {
  let requestedUrl = "";

  const items = await loadCocosPlayerAchievementProgress("http://127.0.0.1:2567", "player-1", {
    limit: 1,
    achievementId: "enemy_slayer",
    metric: "battles_won",
    unlocked: false
  }, {
    authSession: {
      token: "session-token",
      playerId: "player-1",
      displayName: "雾林司灯",
      authMode: "guest",
      source: "remote"
    },
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      assert.equal((init?.headers as Record<string, string> | undefined)?.Authorization, "Bearer session-token");
      return new Response(
        JSON.stringify({
          items: [
            {
              id: "enemy_slayer",
              current: 2,
              progressUpdatedAt: "2026-03-27T12:02:00.000Z"
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

  assert.equal(
    requestedUrl,
    "http://127.0.0.1:2567/api/player-accounts/me/achievements?limit=1&achievementId=enemy_slayer&metric=battles_won&unlocked=false"
  );
  assert.deepEqual(items.map((entry) => entry.id), ["enemy_slayer"]);
  assert.equal(items[0]?.title, "猎敌者");
  assert.equal(items[0]?.current, 2);
});

test("loadCocosPlayerProgressionSnapshot clears expired auth sessions and falls back to normalized defaults", async () => {
  const values = new Map<string, string>([
    [
      "project-veil:auth-session",
      JSON.stringify({
        playerId: "player-1",
        displayName: "雾林司灯",
        authMode: "guest",
        token: "session-token",
        source: "remote"
      })
    ]
  ]);
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    }
  };

  const snapshot = await loadCocosPlayerProgressionSnapshot("http://127.0.0.1:2567", "player-1", 2, {
    storage,
    fetchImpl: async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })
  });

  assert.equal(snapshot.summary.totalAchievements, 5);
  assert.equal(snapshot.summary.unlockedAchievements, 0);
  assert.deepEqual(snapshot.recentEventLog, []);
  assert.equal(values.has("project-veil:auth-session"), false);
});

test("syncCurrentCocosAuthSession refreshes an expired access token and persists the rotated session", async () => {
  const values = new Map<string, string>([
    [
      "project-veil:auth-session",
      JSON.stringify({
        playerId: "player-1",
        displayName: "雾林司灯",
        authMode: "account",
        loginId: "veil-ranger",
        provider: "account-password",
        token: "expired-access",
        refreshToken: "refresh-token",
        source: "remote"
      })
    ]
  ]);
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
  const authorizations: string[] = [];
  let callIndex = 0;

  const session = await syncCurrentCocosAuthSession("http://127.0.0.1:2567", {
    storage,
    fetchImpl: async (_input, init) => {
      authorizations.push((init?.headers as Record<string, string> | undefined)?.Authorization ?? "");
      callIndex += 1;
      if (callIndex === 1) {
        return new Response(JSON.stringify({ error: { code: "token_expired" } }), { status: 401 });
      }
      return new Response(
        JSON.stringify({
          session: {
            token: callIndex === 2 ? "fresh-access" : "fresh-access",
            refreshToken: callIndex === 2 ? "fresh-refresh" : "fresh-refresh",
            playerId: "player-1",
            displayName: "雾林司灯",
            authMode: "account",
            provider: "account-password",
            loginId: "veil-ranger"
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  });

  assert.equal(session?.token, "fresh-access");
  assert.equal(session?.refreshToken, "fresh-refresh");
  assert.deepEqual(authorizations, ["Bearer expired-access", "Bearer refresh-token", "Bearer fresh-access"]);
});
