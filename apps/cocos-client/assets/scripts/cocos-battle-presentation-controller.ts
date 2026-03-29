import type { CocosBattleFeedbackTone } from "./project-shared/index.ts";
import type { BattleAction, BattleState, SessionUpdate } from "./VeilCocosSession.ts";
import {
  buildBattleActionPresentation,
  buildBattlePresentationPlan,
  type CocosBattlePresentationMoment,
  type CocosBattlePresentationPlan
} from "./cocos-battle-presentation.ts";

export interface CocosBattlePresentationState {
  battleId: string | null;
  phase: CocosBattlePresentationPlan["phase"];
  moment: CocosBattlePresentationMoment;
  label: string;
  detail: string;
  badge: string;
  tone: CocosBattleFeedbackTone;
  result: "victory" | "defeat" | null;
}

export interface CocosBattlePresentationController {
  previewAction(action: BattleAction, battle: BattleState | null): CocosBattlePresentationPlan;
  applyUpdate(previousBattle: BattleState | null, update: SessionUpdate, heroId: string | null): CocosBattlePresentationPlan;
  getState(): CocosBattlePresentationState;
  reset(): void;
}

const IDLE_STATE: CocosBattlePresentationState = {
  battleId: null,
  phase: "idle",
  moment: "idle",
  label: "等待战斗",
  detail: "当前没有战斗。",
  badge: "IDLE",
  tone: "neutral",
  result: null
};

export function createCocosBattlePresentationController(): CocosBattlePresentationController {
  let state = IDLE_STATE;

  return {
    previewAction(action, battle) {
      const plan = buildBattleActionPresentation(action, battle);
      state = plan.state;
      return plan;
    },
    applyUpdate(previousBattle, update, heroId) {
      const plan = buildBattlePresentationPlan(previousBattle, update, heroId);
      state = plan.state;
      return plan;
    },
    getState() {
      return state;
    },
    reset() {
      state = IDLE_STATE;
    }
  };
}
