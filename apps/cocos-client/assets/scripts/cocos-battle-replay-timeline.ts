import type { BattleReplayStep, PlayerBattleReplaySummary, BattleReplayTimelineEntry } from "./project-shared/battle-replay.ts";
import { buildBattleReplayTimeline } from "./project-shared/battle-replay.ts";

export interface CocosBattleReplayTimelineEntryView {
  index: number;
  stepLabel: string;
  actorLabel: string;
  actionLabel: string;
  outcomeLabel: string;
  roundLabel: string;
  sourceLabel: string;
  tone: "attacker" | "defender" | "neutral";
}

export interface CocosBattleReplayTimelineView {
  title: string;
  subtitle: string;
  badge: string;
  summary: string;
  entries: CocosBattleReplayTimelineEntryView[];
  emptyMessage: string | null;
}

interface ReplayStepStats {
  player: number;
  automated: number;
  attack: number;
  skill: number;
}

export function buildCocosBattleReplayTimelineView(
  replay: PlayerBattleReplaySummary | null,
  options: { limit?: number } = {}
): CocosBattleReplayTimelineView {
  if (!replay) {
    return {
      title: "战报时间线",
      subtitle: "选择一场最近战斗即可查看逐步结算。",
      badge: "未选择",
      summary: "暂无战报。",
      entries: [],
      emptyMessage: "右侧战报卡片选中后会显示对应的时间线。"
    };
  }

  const stats = summarizeReplaySteps(replay);
  const resultBadge = formatResultBadge(replay);
  const timeline = buildBattleReplayTimeline(replay);
  const limit = Math.max(1, Math.floor(options.limit ?? 6));
  const entries = timeline.slice(0, limit).map((entry) => formatTimelineEntry(entry));
  const emptyMessage =
    entries.length === 0
      ? "这场战斗暂未记录逐步时间线条目，如需完整回放请重试或在 H5 调试壳查看。"
      : null;
  return {
    title: `战报 ${resultBadge} · ${formatBattleKindLabel(replay)} ${formatEncounterLabel(replay)}`,
    subtitle: `${formatShortTimestamp(replay.completedAt)} · ${formatPlayerCampLabel(replay.playerCamp)} · ${timeline.length} 步`,
    badge: resultBadge,
    summary: `玩家 ${stats.player} 步 / 自动 ${stats.automated} 步 · 攻击 ${stats.attack} · 技能 ${stats.skill}`,
    entries,
    emptyMessage
  };
}

function summarizeReplaySteps(replay: PlayerBattleReplaySummary): ReplayStepStats {
  let player = 0;
  let automated = 0;
  let attack = 0;
  let skill = 0;

  for (const step of replay.steps) {
    if (step.source === "automated") {
      automated += 1;
    } else {
      player += 1;
    }

    if (step.action.type === "battle.attack") {
      attack += 1;
    } else if (step.action.type === "battle.skill") {
      skill += 1;
    }
  }

  return { player, automated, attack, skill };
}

function formatTimelineEntry(entry: BattleReplayTimelineEntry): CocosBattleReplayTimelineEntryView {
  const actor = formatTimelineActor(entry);
  const actionLabel = formatBattleReplayAction(entry.step);
  const outcomeLabel = formatBattleReplayOutcome(entry);
  return {
    index: entry.step.index,
    stepLabel: `第 ${entry.step.index} 步`,
    actorLabel: actor.label,
    actionLabel,
    outcomeLabel,
    roundLabel: formatTimelineRound(entry),
    sourceLabel: formatBattleReplaySource(entry.step.source),
    tone: actor.tone
  };
}

function formatTimelineActor(entry: BattleReplayTimelineEntry): { label: string; tone: "attacker" | "defender" | "neutral" } {
  const actorUnitId = resolveActionUnitId(entry.step);
  const actorUnit = actorUnitId ? entry.state.units[actorUnitId] ?? null : null;
  if (!actorUnit) {
    return {
      label: actorUnitId ? `未知阵营 ${actorUnitId}` : "未知行动者",
      tone: "neutral"
    };
  }

  const campLabel = actorUnit.camp === "attacker" ? "攻方" : "守方";
  return {
    label: `${campLabel} ${actorUnit.stackName}`,
    tone: actorUnit.camp
  };
}

function resolveActionUnitId(step: BattleReplayTimelineEntry["step"]): string | null {
  if (step.action.type === "battle.attack") {
    return step.action.attackerId ?? null;
  }

  return step.action.unitId ?? null;
}

function formatBattleReplayAction(step: BattleReplayStep): string {
  if (step.action.type === "battle.attack") {
    return step.action.defenderId ? `攻击 ${step.action.defenderId}` : "攻击";
  }

  if (step.action.type === "battle.skill") {
    const targetSegment = step.action.targetId ? ` -> ${step.action.targetId}` : "";
    return `施放 ${step.action.skillId}${targetSegment}`;
  }

  if (step.action.type === "battle.defend") {
    return "防御";
  }

  return "等待";
}

function formatTimelineRound(entry: BattleReplayTimelineEntry): string {
  return entry.resultingRound !== entry.round
    ? `第 ${entry.round} 回合 → ${entry.resultingRound}`
    : `第 ${entry.round} 回合`;
}

function formatBattleReplayOutcome(entry: BattleReplayTimelineEntry): string {
  const change = entry.changes[0] ?? null;
  if (!change) {
    return entry.outcome === "in_progress" ? "行动完成" : formatOutcomeLabel(entry.outcome);
  }

  const parts = [
    change.hpChange < 0 ? `伤害 ${Math.abs(change.hpChange)}` : "",
    change.hpChange > 0 ? `恢复 ${change.hpChange}` : "",
    change.countChange < 0 ? `减员 ${Math.abs(change.countChange)}` : "",
    change.countChange > 0 ? `增援 ${change.countChange}` : "",
    change.defeated ? "击倒" : "",
    change.defendingChanged ? "防御姿态切换" : "",
    ...change.statusAdded.map((status) => `获得 ${status}`),
    ...change.statusRemoved.map((status) => `失去 ${status}`)
  ].filter(Boolean);

  return `${change.stackName}${parts.length > 0 ? ` · ${parts.join(" · ")}` : ""}`;
}

function formatOutcomeLabel(status: BattleReplayTimelineEntry["outcome"]): string {
  switch (status) {
    case "attacker_victory":
      return "进攻方胜利";
    case "defender_victory":
      return "防守方胜利";
    default:
      return "战斗进行中";
  }
}

function formatBattleReplaySource(source: BattleReplayStep["source"]): string {
  return source === "automated" ? "自动" : "玩家";
}

function formatResultBadge(replay: PlayerBattleReplaySummary): string {
  const didWin =
    (replay.playerCamp === "attacker" && replay.result === "attacker_victory") ||
    (replay.playerCamp === "defender" && replay.result === "defender_victory");
  return didWin ? "胜利" : "失利";
}

function formatPlayerCampLabel(camp: PlayerBattleReplaySummary["playerCamp"]): string {
  return camp === "attacker" ? "攻方" : "守方";
}

function formatBattleKindLabel(replay: PlayerBattleReplaySummary): string {
  return replay.battleKind === "hero" ? "PVP" : "PVE";
}

function formatEncounterLabel(replay: PlayerBattleReplaySummary): string {
  if (replay.battleKind === "hero") {
    return replay.opponentHeroId ? `英雄 ${replay.opponentHeroId}` : "敌方英雄";
  }

  return replay.neutralArmyId ? `守军 ${replay.neutralArmyId}` : "中立守军";
}

function formatShortTimestamp(value: string): string {
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
