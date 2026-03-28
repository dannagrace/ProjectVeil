import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosAccountReviewPage } from "../assets/scripts/cocos-account-review.ts";
import type { CocosPlayerAccountProfile } from "../assets/scripts/cocos-lobby.ts";

function createProfile(): CocosPlayerAccountProfile {
  return {
    playerId: "player-1",
    displayName: "雾林司灯",
    globalResources: {
      gold: 12,
      wood: 6,
      ore: 3
    },
    achievements: [
      {
        id: "first_battle",
        title: "初次交锋",
        description: "首次进入战斗。",
        metric: "battles_started",
        current: 1,
        target: 1,
        unlocked: true,
        unlockedAt: "2026-03-28T12:05:00.000Z"
      },
      {
        id: "enemy_slayer",
        title: "猎敌者",
        description: "击败 3 名敌人或中立守军。",
        metric: "battles_won",
        current: 2,
        target: 3,
        unlocked: false,
        progressUpdatedAt: "2026-03-28T12:03:00.000Z"
      },
      {
        id: "skill_scholar",
        title: "秘法学徒",
        description: "学习 3 个长期技能。",
        metric: "skills_learned",
        current: 0,
        target: 3,
        unlocked: false
      }
    ],
    recentEventLog: [
      {
        id: "event-new",
        timestamp: "2026-03-28T12:06:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "achievement",
        description: "解锁成就：初次交锋",
        achievementId: "first_battle",
        rewards: [{ type: "badge", label: "初次交锋" }]
      },
      {
        id: "event-mid",
        timestamp: "2026-03-28T12:04:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "combat",
        description: "击退了北侧守军",
        worldEventType: "battle.resolved",
        rewards: []
      },
      {
        id: "event-old",
        timestamp: "2026-03-28T12:02:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "movement",
        description: "向东移动 1 格",
        worldEventType: "hero.moved",
        rewards: []
      }
    ],
    recentBattleReplays: [
      {
        id: "replay-1",
        roomId: "room-alpha",
        playerId: "player-1",
        battleId: "battle-1",
        battleKind: "neutral",
        playerCamp: "attacker",
        heroId: "hero-1",
        neutralArmyId: "neutral-1",
        startedAt: "2026-03-28T12:00:00.000Z",
        completedAt: "2026-03-28T12:01:00.000Z",
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
        steps: [{ index: 0, source: "player", action: { type: "wait" } }],
        result: "attacker_victory"
      },
      {
        id: "replay-2",
        roomId: "room-beta",
        playerId: "player-1",
        battleId: "battle-2",
        battleKind: "hero",
        playerCamp: "defender",
        heroId: "hero-1",
        opponentHeroId: "hero-9",
        startedAt: "2026-03-28T11:50:00.000Z",
        completedAt: "2026-03-28T11:52:00.000Z",
        initialState: {
          id: "battle-2",
          round: 1,
          lanes: 1,
          activeUnitId: "unit-2",
          turnOrder: ["unit-2"],
          units: {
            "unit-2": {
              id: "unit-2",
              camp: "defender",
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
          rng: { seed: 9, cursor: 0 }
        },
        steps: [],
        result: "defender_victory"
      }
    ],
    source: "remote"
  };
}

test("buildCocosAccountReviewPage paginates event history and exposes tab counts", () => {
  const review = buildCocosAccountReviewPage(createProfile(), "event-history", 1, 2);

  assert.equal(review.title, "事件历史");
  assert.equal(review.page, 1);
  assert.equal(review.totalPages, 2);
  assert.equal(review.hasPreviousPage, true);
  assert.equal(review.hasNextPage, false);
  assert.deepEqual(review.items.map((item) => item.title), ["向东移动 1 格"]);
  assert.deepEqual(
    review.tabs.map((tab) => `${tab.label}:${tab.count}`),
    ["战报:2", "事件:3", "成就:2"]
  );
});

test("buildCocosAccountReviewPage prefers unlocked and recently progressed achievements", () => {
  const review = buildCocosAccountReviewPage(createProfile(), "achievements", 0, 5);

  assert.equal(review.totalPages, 1);
  assert.deepEqual(
    review.items.map((item) => item.title),
    ["初次交锋 · 已解锁", "猎敌者 · 未解锁"]
  );
  assert.match(review.items[1]?.detail ?? "", /^2\/3 · 击败 3 名敌人或中立守军。$/);
});

test("buildCocosAccountReviewPage clamps invalid pages for battle replays", () => {
  const review = buildCocosAccountReviewPage(createProfile(), "battle-replays", 99, 1);

  assert.equal(review.page, 1);
  assert.equal(review.totalPages, 2);
  assert.equal(review.items[0]?.title, "失利 · PVP · 对手 hero-9");
  assert.equal(review.items[0]?.footnote, "2026-03-28 11:52 · 守方 · 房间 room-beta");
});
