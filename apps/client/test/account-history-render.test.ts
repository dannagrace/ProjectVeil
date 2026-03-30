import assert from "node:assert/strict";
import test from "node:test";
import {
  renderAchievementProgress,
  renderBattleReportReplayCenter,
  renderBattleReplayInspector,
  renderRecentAccountEvents,
  renderRecentBattleReplays
} from "../src/account-history";
import { createBattleReplayPlaybackState, stepBattleReplayPlayback } from "../../../packages/shared/src/index";
import type { PlayerAccountProfile } from "../src/player-account";

function createProfile(): PlayerAccountProfile {
  const battleState = {
    id: "battle-1",
    round: 1,
    lanes: 3,
    activeUnitId: null,
    turnOrder: [],
    units: {},
    environment: [],
    log: [],
    rng: {
      seed: 1,
      cursor: 0
    }
  };

  return {
    playerId: "player-1",
    displayName: "暮火侦骑",
    globalResources: {
      gold: 12,
      wood: 4,
      ore: 2
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
        unlockedAt: "2026-03-27T12:00:00.000Z"
      },
      {
        id: "enemy_slayer",
        title: "猎敌者",
        description: "击败 3 名敌人或中立守军。",
        metric: "battles_won",
        current: 2,
        target: 3,
        unlocked: false,
        progressUpdatedAt: "2026-03-27T12:02:00.000Z"
      }
    ],
    recentEventLog: [
      {
        id: "event-2",
        timestamp: "2026-03-27T12:03:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "achievement",
        description: "解锁成就：初次交锋",
        achievementId: "first_battle",
        rewards: [{ type: "badge", label: "初次交锋" }]
      },
      {
        id: "event-1",
        timestamp: "2026-03-27T12:00:00.000Z",
        roomId: "room-alpha",
        playerId: "player-1",
        category: "combat",
        description: "暮火侦骑 与敌方英雄交战。",
        heroId: "hero-1",
        worldEventType: "battle.started",
        rewards: [{ type: "experience", label: "经验", amount: 40 }]
      }
    ],
    recentBattleReplays: [
      {
        id: "room-alpha:battle-1:player-1",
        roomId: "room-alpha",
        playerId: "player-1",
        battleId: "battle-1",
        battleKind: "neutral",
        playerCamp: "attacker",
        heroId: "hero-1",
        neutralArmyId: "neutral-1",
        startedAt: "2026-03-27T12:00:00.000Z",
        completedAt: "2026-03-27T12:03:00.000Z",
        initialState: battleState,
        steps: [
          {
            index: 1,
            source: "player",
            action: {
              type: "battle.attack",
              attackerId: "hero-1-stack",
              defenderId: "neutral-1-stack"
            }
          },
          {
            index: 2,
            source: "automated",
            action: {
              type: "battle.defend",
              unitId: "neutral-1-stack"
            }
          }
        ],
        result: "attacker_victory"
      },
      {
        id: "room-alpha:battle-2:player-1",
        roomId: "room-alpha",
        playerId: "player-1",
        battleId: "battle-2",
        battleKind: "hero",
        playerCamp: "defender",
        heroId: "hero-1",
        opponentHeroId: "hero-2",
        startedAt: "2026-03-27T12:10:00.000Z",
        completedAt: "2026-03-27T12:13:00.000Z",
        initialState: battleState,
        steps: [
          {
            index: 1,
            source: "player",
            action: {
              type: "battle.skill",
              unitId: "hero-1-stack",
              skillId: "volley"
            }
          }
        ],
        result: "defender_victory"
      }
    ],
    lastRoomId: "room-alpha",
    source: "remote"
  };
}

test("account history renderer shows unlocked achievement state and footnotes", () => {
  const html = renderAchievementProgress(createProfile());

  assert.match(html, /成就 1\/2 已解锁/);
  assert.match(html, /最近推进 猎敌者 2\/3/);
  assert.ok(html.indexOf("初次交锋") < html.indexOf("猎敌者"));
  assert.match(html, /已解锁/);
  assert.match(html, /解锁于/);
  assert.match(html, /最近推进/);
  assert.match(html, /还差 1 点进度/);
});

test("account history renderer shows readable event metadata, category summary, and reward chips", () => {
  const html = renderRecentAccountEvents(createProfile());

  assert.match(html, /最近 2 条关键事件/);
  assert.match(html, /最新/);
  assert.match(html, /成就 1 · 战斗 1/);
  assert.match(html, /英雄 hero-1/);
  assert.match(html, /事件 战斗触发/);
  assert.match(html, /成就 初次交锋/);
  assert.match(html, /经验 \+40/);
  assert.match(html, /初次交锋/);
});

test("account history renderer shows recent battle replay summaries with step chips", () => {
  const html = renderRecentBattleReplays(createProfile(), {
    selectedReplayId: "room-alpha:battle-1:player-1"
  });

  assert.match(html, /最近 2 场战斗的回放摘要/);
  assert.match(html, /PVE · 中立守军 neutral-1/);
  assert.match(html, /房间 room-alpha/);
  assert.match(html, /回放 2 步/);
  assert.match(html, /玩家 1/);
  assert.match(html, /自动 1/);
  assert.match(html, /技能 1/);
  assert.match(html, /data-select-replay="room-alpha:battle-1:player-1"/);
  assert.match(html, /account-replay-entry is-victory is-selected/);
});

test("account history renderer groups battle list and replay detail into a replay center", () => {
  const profile = createProfile();
  const replay = profile.recentBattleReplays[0]!;
  const html = renderBattleReportReplayCenter({
    account: profile,
    selectedReplayId: replay.id,
    replay,
    playback: createBattleReplayPlaybackState(replay),
    status: "已加载完整回放，可逐步回看。"
  });

  assert.match(html, /data-testid="battle-report-center"/);
  assert.match(html, /战报与回放中心/);
  assert.match(html, /最近累计 2 场战斗/);
  assert.match(html, /支持从列表进入详情或基础回放/);
  assert.match(html, /战报 2/);
  assert.match(html, /查看最新战报/);
  assert.match(html, /进入回放中心/);
  assert.match(html, /可直接打开最新结算，或进入逐步回放/);
  assert.match(html, /class="account-replay-entry-point is-primary"/);
  assert.match(html, /data-select-replay="room-alpha:battle-1:player-1"/);
  assert.match(html, /回放详情/);
});

test("account history renderer shows replay inspector controls and current playback snapshot", () => {
  const profile = createProfile();
  const replay = profile.recentBattleReplays[0]!;
  const playback = stepBattleReplayPlayback(createBattleReplayPlaybackState(replay));
  const html = renderBattleReplayInspector({
    account: profile,
    replay,
    playback,
    status: "已前进一步。"
  });

  assert.match(html, /回放详情/);
  assert.match(html, /状态 已暂停/);
  assert.match(html, /进度 1\/2/);
  assert.match(html, /结果概览/);
  assert.match(html, /伤亡摘要/);
  assert.match(html, /战后收益/);
  assert.match(html, /经验 \+40/);
  assert.match(html, /当前动作/);
  assert.match(html, /hero-1-stack 攻击 neutral-1-stack/);
  assert.match(html, /下一动作/);
  assert.match(html, /neutral-1-stack 防御/);
  assert.match(html, /第 1 回合/);
  assert.match(html, /data-replay-control="play"/);
  assert.match(html, /data-replay-control="step"/);
  assert.match(html, /data-clear-replay="true"/);
});

test("account history renderer shows replay inspector placeholder before a replay is selected", () => {
  const profile = createProfile();
  const html = renderBattleReplayInspector({
    account: profile,
    replay: null,
    playback: null,
    status: "选择一场最近战斗，即可查看逐步回放。"
  });

  assert.match(html, /回放详情/);
  assert.match(html, /选择一场最近战斗/);
});

test("account history renderer shows replay center empty state without blank content", () => {
  const profile = createProfile();
  profile.recentBattleReplays = [];

  const html = renderBattleReportReplayCenter({
    account: profile,
    selectedReplayId: null,
    replay: null,
    playback: null,
    status: "选择一场最近战斗，即可查看逐步回放。"
  });

  assert.match(html, /战报与回放中心/);
  assert.match(html, /暂无可回看的战斗记录/);
  assert.match(html, /暂无战报/);
  assert.match(html, /等待首场战报/);
  assert.match(html, /回放中心待解锁/);
  assert.match(html, /尚未记录可回看的战斗摘要/);
  assert.match(html, /选择一场最近战斗/);
});
