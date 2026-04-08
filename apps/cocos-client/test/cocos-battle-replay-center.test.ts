import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosBattleReplayCenterView } from "../assets/scripts/cocos-battle-replay-center";
import {
  createBattleReplayPlaybackState,
  playBattleReplayPlayback,
  resetBattleReplayPlayback,
  restoreBattleReplayPlaybackState,
  stepBattleReplayPlayback
} from "../assets/scripts/project-shared/battle-replay";
import type { PlayerBattleReportSummary } from "../assets/scripts/project-shared/index";
import { createBattleReplaySummary } from "./helpers/cocos-panel-harness";

test("buildCocosBattleReplayCenterView renders loading and error transport states without controls", () => {
  const loadingView = buildCocosBattleReplayCenterView({
    replays: [],
    selectedReplayId: null,
    playback: null,
    status: "loading"
  });

  assert.equal(loadingView.state, "loading");
  assert.equal(loadingView.badge, "SYNC");
  assert.match(loadingView.detailLines[0] ?? "", /加载回放摘要/);
  assert.ok(loadingView.controls.every((control) => control.enabled === false));

  const errorView = buildCocosBattleReplayCenterView({
    replays: [],
    selectedReplayId: null,
    playback: null,
    status: "error",
    errorMessage: "  Gateway timeout  "
  });

  assert.equal(errorView.state, "error");
  assert.equal(errorView.badge, "ERROR");
  assert.equal(errorView.detailLines[0], "Gateway timeout");
  assert.ok(errorView.controls.every((control) => control.enabled === false));
});

test("buildCocosBattleReplayCenterView keeps replay list visible when selection or playback is not ready", () => {
  const replay = createBattleReplaySummary();

  const unselectedView = buildCocosBattleReplayCenterView({
    replays: [replay],
    selectedReplayId: "missing-replay",
    playback: null,
    status: "ready"
  });

  assert.equal(unselectedView.state, "empty");
  assert.equal(unselectedView.badge, "READY");
  assert.match(unselectedView.detailLines[0] ?? "", /1 场战斗摘要已同步/);
  assert.ok(unselectedView.controls.every((control) => control.enabled === false));

  const otherReplay = {
    ...replay,
    id: "replay-2",
    battleId: "battle-2"
  };
  const mismatchedPlaybackView = buildCocosBattleReplayCenterView({
    replays: [replay, otherReplay],
    selectedReplayId: otherReplay.id,
    playback: createBattleReplayPlaybackState(replay),
    status: "ready"
  });

  assert.equal(mismatchedPlaybackView.state, "empty");
  assert.match(mismatchedPlaybackView.subtitle, /选择一场最近战斗/);
  assert.ok(mismatchedPlaybackView.controls.every((control) => control.enabled === false));
});

test("buildCocosBattleReplayCenterView derives ready-state summary lines and target selection from playback", () => {
  const replay = createBattleReplaySummary();
  replay.steps = [
    {
      index: 1,
      source: "player",
      action: {
        type: "battle.skill",
        unitId: "hero-1-stack",
        skillId: "power-shot",
        targetId: "neutral-1-stack"
      }
    },
    {
      index: 2,
      source: "automated",
      action: {
        type: "battle.attack",
        attackerId: "neutral-1-stack",
        defenderId: "hero-1-stack"
      }
    }
  ];
  const report: PlayerBattleReportSummary = {
    id: replay.id,
    replayId: replay.id,
    roomId: replay.roomId,
    playerId: replay.playerId,
    battleId: replay.battleId,
    battleKind: replay.battleKind,
    playerCamp: replay.playerCamp,
    heroId: replay.heroId,
    opponentHeroId: replay.opponentHeroId,
    neutralArmyId: replay.neutralArmyId,
    startedAt: replay.startedAt,
    completedAt: replay.completedAt,
    result: "victory",
    turnCount: 1,
    actionCount: replay.steps.length,
    rewards: [{ type: "resource", label: "金币", amount: 40 }],
    evidence: { replay: "available", rewards: "available" }
  };

  const view = buildCocosBattleReplayCenterView({
    replays: [replay],
    battleReports: { latestReportId: report.id, items: [report] },
    selectedReplayId: replay.id,
    playback: createBattleReplayPlaybackState(replay),
    status: "ready"
  });

  assert.equal(view.state, "ready");
  assert.equal(view.title, "战报回放中心 · 胜利");
  assert.match(view.subtitle, /PVE · 守军 neutral-1 · 已暂停/);
  assert.equal(view.badge, "0/2");
  assert.match(view.detailLines[0] ?? "", /03-27 12:03 · 攻方 · 房间 room-alpha/);
  assert.equal(view.detailLines[1], "回合定位：1/1 · ========");
  assert.equal(view.detailLines[2], "播放倍率：1x");
  assert.equal(view.detailLines[3], "当前动作：暂无动作");
  assert.equal(view.detailLines[4], "下一动作：hero-1-stack 施放 power-shot -> neutral-1-stack");
  assert.match(view.detailLines[5] ?? "", /战场：未知战场 · 战场交锋 · 坐标 \(0,0\)/);
  assert.equal(view.detailLines[6], "阶段：轮到我方");
  assert.equal(view.detailLines[7], "行动单位：Guard x12");
  assert.equal(view.detailLines[8], "我方编队：Guard x12");
  assert.equal(view.detailLines[9], "目标摘要：Wolf x8");
  assert.match(view.detailLines[10] ?? "", /1/);
  assert.match(view.detailLines[11] ?? "", /战报摘要：胜利 · PVE · 守军 neutral-1 · 1T\/2A/);
  assert.equal(view.detailLines[12], "证据：回放可用 · 奖励可用");
  assert.equal(view.detailLines[13], "战后收益：金币 +40");
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

test("buildCocosBattleReplayCenterView surfaces battle report evidence and rewards when available", () => {
  const replay = createBattleReplaySummary();
  const report: PlayerBattleReportSummary = {
    id: replay.id,
    replayId: replay.id,
    roomId: replay.roomId,
    playerId: replay.playerId,
    battleId: replay.battleId,
    battleKind: replay.battleKind,
    playerCamp: replay.playerCamp,
    heroId: replay.heroId,
    opponentHeroId: replay.opponentHeroId,
    neutralArmyId: replay.neutralArmyId,
    startedAt: replay.startedAt,
    completedAt: replay.completedAt,
    result: "victory",
    turnCount: 1,
    actionCount: replay.steps.length,
    rewards: [{ type: "resource", label: "金币", amount: 20 }],
    evidence: { replay: "available", rewards: "available" }
  };

  const view = buildCocosBattleReplayCenterView({
    replays: [replay],
    battleReports: { latestReportId: report.id, items: [report] },
    selectedReplayId: replay.id,
    playback: createBattleReplayPlaybackState(replay),
    status: "ready"
  });

  const [headline, evidence, rewards] = view.detailLines.slice(-3);
  assert.match(headline ?? "", /战报摘要：胜利 ·/);
  assert.equal(evidence, "证据：回放可用 · 奖励可用");
  assert.equal(rewards, "战后收益：金币 +20");
});

test("buildCocosBattleReplayCenterView updates controls across playing, stepped, completed and reset playback states", () => {
  const replay = createBattleReplaySummary();
  const pausedPlayback = createBattleReplayPlaybackState(replay);
  const playingPlayback = playBattleReplayPlayback(pausedPlayback);
  const steppedPlayback = stepBattleReplayPlayback(playingPlayback);
  const completedPlayback = restoreBattleReplayPlaybackState(replay, replay.steps.length, "paused");
  const resetPlayback = resetBattleReplayPlayback(completedPlayback);

  const playingView = buildCocosBattleReplayCenterView({
    replays: [replay],
    selectedReplayId: replay.id,
    playback: playingPlayback,
    status: "ready"
  });
  assert.equal(playingView.subtitle.endsWith("播放中"), true);
  assert.deepEqual(
    playingView.controls.map((control) => control.enabled),
    [false, true, false, true, false, false, true, true, false]
  );

  const steppedView = buildCocosBattleReplayCenterView({
    replays: [replay],
    selectedReplayId: replay.id,
    playback: steppedPlayback,
    status: "ready"
  });
  assert.equal(steppedView.badge, "1/2");
  assert.equal(steppedView.detailLines[3], "当前动作：hero-1-stack 等待");
  assert.equal(steppedView.detailLines[4], "下一动作：neutral-1-stack 防御");
  assert.deepEqual(
    steppedView.controls.map((control) => control.enabled),
    [false, true, true, true, false, false, true, true, true]
  );

  const completedView = buildCocosBattleReplayCenterView({
    replays: [replay],
    selectedReplayId: replay.id,
    playback: completedPlayback,
    status: "ready"
  });
  assert.equal(completedView.subtitle.endsWith("已播完"), true);
  assert.equal(completedView.badge, "2/2");
  assert.equal(completedView.detailLines[4], "下一动作：暂无动作");
  assert.deepEqual(
    completedView.controls.map((control) => control.enabled),
    [false, false, true, false, false, false, true, true, true]
  );

  const resetView = buildCocosBattleReplayCenterView({
    replays: [replay],
    selectedReplayId: replay.id,
    playback: resetPlayback,
    status: "ready"
  });
  assert.equal(resetView.badge, "0/2");
  assert.deepEqual(
    resetView.controls.map((control) => control.enabled),
    [true, false, false, true, false, false, true, true, false]
  );
});
