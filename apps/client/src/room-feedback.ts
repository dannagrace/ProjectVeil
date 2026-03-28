import type { BattleState, MovementPlan, PlayerWorldView } from "../../../packages/shared/src/index";
import type { SessionUpdate } from "./local-session";

interface BattleSettlementSummaryLike {
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
}

function ownedHeroIds(world: PlayerWorldView): Set<string> {
  return new Set(world.ownHeroes.map((hero) => hero.id));
}

export function renderEncounterSourceDetail(input: EncounterSourceDetailInput): string {
  if (input.battle && input.lastEncounterStarted) {
    const event = input.lastEncounterStarted;
    const ownedIds = ownedHeroIds(input.world);
    if (event.encounterKind === "hero") {
      return ownedIds.has(event.heroId)
        ? "遭遇来源：我方主动接触敌方英雄并进入房间内对抗。"
        : "遭遇来源：敌方英雄先手接触我方并拉入对抗。";
    }

    return event.initiator === "neutral"
      ? "遭遇来源：中立守军主动拦截，房间已切换到战斗结算链路。"
      : "遭遇来源：我方接触了中立守军，房间已切换到战斗结算链路。";
  }

  if (input.previewPlan?.endsInEncounter) {
    return input.previewPlan.encounterKind === "hero"
      ? "遭遇提示：确认移动后会立即切入英雄对抗。"
      : "遭遇提示：确认移动后会立即切入中立战斗。";
  }

  if (input.lastBattleSettlement) {
    return "战后反馈：房间权威状态已回写到地图，可直接继续联调后续房间动作。";
  }

  if (input.diagnostics.connectionStatus === "reconnecting") {
    return "连接反馈：房间连接中断，正在尝试恢复当前多人状态。";
  }

  if (input.diagnostics.connectionStatus === "reconnect_failed") {
    return "连接反馈：旧连接恢复失败，正在通过最近快照恢复房间。";
  }

  if (input.predictionStatus.includes("已回放本地缓存状态")) {
    return `连接反馈：${input.predictionStatus}`;
  }

  return "遭遇提示：当前房间处于稳定同步状态，可继续探索或等待新的多人交互。";
}

export function renderRoomActionHint(input: RoomActionHintInput): string {
  if (input.battle) {
    return "下一步：继续完成当前回合内操作，等待本场对抗结算。";
  }

  if (!input.activeHero) {
    return "下一步：等待房间首帧同步完成。";
  }

  if (input.lastBattleSettlement) {
    return input.activeHero.move.remaining > 0
      ? "下一步：当前英雄仍可继续移动、交互，或直接推进到下一天。"
      : "下一步：当前英雄移动力已耗尽，可推进到下一天或等待其他玩家。";
  }

  return input.activeHero.move.remaining > 0
    ? "下一步：选择地图格继续探索；若接敌，将自动切入对抗。"
    : "下一步：当前英雄今日已无移动力，可推进到下一天。";
}
