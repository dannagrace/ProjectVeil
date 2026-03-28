import type { CocosAudioCue } from "./cocos-presentation-config.ts";
import type { BattleAction, BattleState, SessionUpdate } from "./VeilCocosSession.ts";
import { buildBattleEnterCopy, buildBattleExitCopy, type BattleTransitionCopy } from "./cocos-battle-transition-copy.ts";
import {
  buildBattleActionFeedback,
  buildBattleProgressFeedback,
  buildBattleTransitionFeedback,
  type CocosBattleFeedbackView
} from "./cocos-battle-feedback.ts";

export type CocosBattlePresentationPhase = "idle" | "command" | "enter" | "impact" | "active" | "resolution";
export type CocosBattlePresentationAnimation = "idle" | "attack" | "hit" | "victory" | "defeat";

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
}

const RESOLUTION_FEEDBACK_DURATION_MS = 4200;

export function buildBattleActionPresentation(
  action: BattleAction,
  battle: BattleState | null
): CocosBattlePresentationPlan {
  return {
    phase: "command",
    feedback: buildBattleActionFeedback(action, battle),
    feedbackDurationMs: null,
    cue: action.type === "battle.attack" ? "attack" : action.type === "battle.skill" ? "skill" : null,
    animation:
      action.type === "battle.attack" || (action.type === "battle.skill" && action.targetId && action.targetId !== action.unitId)
        ? "attack"
        : "idle",
    transition: null
  };
}

export function buildBattlePresentationPlan(
  previousBattle: BattleState | null,
  update: SessionUpdate,
  heroId: string | null
): CocosBattlePresentationPlan {
  const nextBattle = update.battle ?? null;

  if (!previousBattle && nextBattle) {
    return {
      phase: "enter",
      feedback: buildBattleTransitionFeedback(update, heroId),
      feedbackDurationMs: null,
      cue: null,
      animation: "attack",
      transition: {
        kind: "enter",
        copy: buildBattleEnterCopy(update)
      }
    };
  }

  if (previousBattle && !nextBattle) {
    const didWin = resolveBattleResolution(update, heroId);
    return {
      phase: "resolution",
      feedback: buildBattleTransitionFeedback(update, heroId),
      feedbackDurationMs: RESOLUTION_FEEDBACK_DURATION_MS,
      cue: didWin === null ? null : didWin ? "victory" : "defeat",
      animation: didWin === null ? "idle" : didWin ? "victory" : "defeat",
      transition: {
        kind: "exit",
        copy: buildBattleExitCopy(previousBattle, update, didWin ?? false)
      }
    };
  }

  if (previousBattle && nextBattle) {
    const impactDetected = detectBattleImpact(previousBattle, nextBattle);
    return {
      phase: impactDetected ? "impact" : "active",
      feedback: buildBattleProgressFeedback(previousBattle, nextBattle),
      feedbackDurationMs: null,
      cue: impactDetected ? "hit" : null,
      animation: impactDetected ? "hit" : "idle",
      transition: null
    };
  }

  return {
    phase: "idle",
    feedback: null,
    feedbackDurationMs: null,
    cue: null,
    animation: "idle",
    transition: null
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
