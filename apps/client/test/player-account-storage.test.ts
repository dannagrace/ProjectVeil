import assert from "node:assert/strict";
import test from "node:test";
import {
  createFallbackPlayerAccountProfile,
  getPlayerAccountStorageKey,
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
