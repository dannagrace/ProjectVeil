import { VeilLobbyPanel } from "../assets/scripts/VeilLobbyPanel";
import assert from "node:assert/strict";
import test from "node:test";
import { createBattleReplayPlaybackState } from "../assets/scripts/project-shared/battle-replay";
import { buildCocosBattleReplayCenterView } from "../assets/scripts/cocos-battle-replay-center";
import {
  buildLobbyAccountIdentityView,
  buildLobbyGuestEntryView,
  buildLobbyPveFrontdoorView,
  buildLobbyRoomCards,
  createLobbyPanelTestAccount,
  summarizeLobbyShowcaseInventory
} from "../assets/scripts/cocos-lobby-panel-model";
import {
  buildLobbySkillPanelView,
  toLobbySkillPanelHeroState
} from "../assets/scripts/cocos-lobby-skill-panel.ts";
import { getRuntimeConfigBundleForRoom } from "../assets/scripts/project-shared/index.ts";
import type { VeilLobbyRenderState } from "../assets/scripts/VeilLobbyPanel";
import {
  createBattleReplaySummary,
  createWorldUpdate,
  createComponentHarness,
  createErroredBattleReplayReviewState,
  createLobbyState,
  findNode,
  pressNode,
  createReplayReadyLobbyState,
  readCardLabel
} from "./helpers/cocos-panel-harness.ts";

function createCampaignSummaryFixture() {
  return {
    missions: [
      {
        id: "chapter-1-scout",
        missionId: "chapter-1-scout",
        chapterId: "chapter-1",
        mapId: "frontier-map",
        name: "前哨侦察",
        description: "扫清迷雾并拿下前线补给点。",
        enemyArmyTemplateId: "hero_guard_basic",
        order: 1,
        recommendedHeroLevel: 2,
        enemyArmyCount: 12,
        enemyStatMultiplier: 1,
        attempts: 0,
        objectives: [],
        reward: { resources: { gold: 120 } },
        status: "available" as const
      },
      {
        id: "chapter-2-breach",
        missionId: "chapter-2-breach",
        chapterId: "chapter-2",
        mapId: "breach-map",
        name: "灰脊突破口",
        description: "撕开第二章防线。",
        enemyArmyTemplateId: "shadow_hexer",
        order: 1,
        recommendedHeroLevel: 4,
        enemyArmyCount: 14,
        enemyStatMultiplier: 1.15,
        objectives: [],
        reward: { resources: { gold: 180, ore: 8 } },
        status: "locked" as const,
        unlockRequirements: [
          {
            type: "mission_complete",
            description: "完成前哨侦察",
            missionId: "chapter-1-scout",
            chapterId: "chapter-1",
            satisfied: false
          }
        ]
      }
    ],
    completedCount: 0,
    totalMissions: 2,
    nextMissionId: "chapter-1-scout",
    completionPercent: 0
  };
}

function createDailyDungeonSummaryFixture() {
  return {
    dungeon: {
      id: "ember-forge",
      name: "余烬熔炉",
      description: "今日的锻炉正在喷吐失控的烈焰。",
      attemptLimit: 3,
      activeWindow: {
        startDate: "2026-04-16",
        endDate: "2026-04-16"
      },
      floors: [
        {
          floor: 1,
          recommendedHeroLevel: 2,
          enemyArmyTemplateId: "wolf_pack",
          enemyArmyCount: 8,
          enemyStatMultiplier: 1,
          reward: {
            gems: 20,
            resources: {
              gold: 120,
              wood: 0,
              ore: 0
            }
          }
        }
      ]
    },
    dateKey: "2026-04-16",
    attemptsUsed: 1,
    attemptsRemaining: 2,
    runs: [
      {
        runId: "run-1",
        dungeonId: "ember-forge",
        floor: 1,
        startedAt: "2026-04-16T09:00:00.000Z"
      }
    ]
  };
}

function createSeasonalEventFixture() {
  return {
    id: "season-event-1",
    name: "春季试炼",
    description: "完成每日地城并领取奖励，冲击赛季榜单。",
    bannerText: "今日挑战可获得额外积分。",
    remainingMs: 6 * 60 * 60 * 1000,
    rewards: [
      {
        id: "event-reward-1",
        name: "试炼徽记",
        pointsRequired: 80,
        kind: "badge" as const,
        badge: "spring-trial"
      }
    ],
    objectives: [
      {
        id: "objective-1",
        actionType: "daily_dungeon_reward_claimed",
        dungeonId: "ember-forge"
      }
    ],
    player: {
      points: 64,
      claimedRewardIds: [],
      claimableRewardIds: ["event-reward-1"]
    },
    leaderboard: {
      entries: [],
      topThree: []
    }
  };
}

test("lobby panel room cards render active room summaries from the server response", () => {
  const cards = buildLobbyRoomCards([
    {
      roomId: "room-alpha",
      seed: 1001,
      day: 3,
      connectedPlayers: 1,
      disconnectedPlayers: 0,
      heroCount: 2,
      activeBattles: 1,
      statusLabel: "PVP 进行中",
      updatedAt: "2026-03-29T12:00:00.000Z"
    }
  ]);

  assert.deepEqual(cards, [
    {
      roomId: "room-alpha",
      title: "room-alpha",
      meta: "Day 3 · Seed 1001 · PVP 进行中 · 玩家 1 · 英雄 2 · 战斗 1"
    }
  ]);
});

test("guest login view resolves displayName and room ID from account and lobby state", () => {
  const view = buildLobbyGuestEntryView(
    createLobbyState({
      playerId: "guest-202503",
      account: createLobbyPanelTestAccount({
        displayName: "晶塔旅人",
        lastRoomId: "room-beta"
      })
    })
  );

  assert.deepEqual(view, {
    displayName: "晶塔旅人",
    roomId: "room-beta"
  });
});

test("account identity view shows the loginId field only when credentials are bound", () => {
  const bound = buildLobbyAccountIdentityView(
    createLobbyState({
      authMode: "account",
      loginId: "veil-ranger",
      account: createLobbyPanelTestAccount({
        loginId: "veil-ranger",
        credentialBoundAt: "2026-03-28T12:34:56.000Z"
      })
    })
  );
  assert.equal(bound.showLoginId, true);
  assert.equal(bound.loginIdValue, "veil-ranger");

  const guest = buildLobbyAccountIdentityView(createLobbyState());
  assert.equal(guest.showLoginId, false);
});

test("PVE frontdoor view surfaces the next campaign mission and claimable daily dungeon rewards", () => {
  const view = buildLobbyPveFrontdoorView(
    createLobbyState({
      authMode: "account",
      campaign: createCampaignSummaryFixture(),
      campaignStatus: "战役面板已就绪。",
      dailyDungeon: createDailyDungeonSummaryFixture(),
      dailyDungeonStatus: "剩余 2 次挑战。"
    })
  );

  assert.match(view.campaignSummary, /前哨侦察/);
  assert.match(view.campaignSummary, /第 1 章/);
  assert.match(view.campaignSummary, /下章预告 第 2 章/);
  assert.match(view.dailyDungeonSummary, /余烬熔炉/);
  assert.match(view.dailyDungeonSummary, /1 份奖励待领取/);
  assert.match(view.focusSummary, /先领取地城奖励/);
  assert.equal(view.campaignActionEnabled, true);
  assert.equal(view.dailyDungeonActionEnabled, true);
});

test("PVE frontdoor view falls back to chapter preview when there are no daily dungeon claims waiting", () => {
  const view = buildLobbyPveFrontdoorView(
    createLobbyState({
      authMode: "account",
      campaign: createCampaignSummaryFixture(),
      campaignStatus: "战役面板已就绪。",
      dailyDungeon: {
        ...createDailyDungeonSummaryFixture(),
        runs: []
      },
      dailyDungeonStatus: "剩余 3 次挑战。"
    })
  );

  assert.match(view.focusSummary, /章节路线：完成 前哨侦察 后可解锁 灰脊突破口 · 完成前哨侦察。/);
});

test("showcase gallery inventory stays aligned with the configured hero, terrain, building and unit counts", () => {
  assert.deepEqual(summarizeLobbyShowcaseInventory(), {
    heroes: 4,
    terrain: 5,
    buildings: 4,
    units: 6,
    rotatingUnitPages: 2
  });
});

test("battle replay center view exposes controls and a loaded replay snapshot for account review", () => {
  const replay = createBattleReplaySummary();
  const view = buildCocosBattleReplayCenterView({
    replays: [replay],
    selectedReplayId: replay.id,
    playback: createBattleReplayPlaybackState(replay),
    status: "ready"
  });

  assert.equal(view.state, "ready");
  assert.match(view.title, /战报回放中心/);
  assert.match(view.subtitle, /PVE/);
  assert.match(view.detailLines.join("\n"), /当前动作：暂无动作/);
  assert.match(view.detailLines.join("\n"), /下一动作：hero-1-stack 等待/);
  assert.deepEqual(
    view.controls.map((control) => [control.action, control.enabled]),
    [
      ["play", true],
      ["pause", false],
      ["step-back", false],
      ["step-forward", true],
      ["turn-back", false],
      ["turn-forward", false],
      ["speed-down", true],
      ["speed-up", true],
      ["reset", false]
    ]
  );
});

test("battle replay center view falls back to battle report detail when replay evidence is unavailable", () => {
  const view = buildCocosBattleReplayCenterView({
    replays: [],
    battleReports: {
      latestReportId: "report-only",
      items: [
        {
          id: "report-only",
          replayId: "report-only",
          roomId: "room-report",
          playerId: "player-1",
          battleId: "battle-report",
          battleKind: "hero",
          playerCamp: "defender",
          heroId: "hero-1",
          opponentHeroId: "hero-9",
          startedAt: "2026-03-27T12:20:00.000Z",
          completedAt: "2026-03-27T12:22:00.000Z",
          result: "defeat",
          turnCount: 3,
          actionCount: 5,
          rewards: [],
          evidence: {
            replay: "missing",
            rewards: "missing"
          }
        }
      ]
    },
    selectedReplayId: "report-only",
    playback: null,
    status: "ready"
  });

  assert.equal(view.state, "ready");
  assert.match(view.title, /失利/);
  assert.match(view.subtitle, /PVP .*摘要模式/);
  assert.match(view.detailLines.join("\n"), /完整回放暂不可用/);
  assert.match(view.detailLines.join("\n"), /回放证据：缺失/);
  assert.equal(view.controls.every((control) => control.enabled === false), true);
});

test("VeilLobbyPanel retains the loading lobby snapshot and creates base panel chrome", () => {
  const { component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const state = createLobbyState({
    loading: true,
    rooms: [
      {
        roomId: "room-alpha",
        seed: 1001,
        day: 3,
        connectedPlayers: 1,
        disconnectedPlayers: 0,
        heroCount: 2,
        activeBattles: 1,
        statusLabel: "PVP 进行中",
        updatedAt: "2026-03-29T12:00:00.000Z"
      }
    ]
  });

  component.configure({});
  component.scheduleOnce = () => undefined;
  component.render(state);
  const statefulComponent = component as VeilLobbyPanel & Record<string, unknown>;

  assert.equal(statefulComponent.currentState, state);
  assert.equal((statefulComponent.currentState as VeilLobbyRenderState).rooms[0]?.roomId, "room-alpha");
  assert.equal((statefulComponent.currentState as VeilLobbyRenderState).loading, true);
  component.onDestroy();
});

test("VeilLobbyPanel renders and wires the lobby campaign action", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  let opened = 0;

  component.configure({
    onOpenCampaign: () => {
      opened += 1;
    }
  });
  component.scheduleOnce = () => undefined;
  component.render(createLobbyState());

  pressNode(findNode(node, "LobbyCampaign"));

  assert.equal(opened, 1);
  component.onDestroy();
});

test("VeilLobbyPanel renders the PVE frontdoor and wires campaign plus daily dungeon actions", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  let campaignOpened = 0;
  let dailyDungeonOpened = 0;

  component.configure({
    onOpenCampaign: () => {
      campaignOpened += 1;
    },
    onOpenDailyDungeon: () => {
      dailyDungeonOpened += 1;
    }
  });
  component.scheduleOnce = () => undefined;
  component.render(
    createLobbyState({
      authMode: "account",
      campaign: createCampaignSummaryFixture(),
      campaignStatus: "战役面板已就绪。",
      dailyDungeon: createDailyDungeonSummaryFixture(),
      dailyDungeonStatus: "剩余 2 次挑战。"
    })
  );

  assert.match(readCardLabel(node, "LobbyPveFrontdoor"), /今日 PVE 路线/);
  assert.match(readCardLabel(node, "LobbyPveFrontdoor"), /前哨侦察/);
  assert.match(readCardLabel(node, "LobbyPveFrontdoor"), /第 1 章/);
  assert.match(readCardLabel(node, "LobbyPveFrontdoor"), /余烬熔炉/);

  pressNode(findNode(node, "LobbyPveCampaignAction"));
  pressNode(findNode(node, "LobbyPveDailyDungeonAction"));

  assert.equal(campaignOpened, 1);
  assert.equal(dailyDungeonOpened, 1);
  component.onDestroy();
});

test("VeilLobbyPanel advances replay playback when the replay control state transitions", () => {
  const { component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const state = createReplayReadyLobbyState();

  component.configure({});
  component.scheduleOnce = () => undefined;
  (component as VeilLobbyPanel & Record<string, unknown>).showAccountReview = true;
  component.render(state);
  const statefulComponent = component as VeilLobbyPanel & Record<string, unknown>;
  assert.equal((statefulComponent.replayPlayback as { currentStepIndex?: number } | null)?.currentStepIndex, 0);
  (statefulComponent.applyReplayControl as (action: "step-forward") => void)("step-forward");

  assert.equal((statefulComponent.replayPlayback as { currentStepIndex?: number } | null)?.currentStepIndex, 1);
  component.onDestroy();
});

test("VeilLobbyPanel renders a playback-aware replay timeline card alongside the replay center", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const state = createReplayReadyLobbyState();

  component.configure({});
  component.scheduleOnce = () => undefined;
  const statefulComponent = component as VeilLobbyPanel & Record<string, unknown>;
  statefulComponent.showAccountReview = true;
  component.render(state);

  assert.match(readCardLabel(node, "LobbyBattleReplayCenter"), /战报回放中心/);
  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /播放游标 0\/2 .*倍率 1x/);
  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /当前 · 第 1 步/);

  (statefulComponent.applyReplayControl as (action: "step-forward") => void)("step-forward");

  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /播放游标 1\/2/);
  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /已执行 · 第 1 步/);
  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /当前 · 第 2 步/);
  component.onDestroy();
});

test("VeilLobbyPanel keeps empty-room rendering separate from replay transport failures", () => {
  const { component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const erroredState = createLobbyState({
    accountReview: createErroredBattleReplayReviewState("Lobby transport failure: 502 Bad Gateway"),
    battleReplaySectionStatus: "error",
    battleReplaySectionError: "Lobby transport failure: 502 Bad Gateway"
  });

  component.configure({});
  component.scheduleOnce = () => undefined;
  component.render(createLobbyState());
  const statefulComponent = component as VeilLobbyPanel & Record<string, unknown>;
  assert.equal((statefulComponent.currentState as VeilLobbyRenderState).rooms.length, 0);
  statefulComponent.showAccountReview = true;
  component.render(erroredState);

  assert.equal((statefulComponent.currentState as VeilLobbyRenderState).battleReplaySectionStatus, "error");
  assert.match(String(statefulComponent.replayPlaybackStatus ?? ""), /502 Bad Gateway/);
  component.onDestroy();
});

test("VeilLobbyPanel renders leaderboard rows and highlights the current player summary", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const state = createLobbyState({
    playerId: "player-2",
    leaderboardStatus: "ready",
    leaderboardEntries: [
      { playerId: "player-1", rank: 1, displayName: "Alpha", eloRating: 1688, tier: "platinum" },
      { playerId: "player-2", rank: 2, displayName: "Bravo", eloRating: 1524, tier: "platinum" },
      { playerId: "player-3", rank: 3, displayName: "Charlie", eloRating: 1499, tier: "gold" }
    ]
  });

  component.configure({});
  component.scheduleOnce = () => undefined;
  component.render(state);

  assert.match(readCardLabel(node, "LobbyLeaderboardStatus"), /当前徽记 铂金/);
  assert.match(readCardLabel(node, "LobbyLeaderboardList"), /#2 Bravo · 我 · ELO 1524 · 铂金/);
  assert.match(readCardLabel(node, "LobbyLeaderboardMyRank"), /我的排名/);
  assert.match(readCardLabel(node, "LobbyLeaderboardMyRank"), /#2 Bravo/);
  component.onDestroy();
});

test("VeilLobbyPanel opens the lobby skill modal and wires skill selections", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const update = createWorldUpdate();
  const hero = update.world.ownHeroes[0]!;
  const selectedSkillIds: string[] = [];

  component.configure({
    onLearnLobbySkill: (skillId) => {
      selectedSkillIds.push(skillId);
    }
  });
  component.scheduleOnce = () => undefined;
  component.render(createLobbyState({
    activeHero: hero,
    lobbySkillPanel: buildLobbySkillPanelView(
      toLobbySkillPanelHeroState(hero),
      getRuntimeConfigBundleForRoom(update.world.meta.roomId, update.world.meta.seed)
    )
  }));

  pressNode(findNode(node, "LobbyHeroSkillButton"));
  assert.match(readCardLabel(node, "LobbySkillPanelHeader"), /技能规划/);

  pressNode(findNode(node, "LobbySkillPanelAction-0"));
  assert.deepEqual(selectedSkillIds, ["war_banner"]);
  component.onDestroy();
});

test("VeilLobbyPanel opens the daily quest board panel and wires quest claims", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const claimedQuestIds: string[] = [];

  component.configure({
    onClaimDailyQuest: (questId) => {
      claimedQuestIds.push(questId);
    }
  });
  component.scheduleOnce = () => undefined;
  component.render(
    createLobbyState({
      account: createLobbyPanelTestAccount({
        dailyQuestBoard: {
          enabled: true,
          cycleKey: "2026-04-08",
          resetAt: "2026-04-08T23:59:59.999Z",
          availableClaims: 1,
          pendingRewards: {
            gems: 8,
            gold: 50
          },
          quests: [
            {
              id: "quest-progress",
              title: "巡视边境",
              description: "移动英雄 3 次。",
              target: 3,
              current: 1,
              completed: false,
              claimed: false,
              reward: {
                gems: 2,
                gold: 0
              }
            },
            {
              id: "quest-claimable",
              title: "补给征收",
              description: "收集资源 2 次。",
              target: 2,
              current: 2,
              completed: true,
              claimed: false,
              reward: {
                gems: 8,
                gold: 50
              }
            },
            {
              id: "quest-claimed",
              title: "压制前线",
              description: "赢得 1 场战斗。",
              target: 1,
              current: 1,
              completed: true,
              claimed: true,
              reward: {
                gems: 5,
                gold: 20
              }
            }
          ]
        }
      })
    })
  );

  assert.match(readCardLabel(node, "LobbyDailyQuestSummary"), /今日奖励节奏/);
  assert.match(readCardLabel(node, "LobbyDailyQuestSummary"), /立刻可领 1 项 · 任务 1 \/ 地城 0 \/ 战令 0 \/ 活动 0/);
  pressNode(findNode(node, "LobbyDailyQuestOpen"));
  assert.match(readCardLabel(node, "LobbyDailyQuestHeader"), /每日任务板/);
  assert.match(readCardLabel(node, "LobbyDailyQuestQuest-0"), /巡视边境 · 进行中/);
  assert.match(readCardLabel(node, "LobbyDailyQuestQuest-1"), /补给征收 · 可领取/);
  assert.match(readCardLabel(node, "LobbyDailyQuestQuest-2"), /压制前线 · 已领取/);
  assert.match(readCardLabel(node, "LobbyDailyQuestClaim-1"), /领取奖励/);

  pressNode(findNode(node, "LobbyDailyQuestClaim-1"));
  assert.deepEqual(claimedQuestIds, ["quest-claimable"]);
  component.onDestroy();
});

test("VeilLobbyPanel keeps tutorial guidance ahead of rewards and auto-opens the first claimable quest board", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const claimedQuestIds: string[] = [];

  component.configure({
    onClaimDailyQuest: (questId) => {
      claimedQuestIds.push(questId);
    }
  });
  component.scheduleOnce = () => undefined;

  component.render(
    createLobbyState({
      account: createLobbyPanelTestAccount({
        tutorialStep: 1,
        dailyQuestBoard: {
          enabled: false,
          cycleKey: "2026-04-08",
          resetAt: "2026-04-08T23:59:59.999Z",
          availableClaims: 0,
          pendingRewards: {
            gems: 0,
            gold: 0
          },
          quests: []
        }
      }),
      seasonProgress: {
        battlePassEnabled: true,
        seasonXp: 1200,
        seasonPassTier: 3,
        seasonPassPremium: false,
        seasonPassClaimedTiers: [1]
      }
    })
  );

  assert.match(readCardLabel(node, "LobbyDailyQuestSummary"), /立刻可领 1 项 · 任务 0 \/ 地城 0 \/ 战令 1 \/ 活动 0/);
  assert.equal(findNode(node, "LobbyDailyQuestHeader"), null);

  component.render(
    createLobbyState({
      account: createLobbyPanelTestAccount({
        dailyQuestBoard: {
          enabled: true,
          cycleKey: "2026-04-08",
          resetAt: "2026-04-08T23:59:59.999Z",
          availableClaims: 1,
          pendingRewards: {
            gems: 8,
            gold: 50
          },
          quests: [
            {
              id: "quest-progress",
              title: "巡视边境",
              description: "移动英雄 3 次。",
              target: 3,
              current: 1,
              completed: false,
              claimed: false,
              reward: {
                gems: 2,
                gold: 0
              }
            },
            {
              id: "quest-claimable",
              title: "补给征收",
              description: "收集资源 2 次。",
              target: 2,
              current: 2,
              completed: true,
              claimed: false,
              reward: {
                gems: 8,
                gold: 50
              }
            }
          ]
        }
      }),
      seasonProgress: {
        battlePassEnabled: true,
        seasonXp: 1200,
        seasonPassTier: 3,
        seasonPassPremium: false,
        seasonPassClaimedTiers: [1]
      }
    })
  );

  assert.match(readCardLabel(node, "LobbyDailyQuestSummary"), /战令 T2/);
  assert.match(readCardLabel(node, "LobbyDailyQuestHeader"), /每日任务板/);
  pressNode(findNode(node, "LobbyDailyQuestClaim-1"));
  assert.deepEqual(claimedQuestIds, ["quest-claimable"]);
  component.onDestroy();
});

test("VeilLobbyPanel routes reward cadence CTA to daily dungeon when dungeon or seasonal rewards are the next actionable step", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  let openedDailyDungeonCount = 0;

  component.configure({
    onOpenDailyDungeon: () => {
      openedDailyDungeonCount += 1;
    }
  });
  component.scheduleOnce = () => undefined;
  component.render(
    createLobbyState({
      account: createLobbyPanelTestAccount({
        dailyQuestBoard: {
          enabled: true,
          cycleKey: "2026-04-16",
          resetAt: "2026-04-16T23:59:59.999Z",
          availableClaims: 0,
          pendingRewards: {
            gems: 0,
            gold: 0
          },
          quests: []
        }
      }),
      dailyDungeon: createDailyDungeonSummaryFixture(),
      activeSeasonalEvent: createSeasonalEventFixture()
    })
  );

  assert.match(readCardLabel(node, "LobbyDailyQuestSummary"), /余烬熔炉 · 1 项待领取/);
  assert.match(readCardLabel(node, "LobbyDailyQuestSummary"), /春季试炼 · 可领取 试炼徽记/);
  assert.match(readCardLabel(node, "LobbyDailyQuestOpen"), /查看地城奖励 · 1 项待领取/);

  pressNode(findNode(node, "LobbyDailyQuestOpen"));
  assert.equal(openedDailyDungeonCount, 1);
  component.onDestroy();
});

test("VeilLobbyPanel routes reward cadence CTA to battle pass when only season pass rewards are claimable", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  let openedBattlePassCount = 0;

  component.configure({
    onOpenBattlePass: () => {
      openedBattlePassCount += 1;
    }
  });
  component.scheduleOnce = () => undefined;
  component.render(
    createLobbyState({
      account: createLobbyPanelTestAccount({
        dailyQuestBoard: {
          enabled: true,
          cycleKey: "2026-04-16",
          resetAt: "2026-04-16T23:59:59.999Z",
          availableClaims: 0,
          pendingRewards: {
            gems: 0,
            gold: 0
          },
          quests: []
        }
      }),
      seasonProgress: {
        battlePassEnabled: true,
        seasonXp: 1200,
        seasonPassTier: 3,
        seasonPassPremium: false,
        seasonPassClaimedTiers: [1]
      }
    })
  );

  assert.match(readCardLabel(node, "LobbyDailyQuestSummary"), /战令 T2 ·/);
  assert.match(readCardLabel(node, "LobbyDailyQuestOpen"), /查看赛季通行证 · 当前有可领奖励/);

  pressNode(findNode(node, "LobbyDailyQuestOpen"));
  assert.equal(openedBattlePassCount, 1);
  component.onDestroy();
});

test("VeilLobbyPanel renders the daily quest board empty state when no quests are available", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });

  component.configure({});
  component.scheduleOnce = () => undefined;
  component.render(
    createLobbyState({
      account: createLobbyPanelTestAccount({
        dailyQuestBoard: {
          enabled: true,
          cycleKey: "2026-04-08",
          resetAt: "2026-04-08T23:59:59.999Z",
          availableClaims: 0,
          pendingRewards: {
            gems: 0,
            gold: 0
          },
          quests: []
        }
      })
    })
  );

  pressNode(findNode(node, "LobbyDailyQuestOpen"));
  assert.match(readCardLabel(node, "LobbyDailyQuestEmpty"), /今日任务暂未开放或尚未下发/);
  component.onDestroy();
});

test("VeilLobbyPanel renders mailbox compensation copy and wires claim actions", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const claimedMessageIds: string[] = [];
  let claimAllCount = 0;

  component.configure({
    onClaimMailboxMessage: (messageId) => {
      claimedMessageIds.push(messageId);
    },
    onClaimAllMailbox: () => {
      claimAllCount += 1;
    }
  });
  component.scheduleOnce = () => undefined;
  component.render(
    createLobbyState({
      account: createLobbyPanelTestAccount({
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
              resources: {
                gold: 120,
                wood: 0,
                ore: 0
              }
            }
          }
        ],
        mailboxSummary: {
          totalCount: 1,
          unreadCount: 1,
          claimableCount: 1,
          expiredCount: 0
        }
      })
    })
  );

  assert.match(readCardLabel(node, "LobbyMailbox"), /系统邮箱 · 未读 1/);
  assert.match(readCardLabel(node, "LobbyMailbox"), /停机补偿/);
  assert.match(readCardLabel(node, "LobbyMailbox"), /宝石 x30 · 金币 x120 · 2026-04-12 到期/);
  assert.match(readCardLabel(node, "LobbyMailboxClaimAll"), /领取全部附件/);
  assert.match(readCardLabel(node, "LobbyMailboxClaim-0"), /领取: 停机补偿/);

  pressNode(findNode(node, "LobbyMailboxClaimAll"));
  pressNode(findNode(node, "LobbyMailboxClaim-0"));

  assert.equal(claimAllCount, 1);
  assert.deepEqual(claimedMessageIds, ["comp-1"]);
  component.onDestroy();
});
