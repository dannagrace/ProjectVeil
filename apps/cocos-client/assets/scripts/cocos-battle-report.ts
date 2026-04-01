import { buildPlayerBattleReportCenter, type EventLogEntry, type PlayerBattleReplaySummary } from "./project-shared/index.ts";

export interface CocosBattleReportSummary {
  title: string;
  detail: string;
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

function formatBattleKindLabel(replay: PlayerBattleReplaySummary): string {
  return replay.battleKind === "hero" ? "PVP" : "PVE";
}

function formatEncounterLabel(replay: PlayerBattleReplaySummary): string {
  if (replay.battleKind === "hero") {
    return replay.opponentHeroId ? `英雄 ${replay.opponentHeroId}` : "敌方英雄";
  }

  return replay.neutralArmyId ? `守军 ${replay.neutralArmyId}` : "中立守军";
}

function summarizeReplaySteps(replay: PlayerBattleReplaySummary): {
  playerSteps: number;
  automatedSteps: number;
} {
  let playerSteps = 0;
  let automatedSteps = 0;

  for (const step of replay.steps) {
    if (step.source === "automated") {
      automatedSteps += 1;
    } else {
      playerSteps += 1;
    }
  }

  return {
    playerSteps,
    automatedSteps
  };
}

export function summarizeLatestBattleReplay(
  replays: PlayerBattleReplaySummary[],
  recentEventLog: Partial<EventLogEntry>[] = []
): CocosBattleReportSummary {
  const latestReport = buildPlayerBattleReportCenter(replays, recentEventLog).items[0];
  if (!latestReport) {
    return {
      title: "战报 暂无记录",
      detail: "完成一次战斗后，这里会同步最近战报摘要"
    };
  }

  const latest = replays.find((replay) => replay.id === latestReport.replayId) ?? replays[0] ?? null;
  if (!latest) {
    return {
      title: "战报 暂无记录",
      detail: "完成一次战斗后，这里会同步最近战报摘要"
    };
  }

  const resultLabel = latestReport.result === "victory" ? "最近胜利" : "最近失利";
  const campLabel = latestReport.playerCamp === "attacker" ? "攻方" : "守方";
  const rewardSummary = latestReport.rewards[0]
    ? latestReport.rewards
        .slice(0, 2)
        .map((reward) => (reward.amount != null ? `${reward.label}+${reward.amount}` : reward.label))
        .join(" / ")
    : latestReport.evidence.rewards === "available"
      ? "收益同步中"
      : "无额外奖励";
  const stepSummary = summarizeReplaySteps(latest);

  return {
    title: `战报 ${resultLabel} · ${formatBattleKindLabel(latest)} ${formatEncounterLabel(latest)}`,
    detail: `${formatShortTimestamp(latestReport.completedAt)} · ${campLabel} · ${latestReport.turnCount} 回合/${latestReport.actionCount} 步 · ${rewardSummary} · 玩${stepSummary.playerSteps}/自${stepSummary.automatedSteps}`
  };
}
