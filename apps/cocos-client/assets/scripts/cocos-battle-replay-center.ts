import type { CocosAccountReviewSectionStatus } from "./cocos-account-review.ts";
import { buildBattlePanelViewModel } from "./cocos-battle-panel-model.ts";
import { buildCocosBattleReplayTimelineView } from "./cocos-battle-replay-timeline.ts";
import type {
  BattleReplayPlaybackState,
  BattleReplayStep,
  PlayerBattleReplaySummary
} from "./project-shared/battle-replay.ts";
import type { SessionUpdate, TerrainType } from "./VeilCocosSession.ts";

export type CocosBattleReplayCenterControlAction = "play" | "pause" | "step-back" | "step-forward" | "reset";

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
  selectedReplayId: string | null;
  playback: BattleReplayPlaybackState | null;
  status: CocosAccountReviewSectionStatus;
  errorMessage?: string | null;
}

export function buildCocosBattleReplayCenterView(input: CocosBattleReplayCenterInput): CocosBattleReplayCenterView {
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
  const timeline = buildCocosBattleReplayTimelineView(replay, { limit: 2 });
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
      `当前动作：${formatReplayAction(playback.currentStep)}`,
      `下一动作：${formatReplayAction(playback.nextStep)}`,
      `战场：${battlePanel.stage?.title ?? "未知战场"}${battlePanel.stage?.subtitle ? ` · ${battlePanel.stage.subtitle}` : ""}`,
      stageLine,
      activeUnitLine,
      `我方编队：${battlePanel.friendlyItems.map((item) => item.title).join(" / ") || "暂无可视编队"}`,
      `目标摘要：${battlePanel.enemyTargets.map((item) => item.title).join(" / ") || "暂无敌方目标"}`,
      `时间线：${timeline.entries.map((entry) => `${entry.stepLabel} ${entry.actionLabel}`).join(" · ") || timeline.emptyMessage || "暂无时间线"}`
    ],
    controls: [
      { action: "play", label: "播放", enabled: playback.status !== "playing" && playback.status !== "completed" },
      { action: "pause", label: "暂停", enabled: playback.status === "playing" },
      { action: "step-back", label: "后退", enabled: playback.currentStepIndex > 0 },
      { action: "step-forward", label: "前进", enabled: playback.currentStepIndex < playback.totalSteps },
      { action: "reset", label: "重置", enabled: playback.currentStepIndex > 0 || playback.status === "completed" }
    ]
  };
}

function createDisabledControls(): CocosBattleReplayCenterControlView[] {
  return [
    { action: "play", label: "播放", enabled: false },
    { action: "pause", label: "暂停", enabled: false },
    { action: "step-back", label: "后退", enabled: false },
    { action: "step-forward", label: "前进", enabled: false },
    { action: "reset", label: "重置", enabled: false }
  ];
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
    battle: playback.currentState,
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

function formatReplayEncounterLabel(replay: PlayerBattleReplaySummary): string {
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
