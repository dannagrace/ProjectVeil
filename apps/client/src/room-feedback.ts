import type { BattleState, CocosBattleFeedbackTone, MovementPlan, PlayerWorldView } from "../../../packages/shared/src/index";
import type { SessionUpdate } from "./local-session";

interface BattleSettlementSummaryLike {
  kind?: "pvp" | "pve" | "generic";
  title?: string;
  aftermath: string;
  roomState?: string;
}

interface DiagnosticStateLike {
  connectionStatus: "connecting" | "connected" | "reconnecting" | "reconnect_failed";
  recoverySummary?: string | null;
}

type EncounterStartedEvent = Extract<SessionUpdate["events"][number], { type: "battle.started" }>;
type ActiveHeroLike = Pick<PlayerWorldView["ownHeroes"][number], "move">;

function trimTrailingPunctuation(text: string): string {
  return text.trim().replace(/[。；，、.!?]+$/u, "");
}

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
  predictionStatus?: string;
}

export function resolveRecoveryRoomStateLabel(input: {
  diagnostics: DiagnosticStateLike;
  predictionStatus: string;
}): string | null {
  if (input.diagnostics.connectionStatus === "reconnecting") {
    return "恢复中（等待权威同步）";
  }

  if (input.diagnostics.connectionStatus === "reconnect_failed") {
    return "快照回补中";
  }

  if (input.predictionStatus.includes("已回放本地缓存状态")) {
    return "缓存已回放，等待校正";
  }

  if (input.diagnostics.recoverySummary) {
    return "已恢复并完成校正";
  }

  return null;
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
  const isPvpSettlement = input.lastBattleSettlement != null && input.lastBattleSettlement.kind === "pvp";
  if (input.battle && input.lastEncounterStarted) {
    const event = input.lastEncounterStarted;
    const ownedIds = ownedHeroIds(input.world);
    if (event.encounterKind === "hero") {
      return ownedIds.has(event.heroId)
        ? `遭遇来源：我方英雄先手接触敌方英雄，当前房间已切到 PVP 多人遭遇战结算；对手身份、当前回合与房间归属现在统一挂到战斗会话 ${event.battleId}。`
        : `遭遇来源：敌方英雄先手接触我方，当前房间已切到 PVP 多人遭遇战结算；对手身份、当前回合与房间归属现在统一挂到战斗会话 ${event.battleId}。`;
    }

    return event.initiator === "neutral"
      ? `遭遇来源：中立守军主动拦截，当前房间已切到遭遇战结算链路，战斗会话 ${event.battleId} 已建立。`
      : `遭遇来源：我方接触了中立守军，当前房间已切到遭遇战结算链路，战斗会话 ${event.battleId} 已建立。`;
  }

  if (input.previewPlan?.endsInEncounter) {
    return input.previewPlan.encounterKind === "hero"
      ? "遭遇提示：确认移动后会立刻接敌，并锁定到 PVP 英雄遭遇战；进入后会先展示对手摘要与战斗会话。"
      : "遭遇提示：确认移动后会立刻接敌，并锁定到 PVE 中立遭遇战。";
  }

  if (input.lastBattleSettlement) {
    return "战后反馈：本场结果已结算并回写到房间地图；可结合最近战斗会话、房间态和对手摘要继续移动、推进回合或等待对手。";
  }

  if (input.diagnostics.connectionStatus === "reconnecting") {
    if (input.battle?.defenderHeroId) {
      return `连接反馈：PVP 遭遇 ${input.world.meta.roomId}/${input.battle.id} 连接中断，正在恢复对手归属、当前回合与房间主状态；恢复前请以权威状态为准。`;
    }
    return "连接反馈：房间连接中断，正在恢复多人房间与战斗归属；恢复前请以权威状态为准。";
  }

  if (input.diagnostics.connectionStatus === "reconnect_failed") {
    if (input.battle?.defenderHeroId || isPvpSettlement) {
      return "连接反馈：PVP 遭遇旧连接恢复失败，正在通过最近快照回补当前胜负、回合归属和房间状态；短暂期间可能只显示缓存状态。";
    }
    return "连接反馈：旧连接恢复失败，正在通过最近快照回补房间；短暂期间可能只显示缓存状态。";
  }

  if (input.predictionStatus.includes("已回放本地缓存状态")) {
    return `连接反馈：${input.predictionStatus}`;
  }

  return "遭遇提示：当前房间同步稳定，可继续探索、观察对手位置或等待新的多人交互。";
}

export function renderRoomActionHint(input: RoomActionHintInput): string {
  const isPvpSettlement = input.lastBattleSettlement != null && input.lastBattleSettlement.kind === "pvp";
  if (input.diagnostics.connectionStatus === "reconnecting") {
    if (input.battle?.defenderHeroId) {
      return "下一步：等待 PVP 遭遇恢复完成；此时先不要依赖本地预览判断胜负或当前回合归属。";
    }
    return "下一步：等待重连恢复完成；此时先不要依赖本地预览判断最终房间结果。";
  }

  if (
    input.diagnostics.connectionStatus === "reconnect_failed" ||
    input.predictionStatus.includes("已回放本地缓存状态")
  ) {
    if (input.battle?.defenderHeroId || isPvpSettlement) {
      return "下一步：等待权威房间状态回补；恢复完成后再确认胜负、当前回合与是否还能继续移动。";
    }
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

export function renderRoomResultSummary(input: {
  battle: BattleState | null;
  lastBattleSettlement: { kind?: "pvp" | "pve" | "generic"; roomState: string } | null;
  diagnostics: DiagnosticStateLike;
  predictionStatus: string;
  roomId: string;
}): string {
  const isPvpSettlement = input.lastBattleSettlement != null && input.lastBattleSettlement.kind === "pvp";
  if (input.diagnostics.connectionStatus === "reconnecting") {
    if (input.battle?.defenderHeroId) {
      return `房间结果：PVP 遭遇 ${input.roomId}/${input.battle.id} 正在恢复连接；期间请以恢复后的权威胜负、回合归属和房间阶段为准。`;
    }
    return "房间结果：正在恢复连接与房间主状态，期间请以恢复后的权威结果为准。";
  }

  if (input.diagnostics.connectionStatus === "reconnect_failed") {
    if (input.battle?.defenderHeroId || isPvpSettlement) {
      return input.battle?.defenderHeroId
        ? `房间结果：PVP 遭遇 ${input.roomId}/${input.battle.id} 的旧连接未恢复，正在通过最近快照回补当前胜负、回合归属和房间状态。`
        : "房间结果：PVP 结算旧连接未恢复，正在通过最近快照回补当前胜负与房间状态。";
    }
    return "房间结果：旧连接未恢复，正在通过最近快照回补房间，等待权威状态确认当前可行动信息。";
  }

  if (input.predictionStatus.includes("已回放本地缓存状态")) {
    return `房间结果：${input.predictionStatus}`;
  }

  if (input.diagnostics.recoverySummary && input.lastBattleSettlement) {
    return `房间结果：${trimTrailingPunctuation(input.diagnostics.recoverySummary)}；当前${isPvpSettlement ? " PVP" : ""}结算已同步回写。`;
  }

  if (input.diagnostics.recoverySummary && input.battle) {
    return `房间结果：${trimTrailingPunctuation(input.diagnostics.recoverySummary)}；当前仍由 ${input.roomId}/${input.battle.id} 驱动本场对抗。`;
  }

  if (input.diagnostics.recoverySummary) {
    return `房间结果：${input.diagnostics.recoverySummary}`;
  }

  if (input.lastBattleSettlement) {
    return `房间结果：${input.lastBattleSettlement.roomState}`;
  }

  if (input.battle) {
    return input.battle.defenderHeroId
      ? `房间结果：PVP 遭遇战已接管地图行动，当前由 遭遇会话：${input.roomId}/${input.battle.id} 驱动；待战斗链路关闭后统一回写房间状态。`
      : `房间结果：多人遭遇战已接管地图行动，当前由 遭遇会话：${input.roomId}/${input.battle.id} 驱动；待战斗链路关闭后统一回写房间状态。`;
  }

  return "房间结果：当前处于稳定探索态，等待新的移动、交互或多人遭遇。";
}

export function renderRecoverySummary(input: {
  battle: BattleState | null;
  lastBattleSettlement: BattleSettlementSummaryLike | null;
  diagnostics: DiagnosticStateLike;
  predictionStatus: string;
}): string {
  const isPvpSettlement = input.lastBattleSettlement != null && input.lastBattleSettlement.kind === "pvp";
  if (input.diagnostics.connectionStatus === "reconnecting") {
    if (input.battle?.defenderHeroId) {
      return "恢复状态：正在重新加入 PVP 遭遇并校正对手归属、当前回合与房间状态，结果请以恢复后的权威状态为准。";
    }
    return "恢复状态：正在重新加入多人房间并校正战斗归属，结果请以恢复后的权威状态为准。";
  }

  if (input.diagnostics.connectionStatus === "reconnect_failed") {
    if (input.battle?.defenderHeroId || isPvpSettlement) {
      return "恢复状态：PVP 遭遇旧连接恢复失败，已切换到快照回补链路；当前先展示最近缓存与回补进度。";
    }
    return "恢复状态：旧连接恢复失败，已切换到快照回补链路；当前先展示最近缓存与回补进度。";
  }

  if (input.predictionStatus.includes("已回放本地缓存状态")) {
    return `恢复状态：${input.predictionStatus}`;
  }

  if (input.diagnostics.recoverySummary) {
    return `恢复状态：${input.diagnostics.recoverySummary}`;
  }

  if (input.lastBattleSettlement) {
    return input.battle
      ? "恢复状态：战后房间仍在切换阶段，等待当前战斗链路完全关闭。"
      : isPvpSettlement
        ? "恢复状态：最近一场 PVP 遭遇的结算与地图房间态已经重新对齐。"
        : "恢复状态：最近一场遭遇的结算与地图房间态已经重新对齐。";
  }

  return "恢复状态：当前未触发重连补救，房间同步保持稳定。";
}
