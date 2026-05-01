import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPlayerProgressionSnapshot,
  createFallbackPlayerAccountProfile,
  getPlayerAccountStorageKey,
  loadPlayerAccountProfile,
  loadPlayerAccountProfileWithProgression,
  loadPlayerAchievementProgress,
  loadPlayerBattleReplayDetail,
  loadPlayerBattleReplayPlayback,
  loadPlayerBattleReplaySummaries,
  loadPlayerEventLog,
  loadPlayerAccountSessions,
  loadPlayerProgressionSnapshot,
  readStoredPlayerDisplayName,
  revokePlayerAccountSession,
  writeStoredPlayerDisplayName
} from "../src/player-account";

test("player account helpers use a stable player scoped storage key", () => {
  assert.equal(getPlayerAccountStorageKey("player-1"), "project-veil:player-account:player-1");
});

test("player account helpers persist normalized display names", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };

  assert.equal(readStoredPlayerDisplayName(storage, "player-1"), null);

  writeStoredPlayerDisplayName(storage, "player-1", "  霜狼领主  ");
  assert.equal(readStoredPlayerDisplayName(storage, "player-1"), "霜狼领主");

  writeStoredPlayerDisplayName(storage, "player-1", "   ");
  assert.equal(readStoredPlayerDisplayName(storage, "player-1"), "player-1");
});

test("player account helpers can build a local fallback profile", () => {
  assert.deepEqual(createFallbackPlayerAccountProfile("player-9", "room-beta", "本地访客"), {
    playerId: "player-9",
    displayName: "本地访客",
    eloRating: 1000,
    rankDivision: "bronze_iii",
    peakRankDivision: "bronze_iii",
    gems: 0,
    globalResources: {
      gold: 0,
      wood: 0,
      ore: 0
    },
    achievements: [
      {
        id: "first_battle",
        title: "初次交锋",
        description: "首次进入战斗。",
        metric: "battles_started",
        current: 0,
        target: 1,
        unlocked: false
      },
      {
        id: "enemy_slayer",
        title: "猎敌者",
        description: "击败 3 名敌人或中立守军。",
        metric: "battles_won",
        current: 0,
        target: 3,
        unlocked: false
      },
      {
        id: "skill_scholar",
        title: "求知者",
        description: "学习 5 个长期技能。",
        metric: "skills_learned",
        current: 0,
        target: 5,
        unlocked: false
      },
      {
        id: "world_explorer",
        title: "踏勘全境",
        description: "揭开整张地图的迷雾。",
        metric: "maps_fully_explored",
        current: 0,
        target: 1,
        unlocked: false
      },
      {
        id: "epic_collector",
        title: "史诗武装",
        description: "为同一名英雄装备全套史诗装备。",
        metric: "epic_equipment_slots",
        current: 0,
        target: 3,
        unlocked: false
      }
    ],
    recentEventLog: [],
    recentBattleReplays: [],
    battleReportCenter: {
      latestReportId: null,
      items: []
    },
    lastRoomId: "room-beta",
    source: "local"
  });
});

test("player account progression overlay keeps existing account data when snapshot is empty", () => {
  const account = createFallbackPlayerAccountProfile("player-9", "room-beta", "本地访客");

  const merged = applyPlayerProgressionSnapshot(account, {
    summary: {
      totalAchievements: 5,
      unlockedAchievements: 0,
      inProgressAchievements: 0,
      recentEventCount: 0
    },
    achievements: account.achievements,
    recentEventLog: []
  });

  assert.deepEqual(merged, account);
});

test("player account loader can overlay progression snapshot onto base account profile", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(): string | null {
          return null;
        },
        setItem(): void {}
      }
    }
  });

  globalThis.fetch = (async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith("/progression?limit=2")) {
      return new Response(
        JSON.stringify({
          summary: {
            totalAchievements: 5,
            unlockedAchievements: 1,
            inProgressAchievements: 1,
            latestUnlockedAchievementId: "first_battle",
            latestUnlockedAt: "2026-03-27T12:00:00.000Z",
            latestProgressAchievementId: "enemy_slayer",
            latestProgressAt: "2026-03-27T12:02:00.000Z",
            recentEventCount: 1,
            latestEventAt: "2026-03-27T12:03:00.000Z"
          },
          achievements: [
            {
              id: "first_battle",
              current: 1,
              unlockedAt: "2026-03-27T12:00:00.000Z"
            },
            {
              id: "enemy_slayer",
              current: 2,
              progressUpdatedAt: "2026-03-27T12:02:00.000Z"
            }
          ],
          recentEventLog: [
            {
              id: "event-1",
              timestamp: "2026-03-27T12:03:00.000Z",
              roomId: "room-alpha",
              playerId: "player-1",
              category: "achievement",
              description: "解锁成就：初次交锋",
              achievementId: "first_battle",
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

    return new Response(
      JSON.stringify({
        account: {
          playerId: "player-1",
          displayName: "暮火侦骑",
          globalResources: {
            gold: 12,
            wood: 4,
            ore: 2
          },
          achievements: [],
          recentEventLog: [],
          lastRoomId: "room-alpha"
        }
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  try {
    const account = await loadPlayerAccountProfileWithProgression("player-1", "room-alpha", 2);

    assert.deepEqual(requestedUrls, [
      "http://127.0.0.1:2567/api/player-accounts/player-1",
      "http://127.0.0.1:2567/api/player-accounts/player-1/battle-replays",
      "http://127.0.0.1:2567/api/player-accounts/player-1/battle-reports",
      "http://127.0.0.1:2567/api/player-accounts/player-1/progression?limit=2"
    ]);
    assert.equal(account.displayName, "暮火侦骑");
    assert.equal(account.achievements[0]?.id, "first_battle");
    assert.equal(account.achievements[1]?.current, 2);
    assert.deepEqual(account.recentEventLog.map((entry) => entry.id), ["event-1"]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player account session helpers list and revoke formal-account device sessions", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const values = new Map<string, string>([
    [
      "project-veil:auth-session",
      JSON.stringify({
        playerId: "player-1",
        displayName: "暮火侦骑",
        authMode: "account",
        loginId: "veil-ranger",
        sessionId: "session-current",
        token: "access-token",
        refreshToken: "refresh-token",
        source: "remote"
      })
    ]
  ]);
  const requests: Array<{ url: string; method: string; authorization?: string }> = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(key: string): string | null {
          return values.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          values.set(key, value);
        },
        removeItem(key: string): void {
          values.delete(key);
        }
      }
    }
  });

  globalThis.fetch = (async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      authorization: (init?.headers as Record<string, string> | undefined)?.Authorization
    });

    return new Response(
      JSON.stringify({
        items:
          init?.method === "DELETE"
            ? [
                {
                  sessionId: "session-current",
                  provider: "account-password",
                  deviceLabel: "Current Browser",
                  lastUsedAt: "2026-03-29T08:00:00.000Z",
                  createdAt: "2026-03-28T08:00:00.000Z",
                  refreshExpiresAt: "2026-04-28T08:00:00.000Z",
                  current: true
                }
              ]
            : [
                {
                  sessionId: "session-current",
                  provider: "account-password",
                  deviceLabel: "Current Browser",
                  lastUsedAt: "2026-03-29T08:00:00.000Z",
                  createdAt: "2026-03-28T08:00:00.000Z",
                  refreshExpiresAt: "2026-04-28T08:00:00.000Z",
                  current: true
                },
                {
                  sessionId: "session-other",
                  provider: "wechat-mini-game",
                  deviceLabel: "WeChat DevTools",
                  lastUsedAt: "2026-03-29T07:00:00.000Z",
                  createdAt: "2026-03-27T07:00:00.000Z",
                  refreshExpiresAt: "2026-04-27T07:00:00.000Z",
                  current: false
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
  }) as typeof fetch;

  try {
    const sessions = await loadPlayerAccountSessions();
    assert.deepEqual(sessions.map((session) => session.sessionId), ["session-current", "session-other"]);

    const remainingSessions = await revokePlayerAccountSession("session-other");
    assert.deepEqual(remainingSessions.map((session) => session.sessionId), ["session-current"]);
    assert.deepEqual(
      requests.map((request) => [request.method, request.url, request.authorization]),
      [
        ["GET", "http://127.0.0.1:2567/api/player-accounts/me/sessions", "Bearer access-token"],
        ["DELETE", "http://127.0.0.1:2567/api/player-accounts/me/sessions/session-other", "Bearer access-token"]
      ]
    );
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player replay loader sends shared filters and normalizes newest first", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(): string | null {
          return null;
        },
        setItem(): void {}
      }
    }
  });

  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        items: [
          {
            id: "replay-older",
            roomId: "room-alpha",
            playerId: "player-1",
            battleId: "battle-1",
            battleKind: "hero",
            playerCamp: "attacker",
            heroId: "hero-1",
            startedAt: "2026-03-27T11:58:00.000Z",
            completedAt: "2026-03-27T12:00:00.000Z",
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
                  stackName: "暮火侦骑",
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
          },
          {
            id: "replay-newer",
            roomId: "room-alpha",
            playerId: "player-1",
            battleId: "battle-2",
            battleKind: "hero",
            playerCamp: "defender",
            heroId: "hero-1",
            opponentHeroId: "hero-9",
            startedAt: "2026-03-27T12:01:00.000Z",
            completedAt: "2026-03-27T12:02:00.000Z",
            initialState: {
              id: "battle-2",
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
                  stackName: "暮火侦骑",
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
              rng: { seed: 8, cursor: 0 }
            },
            steps: [],
            result: "defender_victory"
          },
          {
            id: "replay-older",
            roomId: "room-alpha",
            playerId: "player-1",
            battleId: "battle-3",
            battleKind: "hero",
            playerCamp: "defender",
            heroId: "hero-1",
            opponentHeroId: "hero-9",
            startedAt: "2026-03-27T11:59:00.000Z",
            completedAt: "2026-03-27T12:00:00.000Z",
            initialState: {
              id: "battle-3",
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
                  stackName: "暮火侦骑",
                  initiative: 4,
                  attack: 2,
                  defense: 2,
                  minDamage: 1,
                  maxDamage: 2,
                  count: 10,
                  currentHp: 10,
                  maxHp: 10,
                  hasRetaliated: false,
                  defending: false
                }
              },
              environment: [],
              log: [],
              rng: { seed: 9, cursor: 0 }
            },
            steps: [],
            result: "defender_victory"
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
  }) as typeof fetch;

  try {
    const replays = await loadPlayerBattleReplaySummaries("player-1", {
      limit: 1,
      offset: 0,
      roomId: "room-alpha",
      battleKind: "hero",
      playerCamp: "defender",
      heroId: "hero-1",
      opponentHeroId: "hero-9",
      result: "defender_victory"
    });
    assert.equal(
      requestedUrl,
      "http://127.0.0.1:2567/api/player-accounts/player-1/battle-replays?limit=1&offset=0&roomId=room-alpha&battleKind=hero&playerCamp=defender&heroId=hero-1&opponentHeroId=hero-9&result=defender_victory"
    );
    assert.deepEqual(replays.map((replay) => replay.id), ["replay-newer"]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player replay loader clears expired auth session and falls back to normalized filtered defaults", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        values: new Map<string, string>([
          [
            "project-veil:auth-session",
            JSON.stringify({
              playerId: "player-1",
              displayName: "暮火侦骑",
              authMode: "guest",
              token: "expired-token",
              source: "guest"
            })
          ]
        ]),
        getItem(key: string): string | null {
          return this.values.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          this.values.set(key, value);
        },
        removeItem(key: string): void {
          this.values.delete(key);
        }
      }
    }
  });

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "unauthorized",
          message: "expired"
        }
      }),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json"
        }
      }
    )) as typeof fetch;

  try {
    const replays = await loadPlayerBattleReplaySummaries("player-1", {
      limit: 1,
      battleKind: "neutral"
    });
    assert.deepEqual(replays, []);
    assert.equal(globalThis.window.localStorage.getItem("project-veil:auth-session"), null);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player replay detail loader requests a replay by id and normalizes the payload", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(): string | null {
          return null;
        },
        setItem(): void {}
      }
    }
  });

  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(
      JSON.stringify({
        replay: {
          id: "replay-detail",
          roomId: "room-alpha",
          playerId: "player-1",
          battleId: "battle-1",
          battleKind: "neutral",
          playerCamp: "attacker",
          heroId: "hero-1",
          neutralArmyId: "neutral-1",
          startedAt: "2026-03-27T12:00:00.000Z",
          completedAt: "2026-03-27T12:01:00.000Z",
          initialState: {
            id: "battle-1",
            round: 1,
            lanes: 1,
            activeUnitId: "stack-1",
            turnOrder: ["stack-1"],
            units: {
              "stack-1": {
                id: "stack-1",
                camp: "attacker",
                templateId: "hero_guard_basic",
                lane: 0,
                stackName: "暮火侦骑",
                initiative: 3,
                attack: 2,
                defense: 1,
                minDamage: 1,
                maxDamage: 2,
                count: 10,
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
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  try {
    const replay = await loadPlayerBattleReplayDetail("player-1", "replay-detail");
    assert.equal(
      requestedUrl,
      "http://127.0.0.1:2567/api/player-accounts/player-1/battle-replays/replay-detail"
    );
    assert.equal(replay?.id, "replay-detail");
    assert.equal(replay?.neutralArmyId, "neutral-1");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player replay playback loader uses stateless command query params and clears expired auth", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const localStorageValues = new Map<string, string>([
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
  const requestedUrls: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(key: string): string | null {
          return localStorageValues.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          localStorageValues.set(key, value);
        },
        removeItem(key: string): void {
          localStorageValues.delete(key);
        }
      }
    }
  });

  globalThis.fetch = (async (input) => {
    requestedUrls.push(String(input));
    if (requestedUrls.length === 1) {
      return new Response(
        JSON.stringify({
          playback: {
            replay: {
              id: "replay-playback",
              roomId: "room-alpha",
              playerId: "player-1",
              battleId: "battle-1",
              battleKind: "neutral",
              playerCamp: "attacker",
              heroId: "hero-1",
              neutralArmyId: "neutral-1",
              startedAt: "2026-03-27T12:00:00.000Z",
              completedAt: "2026-03-27T12:01:00.000Z",
              initialState: {
                id: "battle-1",
                round: 1,
                lanes: 1,
                activeUnitId: "stack-1",
                turnOrder: ["stack-1"],
                units: {
                  "stack-1": {
                    id: "stack-1",
                    camp: "attacker",
                    templateId: "hero_guard_basic",
                    lane: 0,
                    stackName: "暮火侦骑",
                    initiative: 3,
                    attack: 2,
                    defense: 1,
                    minDamage: 1,
                    maxDamage: 2,
                    count: 10,
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
              steps: [
                {
                  index: 1,
                  source: "player",
                  action: {
                    type: "battle.wait",
                    unitId: "stack-1"
                  }
                }
              ],
              result: "attacker_victory"
            },
            status: "playing",
            currentStepIndex: 1
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

    return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  }) as typeof fetch;

  try {
    const playback = await loadPlayerBattleReplayPlayback("player-1", "replay-playback", {
      currentStepIndex: 0,
      status: "paused",
      action: "tick",
      repeat: 1
    });
    assert.equal(
      requestedUrls[0],
      "http://127.0.0.1:2567/api/player-accounts/me/battle-replays/replay-playback/playback?currentStepIndex=0&status=paused&action=tick&repeat=1"
    );
    assert.equal(playback?.status, "completed");
    assert.equal(playback?.currentStepIndex, 1);

    const missingPlayback = await loadPlayerBattleReplayPlayback("player-1", "replay-playback");
    assert.equal(missingPlayback, null);
    assert.equal(localStorageValues.has("project-veil:auth-session"), false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player event-log loader sends shared filters and normalizes newest entries first", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(): string | null {
          return null;
        },
        setItem(): void {}
      }
    }
  });

  globalThis.fetch = (async (input) => {
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
  }) as typeof fetch;

  try {
    const items = await loadPlayerEventLog("player-1", {
      limit: 1,
      category: "achievement",
      heroId: "hero-1",
      achievementId: "first_battle",
      worldEventType: "battle.started"
    });

    assert.equal(
      requestedUrl,
      "http://127.0.0.1:2567/api/player-accounts/player-1/event-log?limit=1&category=achievement&heroId=hero-1&achievementId=first_battle&worldEventType=battle.started"
    );
    assert.deepEqual(items.map((entry) => entry.id), ["event-newer", "event-older"]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player event-log loader clears expired auth session and falls back to empty items", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const localStorageValues = new Map<string, string>([
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

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(key: string): string | null {
          return localStorageValues.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          localStorageValues.set(key, value);
        },
        removeItem(key: string): void {
          localStorageValues.delete(key);
        }
      }
    }
  });

  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as typeof fetch;

  try {
    const items = await loadPlayerEventLog("player-1", {
      category: "achievement"
    });

    assert.deepEqual(items, []);
    assert.equal(localStorageValues.has("project-veil:auth-session"), false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player achievement loader sends shared filters and normalizes definition-backed progress", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(): string | null {
          return null;
        },
        setItem(): void {}
      }
    }
  });

  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
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
  }) as typeof fetch;

  try {
    const items = await loadPlayerAchievementProgress("player-1", {
      limit: 1,
      achievementId: "enemy_slayer",
      metric: "battles_won",
      unlocked: false
    });

    assert.equal(
      requestedUrl,
      "http://127.0.0.1:2567/api/player-accounts/player-1/achievements?limit=1&achievementId=enemy_slayer&metric=battles_won&unlocked=false"
    );
    assert.deepEqual(items.map((entry) => entry.id), ["enemy_slayer"]);
    assert.equal(items[0]?.title, "猎敌者");
    assert.equal(items[0]?.current, 2);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player achievement loader clears expired auth session and falls back to normalized filtered defaults", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const localStorageValues = new Map<string, string>([
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

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(key: string): string | null {
          return localStorageValues.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          localStorageValues.set(key, value);
        },
        removeItem(key: string): void {
          localStorageValues.delete(key);
        }
      }
    }
  });

  globalThis.fetch = (async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 })) as typeof fetch;

  try {
    const items = await loadPlayerAchievementProgress("player-1", {
      unlocked: true
    });

    assert.deepEqual(items, []);
    assert.equal(localStorageValues.has("project-veil:auth-session"), false);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player account profile loader merges recent battle replays from the dedicated endpoint", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(): string | null {
          return null;
        },
        setItem(): void {}
      }
    }
  });

  globalThis.fetch = (async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith("/api/player-accounts/player-1")) {
      return new Response(
        JSON.stringify({
          account: {
            playerId: "player-1",
            displayName: "霜火游侠",
            globalResources: {
              gold: 320,
              wood: 5,
              ore: 2
            },
            experiments: [
              {
                experimentKey: "account_portal_copy",
                experimentName: "Account Portal Upgrade Copy",
                owner: "growth",
                bucket: 18,
                variant: "upgrade",
                fallbackVariant: "control",
                assigned: true,
                reason: "bucket"
              }
            ]
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

    if (url.endsWith("/api/player-accounts/player-1/battle-reports")) {
      return new Response(
        JSON.stringify({
          latestReportId: "replay-newer",
          items: [
            {
              id: "replay-newer",
              replayId: "replay-newer",
              roomId: "room-alpha",
              playerId: "player-1",
              battleId: "battle-2",
              battleKind: "neutral",
              playerCamp: "attacker",
              heroId: "hero-1",
              neutralArmyId: "neutral-1",
              startedAt: "2026-03-27T12:01:00.000Z",
              completedAt: "2026-03-27T12:02:00.000Z",
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

    return new Response(
      JSON.stringify({
        items: [
          {
            id: "replay-newer",
            roomId: "room-alpha",
            playerId: "player-1",
            battleId: "battle-2",
            battleKind: "neutral",
            playerCamp: "attacker",
            heroId: "hero-1",
            neutralArmyId: "neutral-1",
            startedAt: "2026-03-27T12:01:00.000Z",
            completedAt: "2026-03-27T12:02:00.000Z",
            initialState: {
              id: "battle-2",
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
                  stackName: "暮火侦骑",
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
              rng: { seed: 8, cursor: 0 }
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
  }) as typeof fetch;

  try {
    const profile = await loadPlayerAccountProfile("player-1", "room-alpha");
    assert.deepEqual(requestedUrls, [
      "http://127.0.0.1:2567/api/player-accounts/player-1",
      "http://127.0.0.1:2567/api/player-accounts/player-1/battle-replays",
      "http://127.0.0.1:2567/api/player-accounts/player-1/battle-reports"
    ]);
    assert.equal(profile.displayName, "霜火游侠");
    assert.deepEqual(profile.recentBattleReplays.map((replay) => replay.id), ["replay-newer"]);
    assert.equal(profile.battleReportCenter?.latestReportId, "replay-newer");
    assert.equal(profile.battleReportCenter?.items[0]?.evidence.rewards, "missing");
    assert.equal(profile.experiments?.[0]?.experimentKey, "account_portal_copy");
    assert.equal(profile.experiments?.[0]?.variant, "upgrade");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player account loader reuses rotated session from profile response for replay and report reads", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const localStorageValues = new Map<string, string>([
    [
      "project-veil:auth-session",
      JSON.stringify({
        playerId: "player-1",
        displayName: "暮火侦骑",
        authMode: "guest",
        sessionId: "session-current",
        token: "old-token",
        refreshToken: "refresh-token",
        source: "remote"
      })
    ]
  ]);
  const requests: Array<{ url: string; authorization?: string }> = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(key: string): string | null {
          return localStorageValues.get(key) ?? null;
        },
        setItem(key: string, value: string): void {
          localStorageValues.set(key, value);
        },
        removeItem(key: string): void {
          localStorageValues.delete(key);
        }
      }
    }
  });

  globalThis.fetch = (async (input, init) => {
    const url = String(input);
    const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
    requests.push({ url, authorization });

    if (url.endsWith("/api/player-accounts/me")) {
      assert.equal(authorization, "Bearer old-token");
      return new Response(
        JSON.stringify({
          account: {
            playerId: "player-1",
            displayName: "暮火侦骑",
            globalResources: {
              gold: 75,
              wood: 2,
              ore: 1
            },
            achievements: [],
            recentEventLog: []
          },
          session: {
            playerId: "player-1",
            displayName: "暮火侦骑",
            authMode: "guest",
            sessionId: "session-current",
            token: "new-token",
            refreshToken: "new-refresh-token"
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

    if (authorization !== "Bearer new-token") {
      return new Response(
        JSON.stringify({
          error: {
            code: "session_revoked",
            message: "old token was rotated by the profile response"
          }
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    if (url.endsWith("/api/player-accounts/me/battle-reports")) {
      return new Response(
        JSON.stringify({
          latestReportId: "replay-after-rotation",
          items: [
            {
              id: "replay-after-rotation",
              replayId: "replay-after-rotation",
              roomId: "room-alpha",
              playerId: "player-1",
              battleId: "battle-rotation",
              battleKind: "neutral",
              playerCamp: "attacker",
              heroId: "hero-1",
              neutralArmyId: "neutral-1",
              startedAt: "2026-04-24T08:00:00.000Z",
              completedAt: "2026-04-24T08:01:00.000Z",
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

    return new Response(
      JSON.stringify({
        items: [
          {
            id: "replay-after-rotation",
            roomId: "room-alpha",
            playerId: "player-1",
            battleId: "battle-rotation",
            battleKind: "neutral",
            playerCamp: "attacker",
            heroId: "hero-1",
            neutralArmyId: "neutral-1",
            startedAt: "2026-04-24T08:00:00.000Z",
            completedAt: "2026-04-24T08:01:00.000Z",
            initialState: {
              id: "battle-rotation",
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
                  stackName: "暮火侦骑",
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
              rng: { seed: 8, cursor: 0 }
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
  }) as typeof fetch;

  try {
    const profile = await loadPlayerAccountProfile("player-1", "room-alpha");

    assert.deepEqual(requests, [
      {
        url: "http://127.0.0.1:2567/api/player-accounts/me",
        authorization: "Bearer old-token"
      },
      {
        url: "http://127.0.0.1:2567/api/player-accounts/me/battle-replays",
        authorization: "Bearer new-token"
      },
      {
        url: "http://127.0.0.1:2567/api/player-accounts/me/battle-reports",
        authorization: "Bearer new-token"
      }
    ]);
    assert.deepEqual(profile.recentBattleReplays.map((replay) => replay.id), ["replay-after-rotation"]);
    assert.equal(profile.battleReportCenter?.latestReportId, "replay-after-rotation");
    assert.equal(JSON.parse(localStorageValues.get("project-veil:auth-session") ?? "{}").token, "new-token");
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});

test("player progression loader normalizes summary, achievements, and limited event history", async () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      localStorage: {
        getItem(): string | null {
          return null;
        },
        setItem(): void {}
      }
    }
  });

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        summary: {
          totalAchievements: 1,
          unlockedAchievements: 1,
          inProgressAchievements: 0,
          latestUnlockedAchievementId: "first_battle",
          latestUnlockedAchievementTitle: "ignored title",
          latestUnlockedAt: "2026-03-27T12:00:00.000Z",
          recentEventCount: 1,
          latestEventAt: "2026-03-27T12:03:00.000Z"
        },
        achievements: [
          {
            id: "first_battle",
            current: 1,
            target: 999,
            unlocked: false,
            unlockedAt: "2026-03-27T12:00:00.000Z"
          }
        ],
        recentEventLog: [
          {
            id: "event-1",
            timestamp: "2026-03-27T12:03:00.000Z",
            roomId: "room-alpha",
            playerId: "player-1",
            category: "achievement",
            description: "解锁成就：初次交锋",
            achievementId: "first_battle",
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
    )) as typeof fetch;

  try {
    const snapshot = await loadPlayerProgressionSnapshot("player-1", 1);
    assert.deepEqual(snapshot.summary, {
      totalAchievements: 5,
      unlockedAchievements: 1,
      inProgressAchievements: 0,
      latestProgressAchievementId: "first_battle",
      latestProgressAchievementTitle: "初次交锋",
      latestProgressAt: "2026-03-27T12:00:00.000Z",
      latestUnlockedAchievementId: "first_battle",
      latestUnlockedAchievementTitle: "初次交锋",
      latestUnlockedAt: "2026-03-27T12:00:00.000Z",
      nextGoalAchievementId: "world_explorer",
      nextGoalAchievementTitle: "踏勘全境",
      nextGoalCurrent: 0,
      nextGoalTarget: 1,
      nextGoalRemaining: 1,
      recentEventCount: 1,
      latestEventAt: "2026-03-27T12:03:00.000Z"
    });
    assert.equal(snapshot.achievements[0]?.title, "初次交锋");
    assert.equal(snapshot.achievements[0]?.progressUpdatedAt, "2026-03-27T12:00:00.000Z");
    assert.deepEqual(snapshot.recentEventLog.map((entry) => entry.id), ["event-1"]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});
