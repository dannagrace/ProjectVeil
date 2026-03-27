import assert from "node:assert/strict";
import test from "node:test";
import {
  createFallbackPlayerAccountProfile,
  getPlayerAccountStorageKey,
  loadPlayerBattleReplaySummaries,
  readStoredPlayerDisplayName,
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
      }
    ],
    recentEventLog: [],
    recentBattleReplays: [],
    lastRoomId: "room-beta",
    source: "local"
  });
});

test("player replay loader normalizes remote replay summaries and keeps newest first", async () => {
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
            playerCamp: "attacker",
            heroId: "hero-1",
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
    )) as typeof fetch;

  try {
    const replays = await loadPlayerBattleReplaySummaries("player-1");
    assert.deepEqual(replays.map((replay) => replay.id), ["replay-newer", "replay-older"]);
  } finally {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
    globalThis.fetch = originalFetch;
  }
});
