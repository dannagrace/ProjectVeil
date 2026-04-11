import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosBattlePassPanelView, buildCocosDailyDungeonPanelView } from "../assets/scripts/cocos-progression-panel.ts";
import { VeilProgressionPanel } from "../assets/scripts/VeilProgressionPanel.ts";
import { createComponentHarness, findNode, pressNode, readCardLabel, readLabelString } from "./helpers/cocos-panel-harness.ts";

test("buildCocosBattlePassPanelView hides the panel when battle_pass_enabled is false", () => {
  const view = buildCocosBattlePassPanelView({
    progress: {
      battlePassEnabled: false,
      seasonXp: 0,
      seasonPassTier: 1,
      seasonPassPremium: false,
      seasonPassClaimedTiers: []
    },
    pendingClaimTier: null,
    pendingPremiumPurchase: false,
    statusLabel: "battle_pass_enabled = false"
  });

  assert.equal(view.visible, false);
  assert.equal(view.premiumPurchaseEnabled, false);
});

test("VeilProgressionPanel renders battle pass rewards and routes taps to claim and premium actions", () => {
  const claimedTiers: number[] = [];
  let premiumPurchaseCount = 0;
  const { component, node } = createComponentHarness(VeilProgressionPanel, {
    name: "ProgressionPanelRoot",
    width: 380,
    height: 440
  });

  component.configure({
    onClaimTier: (tier) => {
      claimedTiers.push(tier);
    },
    onPurchasePremium: () => {
      premiumPurchaseCount += 1;
    }
  });

  component.render({
    battlePass: buildCocosBattlePassPanelView({
      progress: {
        battlePassEnabled: true,
        seasonXp: 1200,
        seasonPassTier: 3,
        seasonPassPremium: false,
        seasonPassClaimedTiers: [1]
      },
      pendingClaimTier: null,
      pendingPremiumPurchase: false,
      statusLabel: "可领取当前解锁奖励。"
    })
  });

  assert.match(readCardLabel(node, "BattlePassHeader"), /赛季通行证/);
  assert.match(readCardLabel(node, "BattlePassNextReward"), /下一奖励/);
  assert.match(readCardLabel(node, "BattlePassTrack-0-free"), /免费奖励/);
  assert.match(readCardLabel(node, "BattlePassTrack-0-premium"), /高级奖励/);
  assert.match(readLabelString(findNode(node, "BattlePassPremiumAction")), /解锁高级通行证/);

  pressNode(findNode(node, "BattlePassTrack-0-free"));
  pressNode(findNode(node, "BattlePassPremiumAction"));

  assert.deepEqual(claimedTiers, [2]);
  assert.equal(premiumPurchaseCount, 1);
});

test("VeilProgressionPanel disables taps while a tier claim is pending", () => {
  const claimedTiers: number[] = [];
  const { component, node } = createComponentHarness(VeilProgressionPanel, {
    name: "ProgressionPanelRoot",
    width: 380,
    height: 440
  });

  component.configure({
    onClaimTier: (tier) => {
      claimedTiers.push(tier);
    }
  });

  component.render({
    battlePass: buildCocosBattlePassPanelView({
      progress: {
        battlePassEnabled: true,
        seasonXp: 2200,
        seasonPassTier: 5,
        seasonPassPremium: true,
        seasonPassClaimedTiers: [1, 2, 3]
      },
      pendingClaimTier: 5,
      pendingPremiumPurchase: false,
      statusLabel: "正在领取奖励..."
    })
  });

  assert.match(readCardLabel(node, "BattlePassTrack-1-free"), /领取中/);
  pressNode(findNode(node, "BattlePassTrack-1-free"));

  assert.deepEqual(claimedTiers, []);
});

test("buildCocosBattlePassPanelView keeps earlier unlocked unclaimed tiers visible and prioritized", () => {
  const view = buildCocosBattlePassPanelView({
    progress: {
      battlePassEnabled: true,
      seasonXp: 2200,
      seasonPassTier: 5,
      seasonPassPremium: false,
      seasonPassClaimedTiers: [1, 2, 5]
    },
    pendingClaimTier: null,
    pendingPremiumPurchase: false,
    statusLabel: "可领取历史段位奖励。"
  });

  assert.equal(view.tiers[0]?.tier, 3);
  assert.equal(view.tiers[0]?.freeTrack.claimable, true);
  assert.match(view.nextRewardLabel, /下一奖励 T3/);
});

test("buildCocosDailyDungeonPanelView surfaces claimable runs and leaderboard state", () => {
  const view = buildCocosDailyDungeonPanelView({
    dailyDungeon: {
      dungeon: {
        id: "shadow-archives",
        name: "Shadow Archives",
        description: "A rotating solo dungeon.",
        attemptLimit: 3,
        floors: [
          {
            floor: 1,
            recommendedHeroLevel: 2,
            enemyArmyTemplateId: "wolf_pack",
            enemyArmyCount: 14,
            enemyStatMultiplier: 1.2,
            reward: { gems: 10, resources: { gold: 160 } }
          },
          {
            floor: 2,
            recommendedHeroLevel: 3,
            enemyArmyTemplateId: "hero_guard_basic",
            enemyArmyCount: 18,
            enemyStatMultiplier: 1.45,
            reward: { gems: 15, resources: { gold: 220 } }
          }
        ]
      },
      dateKey: "2026-04-05",
      attemptsUsed: 1,
      attemptsRemaining: 2,
      runs: [
        {
          runId: "run-2",
          dungeonId: "shadow-archives",
          floor: 2,
          startedAt: "2026-04-05T02:00:00.000Z"
        }
      ]
    },
    activeEvent: {
      id: "defend-the-bridge",
      name: "Defend the Bridge",
      description: "Bridge defense weekly event.",
      bannerText: "Hold the bridge.",
      remainingMs: 86_400_000,
      objectives: [{ id: "bridge-dungeon-clear", actionType: "daily_dungeon_reward_claimed", dungeonId: "shadow-archives" }],
      rewards: [
        { id: "bridge-ration-cache", name: "Ration Cache", pointsRequired: 40, kind: "resources", resources: { gold: 180 } }
      ],
      player: {
        points: 40,
        claimedRewardIds: [],
        claimableRewardIds: ["bridge-ration-cache"]
      },
      leaderboard: {
        entries: [
          {
            rank: 1,
            playerId: "player-2",
            displayName: "Rival",
            points: 120,
            lastUpdatedAt: "2026-04-05T02:10:00.000Z",
            rewardPreview: "Bridge Champion"
          },
          {
            rank: 2,
            playerId: "player-1",
            displayName: "Hero",
            points: 40,
            lastUpdatedAt: "2026-04-05T02:05:00.000Z",
            rewardPreview: "Frontier Defender"
          }
        ],
        topThree: []
      }
    },
    currentPlayerId: "player-1",
    pendingFloor: null,
    pendingClaimRunId: null,
    statusLabel: "同步完成"
  });

  assert.equal(view.floors[1]?.actionKind, "claim");
  assert.equal(view.floors[1]?.runId, "run-2");
  assert.match(view.eventSummaryLabel, /可领取/);
  assert.equal(view.leaderboardRows[1]?.isCurrentPlayer, true);
  assert.match(view.myRankSummary, /#2/);
});

test("VeilProgressionPanel renders daily dungeon actions and refresh control", () => {
  const attemptedFloors: number[] = [];
  const claimedRuns: string[] = [];
  let refreshCount = 0;
  const { component, node } = createComponentHarness(VeilProgressionPanel, {
    name: "ProgressionPanelRoot",
    width: 380,
    height: 520
  });

  component.configure({
    onAttemptDailyDungeonFloor: (floor) => {
      attemptedFloors.push(floor);
    },
    onClaimDailyDungeonRun: (runId) => {
      claimedRuns.push(runId);
    },
    onRefreshDailyDungeon: () => {
      refreshCount += 1;
    }
  });

  component.render({
    dailyDungeon: buildCocosDailyDungeonPanelView({
      dailyDungeon: {
        dungeon: {
          id: "shadow-archives",
          name: "Shadow Archives",
          description: "A rotating solo dungeon.",
          attemptLimit: 3,
          floors: [
            {
              floor: 1,
              recommendedHeroLevel: 2,
              enemyArmyTemplateId: "wolf_pack",
              enemyArmyCount: 14,
              enemyStatMultiplier: 1.2,
              reward: { gems: 10, resources: { gold: 160 } }
            },
            {
              floor: 2,
              recommendedHeroLevel: 3,
              enemyArmyTemplateId: "hero_guard_basic",
              enemyArmyCount: 18,
              enemyStatMultiplier: 1.45,
              reward: { gems: 15, resources: { gold: 220 } }
            }
          ]
        },
        dateKey: "2026-04-05",
        attemptsUsed: 1,
        attemptsRemaining: 2,
        runs: [
          {
            runId: "run-2",
            dungeonId: "shadow-archives",
            floor: 2,
            startedAt: "2026-04-05T02:00:00.000Z"
          }
        ]
      },
      activeEvent: null,
      currentPlayerId: "player-1",
      pendingFloor: null,
      pendingClaimRunId: null,
      statusLabel: "同步完成"
    })
  });

  assert.match(readCardLabel(node, "DailyDungeonHeader"), /每日地城/);
  assert.match(readCardLabel(node, "DailyDungeonFloor-0"), /开始挑战/);
  assert.match(readCardLabel(node, "DailyDungeonFloor-1"), /领取奖励/);

  pressNode(findNode(node, "DailyDungeonFloor-0"));
  pressNode(findNode(node, "DailyDungeonFloor-1"));
  pressNode(findNode(node, "DailyDungeonRefresh"));

  assert.deepEqual(attemptedFloors, [1]);
  assert.deepEqual(claimedRuns, ["run-2"]);
  assert.equal(refreshCount, 1);
});
