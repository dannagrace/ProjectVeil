import type { CocosAudioCue } from "./cocos-presentation-config.ts";
import type { BattleAction, BattleState, SessionUpdate } from "./VeilCocosSession.ts";
import { buildBattleEnterCopy, buildBattleExitCopy, type BattleTransitionCopy } from "./cocos-battle-transition-copy.ts";
import {
  analyzeBattleProgress,
  buildBattleActionFeedback,
  buildBattleSettlementLines,
  buildBattleProgressFeedback,
  buildBattleTransitionFeedback,
  type CocosBattleFeedbackView
} from "./cocos-battle-feedback.ts";
import type { CocosBattlePresentationState } from "./cocos-battle-presentation-controller.ts";

export type CocosBattlePresentationPhase = "idle" | "command" | "enter" | "impact" | "active" | "resolution";
export type CocosBattlePresentationAnimation = "idle" | "attack" | "hit" | "victory" | "defeat";
export type CocosBattlePresentationMoment =
  | "idle"
  | "battle_enter"
  | "command_attack"
  | "command_skill"
  | "command_guard"
  | "command_wait"
  | "impact_hit"
  | "impact_death"
  | "active_skill"
  | "active"
  | "result_victory"
  | "result_defeat";

export interface CocosBattlePresentationTransition {
  kind: "enter" | "exit";
  copy: BattleTransitionCopy;
}

export interface CocosBattlePresentationPlan {
  phase: CocosBattlePresentationPhase;
  feedback: CocosBattleFeedbackView | null;
  feedbackDurationMs: number | null;
  cue: CocosAudioCue | null;
  animation: CocosBattlePresentationAnimation;
  transition: CocosBattlePresentationTransition | null;
  moment: CocosBattlePresentationMoment;
  state: CocosBattlePresentationState;
}

const RESOLUTION_FEEDBACK_DURATION_MS = 4200;

export function buildBattleActionPresentation(
  action: BattleAction,
  battle: BattleState | null
): CocosBattlePresentationPlan {
  const feedback = buildBattleActionFeedback(action, battle);
  const moment =
    action.type === "battle.attack"
      ? "command_attack"
      : action.type === "battle.skill"
        ? "command_skill"
        : action.type === "battle.defend"
          ? "command_guard"
          : "command_wait";
  return {
    phase: "command",
    feedback,
    feedbackDurationMs: null,
    cue: action.type === "battle.attack" ? "attack" : action.type === "battle.skill" ? "skill" : null,
    animation:
      action.type === "battle.attack" || (action.type === "battle.skill" && action.targetId && action.targetId !== action.unitId)
        ? "attack"
        : "idle",
    transition: null,
    moment,
    state: buildPresentationState("command", moment, battle?.id ?? null, feedback, null, {
      cue: action.type === "battle.attack" ? "attack" : action.type === "battle.skill" ? "skill" : null,
      animation:
        action.type === "battle.attack" || (action.type === "battle.skill" && action.targetId && action.targetId !== action.unitId)
          ? "attack"
          : "idle",
      transition: null,
      durationMs: null,
      summaryLines: []
    })
  };
}

export function buildBattlePresentationPlan(
  previousBattle: BattleState | null,
  update: SessionUpdate,
  heroId: string | null
): CocosBattlePresentationPlan {
  const nextBattle = update.battle ?? null;

  if (!previousBattle && nextBattle) {
    const feedback = buildBattleTransitionFeedback(update, heroId);
    return {
      phase: "enter",
      feedback,
      feedbackDurationMs: null,
      cue: null,
      animation: "attack",
      transition: {
        kind: "enter",
        copy: buildBattleEnterCopy(update)
      },
      moment: "battle_enter",
      state: buildPresentationState("enter", "battle_enter", nextBattle.id, feedback, null, {
        cue: null,
        animation: "attack",
        transition: "enter",
        durationMs: null,
        summaryLines: []
      })
    };
  }

  if (previousBattle && !nextBattle) {
    const didWin = resolveBattleResolution(update, heroId);
    const feedback = buildBattleTransitionFeedback(update, heroId, previousBattle);
    const result = didWin === null ? null : didWin ? "victory" : "defeat";
    const moment = didWin ? "result_victory" : "result_defeat";
    const cue = didWin === null ? null : didWin ? "victory" : "defeat";
    const animation = didWin === null ? "idle" : didWin ? "victory" : "defeat";
    return {
      phase: "resolution",
      feedback,
      feedbackDurationMs: RESOLUTION_FEEDBACK_DURATION_MS,
      cue,
      animation,
      transition: {
        kind: "exit",
        copy: buildBattleExitCopy(previousBattle, update, didWin ?? false)
      },
      moment,
      state: buildPresentationState("resolution", moment, previousBattle.id, feedback, result, {
        cue,
        animation,
        transition: "exit",
        durationMs: RESOLUTION_FEEDBACK_DURATION_MS,
        summaryLines: buildBattleSettlementLines(previousBattle, update, heroId)
      })
    };
  }

  if (previousBattle && nextBattle) {
    const analysis = analyzeBattleProgress(previousBattle, nextBattle);
    const impactDetected = detectBattleImpact(previousBattle, nextBattle);
    const defeatedUnitDetected = Boolean(analysis && analysis.defeatedUnits.length > 0);
    const skillDetected = Boolean(analysis?.skillTriggered);
    const moment = defeatedUnitDetected ? "impact_death" : impactDetected ? "impact_hit" : skillDetected ? "active_skill" : "active";
    const phase = defeatedUnitDetected || impactDetected ? "impact" : "active";
    const cue = defeatedUnitDetected || impactDetected ? "hit" : skillDetected ? "skill" : null;
    const animation = defeatedUnitDetected || impactDetected ? "hit" : "idle";
    const feedback = buildBattleProgressFeedback(previousBattle, nextBattle);
    return {
      phase,
      feedback,
      feedbackDurationMs: null,
      cue,
      animation,
      transition: null,
      moment,
      state: buildPresentationState(phase, moment, nextBattle.id, feedback, null, {
        cue,
        animation,
        transition: null,
        durationMs: null,
        summaryLines: []
      })
    };
  }

  return {
    phase: "idle",
    feedback: null,
    feedbackDurationMs: null,
    cue: null,
    animation: "idle",
    transition: null,
    moment: "idle",
    state: buildPresentationState("idle", "idle", null, null, null, {
      cue: null,
      animation: "idle",
      transition: null,
      durationMs: null,
      summaryLines: []
    })
  };
}

function resolveBattleResolution(update: SessionUpdate, heroId: string | null): boolean | null {
  const resolved = update.events.find((event) => event.type === "battle.resolved");
  if (!resolved) {
    return null;
  }

  if (!heroId) {
    return resolved.result === "attacker_victory";
  }

  if (resolved.result === "attacker_victory") {
    return resolved.heroId === heroId;
  }

  return resolved.defenderHeroId === heroId;
}

function detectBattleImpact(previousBattle: BattleState, nextBattle: BattleState): boolean {
  for (const [unitId, nextUnit] of Object.entries(nextBattle.units)) {
    const previousUnit = previousBattle.units[unitId];
    if (!previousUnit) {
      continue;
    }

    if (nextUnit.currentHp < previousUnit.currentHp || nextUnit.count < previousUnit.count) {
      return true;
    }
  }

  return false;
}

function buildPresentationState(
  phase: CocosBattlePresentationPhase,
  moment: CocosBattlePresentationMoment,
  battleId: string | null,
  feedback: CocosBattleFeedbackView | null,
  result: CocosBattlePresentationState["result"],
  feedbackLayer: CocosBattlePresentationState["feedbackLayer"] & { summaryLines: string[] }
): CocosBattlePresentationState {
  if (!feedback) {
    return {
      battleId,
      phase,
      moment,
      label: phase === "idle" ? "等待战斗" : "战斗进行中",
      detail: phase === "idle" ? "当前没有战斗。" : "等待新的战斗反馈。",
      badge: phase === "idle" ? "IDLE" : "LIVE",
      tone: phase === "idle" ? "neutral" : "action",
      result,
      summaryLines: buildPresentationSummaryLines(null, feedbackLayer),
      feedbackLayer
    };
  }

  return {
    battleId,
    phase,
    moment,
    label: resolvePresentationLabel(moment, feedback.title),
    detail: feedback.detail,
    badge: feedback.badge,
    tone: feedback.tone,
    result,
    summaryLines: buildPresentationSummaryLines(feedback, feedbackLayer),
    feedbackLayer
  };
}

function buildPresentationSummaryLines(
  feedback: CocosBattleFeedbackView | null,
  feedbackLayer: CocosBattlePresentationState["feedbackLayer"] & { summaryLines: string[] }
): string[] {
  const lines: string[] = [];
  const layerParts = [`动画 ${formatAnimationLabel(feedbackLayer.animation)}`];
  if (feedbackLayer.cue) {
    layerParts.push(`音效 ${formatCueLabel(feedbackLayer.cue)}`);
  }
  if (feedbackLayer.transition) {
    layerParts.push(`转场 ${feedbackLayer.transition === "enter" ? "开战" : "结算"}`);
  }
  lines.push(`反馈层：${layerParts.join(" / ")}`);
  if (feedback?.detail) {
    lines.push(`播报：${feedback.detail}`);
  }
  return lines.concat(feedbackLayer.summaryLines);
}

function formatAnimationLabel(animation: CocosBattlePresentationAnimation): string {
  switch (animation) {
    case "attack":
      return "攻击";
    case "hit":
      return "受击";
    case "victory":
      return "胜利";
    case "defeat":
      return "失败";
    default:
      return "待机";
  }
}

function formatCueLabel(cue: CocosAudioCue): string {
  switch (cue) {
    case "attack":
      return "攻击";
    case "skill":
      return "技能";
    case "hit":
      return "受击";
    case "victory":
      return "胜利";
    case "defeat":
      return "失败";
    default:
      return cue;
  }
}

function resolvePresentationLabel(moment: CocosBattlePresentationMoment, fallback: string): string {
  switch (moment) {
    case "battle_enter":
      return "战斗展开";
    case "command_attack":
      return "普通攻击";
    case "command_skill":
      return "主动技能";
    case "command_guard":
      return "防御指令";
    case "command_wait":
      return "等待指令";
    case "impact_hit":
      return "命中反馈";
    case "impact_death":
      return "单位击倒";
    case "active_skill":
      return "技能结算";
    case "result_victory":
      return "战斗胜利";
    case "result_defeat":
      return "战斗失利";
    default:
      return fallback;
  }
}
