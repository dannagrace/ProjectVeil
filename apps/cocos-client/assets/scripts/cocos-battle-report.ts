import type { PlayerBattleReplaySummary } from "./project-shared/index.ts";

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
  replays: PlayerBattleReplaySummary[]
): CocosBattleReportSummary {
  const latest = replays[0];
  if (!latest) {
    return {
      title: "战报 暂无记录",
      detail: "完成一次战斗后，这里会同步最近回放摘要"
    };
  }

  const resultLabel = latest.result === "attacker_victory" ? "最近胜利" : "最近失利";
  const campLabel = latest.playerCamp === "attacker" ? "攻方" : "守方";
  const stepSummary = summarizeReplaySteps(latest);

  return {
    title: `战报 ${resultLabel} · ${formatBattleKindLabel(latest)} ${formatEncounterLabel(latest)}`,
    detail: `${formatShortTimestamp(latest.completedAt)} · ${campLabel} · ${latest.steps.length} 步 · 玩${stepSummary.playerSteps}/自${stepSummary.automatedSteps}`
  };
}
