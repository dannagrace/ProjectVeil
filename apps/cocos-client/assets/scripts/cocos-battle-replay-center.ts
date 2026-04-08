import type { CocosAccountReviewSectionStatus } from "./cocos-account-review.ts";
import { buildBattlePanelViewModel } from "./cocos-battle-panel-model.ts";
import { buildCocosBattleReplayTimelineView } from "./cocos-battle-replay-timeline.ts";
import type { PlayerBattleReportCenter, PlayerBattleReportSummary } from "./project-shared/index.ts";
import type {
  BattleReplayPlaybackState,
  BattleReplayStep,
  PlayerBattleReplaySummary
} from "./project-shared/battle-replay.ts";
import { buildBattleReplayTimeline } from "./project-shared/battle-replay.ts";
import type { SessionUpdate, TerrainType } from "./VeilCocosSession.ts";

export type CocosBattleReplayCenterControlAction =
  | "play"
  | "pause"
  | "step-back"
  | "step-forward"
  | "turn-back"
  | "turn-forward"
  | "speed-down"
  | "speed-up"
  | "reset";

export interface CocosBattleReplayCenterControlView {
  action: CocosBattleReplayCenterControlAction;
  label: string;
  enabled: boolean;
}

export interface CocosBattleReplayCenterView {
  state: "loading" | "empty" | "error" | "ready";
  title: string;
  subtitle: string;
  badge: string;
  detailLines: string[];
  controls: CocosBattleReplayCenterControlView[];
}

export interface CocosBattleReplayCenterInput {
  replays: PlayerBattleReplaySummary[];
  battleReports?: PlayerBattleReportCenter | null | undefined;
  selectedReplayId: string | null;
  playback: BattleReplayPlaybackState | null;
  status: CocosAccountReviewSectionStatus;
  errorMessage?: string | null;
}

export function buildCocosBattleReplayCenterView(input: CocosBattleReplayCenterInput): CocosBattleReplayCenterView {
  const selectedReport = resolveSelectedReport(input.battleReports, input.selectedReplayId);
  if (input.status === "loading" && input.replays.length === 0) {
    return {
      state: "loading",
      title: "战报回放中心",
      subtitle: "正在同步最近战斗...",
      badge: "SYNC",
      detailLines: [
        "正在加载回放摘要与逐步战报。",
        "移动端会先给出当前状态，避免出现空白面板。"
      ],
      controls: createDisabledControls()
    };
  }

  if (input.status === "error" && input.replays.length === 0) {
    return {
      state: "error",
      title: "战报回放中心",
      subtitle: "战报同步失败",
      badge: "ERROR",
      detailLines: [
        input.errorMessage?.trim() || "本次未能加载战斗回放，请稍后重试。",
        "可先保留在当前页，重新同步后会恢复最近战报列表。"
      ],
      controls: createDisabledControls()
    };
  }

  if (!input.replays.length && selectedReport) {
    return {
      state: "ready",
      title: `战报回放中心 · ${selectedReport.result === "victory" ? "胜利" : "失利"}`,
      subtitle: `${selectedReport.battleKind === "hero" ? "PVP" : "PVE"} · ${formatReplayEncounterLabel(selectedReport)} · 摘要模式`,
      badge: `${selectedReport.turnCount}T/${selectedReport.actionCount}A`,
      detailLines: [
        `${formatReplayTimestamp(selectedReport.completedAt)} · ${formatReplayCampLabel(selectedReport.playerCamp)} · 房间 ${selectedReport.roomId}`,
        `英雄：${selectedReport.heroId}`,
        `回放证据：${selectedReport.evidence.replay === "available" ? "可用" : "缺失"} · 收益证据：${selectedReport.evidence.rewards === "available" ? "可用" : "缺失"}`,
        selectedReport.rewards.length > 0
          ? `战后收益：${selectedReport.rewards
              .map((reward) => reward.amount != null ? `${reward.label}+${reward.amount}` : reward.label)
              .join(" / ")}`
          : `战后收益：${selectedReport.evidence.rewards === "available" ? "收益同步中" : "暂无额外奖励记录"}`,
        input.errorMessage?.trim() || "当前仅同步到战报摘要，完整回放暂不可用。"
      ],
      controls: createDisabledControls()
    };
  }

  if (input.replays.length === 0) {
    return {
      state: "empty",
      title: "战报回放中心",
      subtitle: "暂无可回看的战斗记录",
      badge: "EMPTY",
      detailLines: [
        "尚未记录可回看的战斗摘要。",
        "完成一场 PVE 或 PVP 战斗后，这里会出现最近战报与基础回放控制。"
      ],
      controls: createDisabledControls()
    };
  }

  const replay = input.replays.find((entry) => entry.id === input.selectedReplayId) ?? input.replays[0] ?? null;
  if (!replay || !input.playback || input.playback.replay.id !== replay.id) {
    return {
      state: "empty",
      title: "战报回放中心",
      subtitle: "选择一场最近战斗",
      badge: "READY",
      detailLines: [
        `${input.replays.length} 场战斗摘要已同步。`,
        "点选下方战报卡片后，可使用播放、暂停、前后步进与重置控制查看当前快照。"
      ],
      controls: createDisabledControls()
    };
  }

  const playback = input.playback;
  const rewardSummaryLine = selectedReport ? formatBattleReportRewardLine(selectedReport) : null;
  const evidenceSummaryLine = selectedReport ? formatBattleReportEvidenceLine(selectedReport) : null;
  const reportHeadlineLine = selectedReport ? formatBattleReportHeadline(selectedReport) : null;
  const timeline = buildCocosBattleReplayTimelineView(replay, { limit: 2 });
  const turnSummary = buildReplayTurnSummary(replay, playback);
  const battlePanel = buildBattlePanelViewModel({
    update: buildReplaySessionUpdate(replay, playback),
    timelineEntries: [],
    controlledCamp: replay.playerCamp,
    selectedTargetId: resolveSelectedTargetId(playback),
    actionPending: false,
    feedback: null,
    presentationState: null
  });
  const stageLine = battlePanel.summaryLines.find((line) => line.startsWith("阶段：")) ?? "阶段：信息缺失";
  const activeUnitLine = battlePanel.summaryLines.find((line) => line.startsWith("行动单位：")) ?? "行动单位：暂无";

  return {
    state: "ready",
    title: `战报回放中心 · ${formatReplayResultBadge(replay)}`,
    subtitle: `${formatBattleKindLabel(replay)} · ${formatReplayEncounterLabel(replay)} · ${formatPlaybackStatus(playback)}`,
    badge: `${playback.currentStepIndex}/${playback.totalSteps}`,
    detailLines: [
      `${formatReplayTimestamp(replay.completedAt)} · ${formatReplayCampLabel(replay.playerCamp)} · 房间 ${replay.roomId}`,
      `回合定位：${turnSummary.currentTurn}/${turnSummary.totalTurns} · ${turnSummary.progressBar}`,
      `播放倍率：${playback.speed}x`,
      `当前动作：${formatReplayAction(playback.currentStep)}`,
      `下一动作：${formatReplayAction(playback.nextStep)}`,
      `战场：${battlePanel.stage?.title ?? "未知战场"}${battlePanel.stage?.subtitle ? ` · ${battlePanel.stage.subtitle}` : ""}`,
      stageLine,
      activeUnitLine,
      `我方编队：${battlePanel.friendlyItems.map((item) => item.title).join(" / ") || "暂无可视编队"}`,
      `目标摘要：${battlePanel.enemyTargets.map((item) => item.title).join(" / ") || "暂无敌方目标"}`,
      `时间线：${timeline.entries.map((entry) => `${entry.stepLabel} ${entry.actionLabel}`).join(" · ") || timeline.emptyMessage || "暂无时间线"}`,
      ...(reportHeadlineLine ? [reportHeadlineLine] : []),
      ...(evidenceSummaryLine ? [evidenceSummaryLine] : []),
      ...(rewardSummaryLine ? [rewardSummaryLine] : [])
    ],
    controls: [
      { action: "play", label: "播放", enabled: playback.status !== "playing" && playback.status !== "completed" },
      { action: "pause", label: "暂停", enabled: playback.status === "playing" },
      { action: "step-back", label: "后退", enabled: playback.currentStepIndex > 0 },
      { action: "step-forward", label: "前进", enabled: playback.currentStepIndex < playback.totalSteps },
      { action: "turn-back", label: "上一回", enabled: turnSummary.currentTurn > 1 },
      { action: "turn-forward", label: "下一回", enabled: turnSummary.currentTurn < turnSummary.totalTurns },
      { action: "speed-down", label: "减速", enabled: playback.speed > 0.5 },
      { action: "speed-up", label: "加速", enabled: playback.speed < 4 },
      { action: "reset", label: "重置", enabled: playback.currentStepIndex > 0 || playback.status === "completed" }
    ]
  };
}

function resolveSelectedReport(
  battleReports: PlayerBattleReportCenter | null | undefined,
  selectedReplayId: string | null
): PlayerBattleReportSummary | null {
  const reports = battleReports?.items ?? [];
  if (selectedReplayId) {
    const selected = reports.find((report) => report.id === selectedReplayId);
    if (selected) {
      return selected;
    }
  }

  return battleReports?.latestReportId
    ? reports.find((report) => report.id === battleReports.latestReportId) ?? reports[0] ?? null
    : reports[0] ?? null;
}

function createDisabledControls(): CocosBattleReplayCenterControlView[] {
  return [
    { action: "play", label: "播放", enabled: false },
    { action: "pause", label: "暂停", enabled: false },
    { action: "step-back", label: "后退", enabled: false },
    { action: "step-forward", label: "前进", enabled: false },
    { action: "turn-back", label: "上一回", enabled: false },
    { action: "turn-forward", label: "下一回", enabled: false },
    { action: "speed-down", label: "减速", enabled: false },
    { action: "speed-up", label: "加速", enabled: false },
    { action: "reset", label: "重置", enabled: false }
  ];
}

function buildReplayTurnSummary(
  replay: PlayerBattleReplaySummary,
  playback: BattleReplayPlaybackState
): { currentTurn: number; totalTurns: number; progressBar: string } {
  const initialTurn = Math.max(1, Math.floor(replay.initialState.round || 1));
  const timeline = buildBattleReplayTimeline(replay);
  const totalTurns = Math.max(initialTurn, timeline.at(-1)?.resultingRound ?? initialTurn);
  const currentTurn = Math.max(
    initialTurn,
    playback.currentStep?.index != null
      ? (timeline[playback.currentStep.index - 1]?.resultingRound ?? initialTurn)
      : initialTurn
  );
  const filled = Math.max(1, Math.min(8, Math.round((currentTurn / totalTurns) * 8)));
  return {
    currentTurn,
    totalTurns,
    progressBar: `${"=".repeat(filled)}${"-".repeat(Math.max(0, 8 - filled))}`
  };
}

function buildReplaySessionUpdate(replay: PlayerBattleReplaySummary, playback: BattleReplayPlaybackState): SessionUpdate {
  const encounterPosition = playback.currentState.encounterPosition ?? replay.initialState.encounterPosition ?? { x: 0, y: 0 };
  const terrain: TerrainType = "unknown";
  return {
    world: {
      meta: {
        roomId: replay.roomId,
        seed: 0,
        day: 0
      },
      map: {
        width: 1,
        height: 1,
        tiles: [
          {
            position: encounterPosition,
            fog: "visible",
            terrain,
            walkable: true,
            resource: undefined,
            occupant: undefined,
            building: undefined
          }
        ]
      },
      ownHeroes: [],
      visibleHeroes: [],
      resources: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      playerId: replay.playerId
    },
    battle: playback.currentState as SessionUpdate["battle"],
    events: [],
    movementPlan: null,
    reachableTiles: []
  };
}

function resolveSelectedTargetId(playback: BattleReplayPlaybackState): string | null {
  const current = playback.currentStep;
  const next = playback.nextStep;
  const currentTarget = resolveTargetId(current);
  if (currentTarget) {
    return currentTarget;
  }

  return resolveTargetId(next);
}

function resolveTargetId(step: BattleReplayStep | null): string | null {
  if (!step) {
    return null;
  }

  if (step.action.type === "battle.attack") {
    return step.action.defenderId;
  }

  return step.action.type === "battle.skill" ? step.action.targetId ?? null : null;
}

function formatReplayAction(step: BattleReplayStep | null): string {
  if (!step) {
    return "暂无动作";
  }

  if (step.action.type === "battle.attack") {
    return `${step.action.attackerId} 攻击 ${step.action.defenderId}`;
  }

  if (step.action.type === "battle.skill") {
    return `${step.action.unitId} 施放 ${step.action.skillId}${step.action.targetId ? ` -> ${step.action.targetId}` : ""}`;
  }

  if (step.action.type === "battle.defend") {
    return `${step.action.unitId} 防御`;
  }

  return `${step.action.unitId} 等待`;
}

function formatPlaybackStatus(playback: BattleReplayPlaybackState): string {
  if (playback.status === "playing") {
    return "播放中";
  }

  if (playback.status === "completed") {
    return "已播完";
  }

  return "已暂停";
}

function formatReplayResultBadge(replay: PlayerBattleReplaySummary): string {
  const playerWon =
    (replay.playerCamp === "attacker" && replay.result === "attacker_victory") ||
    (replay.playerCamp === "defender" && replay.result === "defender_victory");
  return playerWon ? "胜利" : "失利";
}

function formatReplayCampLabel(camp: PlayerBattleReplaySummary["playerCamp"]): string {
  return camp === "attacker" ? "攻方" : "守方";
}

function formatBattleKindLabel(replay: PlayerBattleReplaySummary): string {
  return replay.battleKind === "hero" ? "PVP" : "PVE";
}

function formatReplayEncounterLabel(
  replay: Pick<PlayerBattleReplaySummary, "battleKind" | "opponentHeroId" | "neutralArmyId">
): string {
  if (replay.battleKind === "hero") {
    return replay.opponentHeroId ? `英雄 ${replay.opponentHeroId}` : "敌方英雄";
  }

  return replay.neutralArmyId ? `守军 ${replay.neutralArmyId}` : "中立守军";
}

function formatReplayTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  const hour = `${date.getUTCHours()}`.padStart(2, "0");
  const minute = `${date.getUTCMinutes()}`.padStart(2, "0");
  return `${month}-${day} ${hour}:${minute}`;
}


function formatBattleReportHeadline(report: PlayerBattleReportSummary): string {
  const resultLabel = formatBattleReportResultLabel(report);
  const kindLabel = report.battleKind === "hero" ? "PVP" : "PVE";
  const encounterLabel = formatReplayEncounterLabel(report);
  return `战报摘要：${resultLabel} · ${kindLabel} · ${encounterLabel} · ${report.turnCount}T/${report.actionCount}A`;
}

function formatBattleReportEvidenceLine(report: PlayerBattleReportSummary): string {
  const replayEvidence = report.evidence.replay === "available" ? "可用" : "缺失";
  const rewardEvidence = report.evidence.rewards === "available" ? "可用" : "缺失";
  return `证据：回放${replayEvidence} · 奖励${rewardEvidence}`;
}

function formatBattleReportRewardLine(report: PlayerBattleReportSummary): string {
  if (report.rewards.length > 0) {
    const chips = report.rewards.map((reward) => formatBattleReportRewardChip(reward)).filter(Boolean);
    return chips.length > 0 ? `战后收益：${chips.join(" / ")}` : "战后收益：暂无额外奖励";
  }

  return `战后收益：${report.evidence.rewards === "available" ? "收益同步中" : "暂无额外奖励记录"}`;
}

function formatBattleReportRewardChip(reward: PlayerBattleReportSummary["rewards"][number]): string {
  if (reward.type === "experience") {
    return reward.amount != null ? `经验 +${reward.amount}` : "经验";
  }

  if (reward.type === "skill_point") {
    return reward.amount != null ? `技能点 +${reward.amount}` : "技能点";
  }

  if (reward.type === "resource") {
    return reward.amount != null ? `${reward.label} +${reward.amount}` : reward.label;
  }

  return reward.amount != null ? `${reward.label} +${reward.amount}` : reward.label;
}

function formatBattleReportResultLabel(report: PlayerBattleReportSummary): string {
  return report.result === "victory" ? "胜利" : "失利";
}
