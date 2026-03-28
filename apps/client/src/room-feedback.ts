import type { BattleState, CocosBattleFeedbackTone, MovementPlan, PlayerWorldView } from "../../../packages/shared/src/index";
import type { SessionUpdate } from "./local-session";

interface BattleSettlementSummaryLike {
  title?: string;
  aftermath: string;
}

interface DiagnosticStateLike {
  connectionStatus: "connecting" | "connected" | "reconnecting" | "reconnect_failed";
}

type EncounterStartedEvent = Extract<SessionUpdate["events"][number], { type: "battle.started" }>;
type ActiveHeroLike = Pick<PlayerWorldView["ownHeroes"][number], "move">;

export interface EncounterSourceDetailInput {
  battle: BattleState | null;
  lastEncounterStarted: EncounterStartedEvent | null;
  world: PlayerWorldView;
  previewPlan: MovementPlan | null;
  lastBattleSettlement: BattleSettlementSummaryLike | null;
  diagnostics: DiagnosticStateLike;
  predictionStatus: string;
}

export interface RoomActionHintInput {
  battle: BattleState | null;
  lastBattleSettlement: BattleSettlementSummaryLike | null;
  activeHero: ActiveHeroLike | null;
  diagnostics: DiagnosticStateLike;
  predictionStatus: string;
}

export interface AppState {
  battle: BattleState | null;
  previewPlan: MovementPlan | null;
  lastBattleSettlement: (BattleSettlementSummaryLike & { tone?: CocosBattleFeedbackTone }) | null;
  diagnostics: DiagnosticStateLike;
}

function ownedHeroIds(world: PlayerWorldView): Set<string> {
  return new Set(world.ownHeroes.map((hero) => hero.id));
}

export function resolveRoomFeedbackTone(state: AppState): CocosBattleFeedbackTone {
  if (state.lastBattleSettlement?.tone === "victory" || state.lastBattleSettlement?.tone === "defeat") {
    return state.lastBattleSettlement.tone;
  }

  if (state.battle) {
    return "action";
  }

  if (state.previewPlan?.endsInEncounter) {
    return "skill";
  }

  if (state.diagnostics.connectionStatus === "reconnect_failed") {
    return "hit";
  }

  return "neutral";
}

export function renderEncounterSourceDetail(input: EncounterSourceDetailInput): string {
  if (input.battle && input.lastEncounterStarted) {
    const event = input.lastEncounterStarted;
    const ownedIds = ownedHeroIds(input.world);
    if (event.encounterKind === "hero") {
      return ownedIds.has(event.heroId)
        ? "遭遇来源：我方英雄先手接触敌方英雄，当前房间已切到多人遭遇战结算。"
        : "遭遇来源：敌方英雄先手接触我方，当前房间已切到多人遭遇战结算。";
    }

    return event.initiator === "neutral"
      ? "遭遇来源：中立守军主动拦截，当前房间已切到遭遇战结算链路。"
      : "遭遇来源：我方接触了中立守军，当前房间已切到遭遇战结算链路。";
  }

  if (input.previewPlan?.endsInEncounter) {
    return input.previewPlan.encounterKind === "hero"
      ? "遭遇提示：确认移动后会立刻接敌，并锁定到英雄遭遇战。"
      : "遭遇提示：确认移动后会立刻接敌，并锁定到中立遭遇战。";
  }

  if (input.lastBattleSettlement) {
    return "战后反馈：本场结果已结算并回写到房间地图，可按当前结果继续移动、推进回合或等待对手。";
  }

  if (input.diagnostics.connectionStatus === "reconnecting") {
    return "连接反馈：房间连接中断，正在恢复多人房间与战斗归属；恢复前请以权威状态为准。";
  }

  if (input.diagnostics.connectionStatus === "reconnect_failed") {
    return "连接反馈：旧连接恢复失败，正在通过最近快照回补房间；短暂期间可能只显示缓存状态。";
  }

  if (input.predictionStatus.includes("已回放本地缓存状态")) {
    return `连接反馈：${input.predictionStatus}`;
  }

  return "遭遇提示：当前房间同步稳定，可继续探索、观察对手位置或等待新的多人交互。";
}

export function renderRoomActionHint(input: RoomActionHintInput): string {
  if (input.diagnostics.connectionStatus === "reconnecting") {
    return "下一步：等待重连恢复完成；此时先不要依赖本地预览判断最终房间结果。";
  }

  if (
    input.diagnostics.connectionStatus === "reconnect_failed" ||
    input.predictionStatus.includes("已回放本地缓存状态")
  ) {
    return "下一步：等待权威房间状态回补；恢复完成后再继续地图移动或确认战后结果。";
  }

  if (input.battle) {
    return "下一步：继续完成当前回合内操作，等待本场对抗结算。";
  }

  if (!input.activeHero) {
    return "下一步：等待房间首帧同步完成。";
  }

  if (input.lastBattleSettlement) {
    return input.activeHero.move.remaining > 0
      ? "下一步：当前英雄仍可继续移动、交互，或直接推进到下一天。"
      : "下一步：当前英雄移动力已耗尽，可等待其他玩家推进房间或直接结束当天。";
  }

  return input.activeHero.move.remaining > 0
    ? "下一步：选择地图格继续探索；若接敌，将自动切入对抗。"
    : "下一步：当前英雄今日已无移动力，可推进到下一天。";
}
