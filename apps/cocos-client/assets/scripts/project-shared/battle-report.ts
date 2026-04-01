import {
  buildBattleReplayTimeline,
  normalizePlayerBattleReplaySummaries,
  type PlayerBattleReplayQuery,
  type PlayerBattleReplaySummary
} from "./battle-replay.ts";
import { normalizeEventLogEntries, type EventLogEntry, type EventLogReward } from "./event-log.ts";

export type PlayerBattleReportResult = "victory" | "defeat";
export type PlayerBattleReportEvidenceAvailability = "available" | "missing";

export interface PlayerBattleReportEvidence {
  replay: PlayerBattleReportEvidenceAvailability;
  rewards: PlayerBattleReportEvidenceAvailability;
}

export interface PlayerBattleReportSummary {
  id: string;
  replayId: string;
  roomId: string;
  playerId: string;
  battleId: string;
  battleKind: PlayerBattleReplaySummary["battleKind"];
  playerCamp: PlayerBattleReplaySummary["playerCamp"];
  heroId: string;
  opponentHeroId?: string;
  neutralArmyId?: string;
  startedAt: string;
  completedAt: string;
  result: PlayerBattleReportResult;
  turnCount: number;
  actionCount: number;
  rewards: EventLogReward[];
  evidence: PlayerBattleReportEvidence;
}

export interface PlayerBattleReportCenter {
  latestReportId: string | null;
  items: PlayerBattleReportSummary[];
}

function normalizeTimestamp(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function normalizeReward(reward?: Partial<EventLogReward> | null): EventLogReward | null {
  const label = reward?.label?.trim();
  if (!label) {
    return null;
  }

  const type = reward?.type;
  if (type !== "resource" && type !== "experience" && type !== "skill_point" && type !== "badge") {
    return null;
  }

  const amount = reward?.amount == null ? undefined : Math.max(0, Math.floor(reward.amount));
  return {
    type,
    label,
    ...(amount != null ? { amount } : {})
  };
}

function normalizeRewards(rewards?: Partial<EventLogReward>[] | null): EventLogReward[] {
  return (rewards ?? [])
    .map((reward) => normalizeReward(reward))
    .filter((reward): reward is EventLogReward => Boolean(reward));
}

function didPlayerWin(replay: PlayerBattleReplaySummary): boolean {
  return (
    (replay.playerCamp === "attacker" && replay.result === "attacker_victory") ||
    (replay.playerCamp === "defender" && replay.result === "defender_victory")
  );
}

function toTimestampMs(value?: string | null): number | null {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function collectBattleReportEventLogEntries(
  replay: PlayerBattleReplaySummary,
  eventLog?: Partial<EventLogEntry>[] | null
): EventLogEntry[] {
  const entries = normalizeEventLogEntries(eventLog);
  const startedAtMs = toTimestampMs(replay.startedAt);
  const completedAtMs = toTimestampMs(replay.completedAt);
  const fallbackEntries = entries.filter(
    (entry) =>
      entry.category === "combat" &&
      entry.roomId === replay.roomId &&
      entry.playerId === replay.playerId &&
      (!entry.heroId || entry.heroId === replay.heroId)
  );
  const boundedEntries = fallbackEntries.filter((entry) => {
    const timestamp = toTimestampMs(entry.timestamp);
    if (timestamp == null || startedAtMs == null || completedAtMs == null) {
      return true;
    }

    return timestamp >= startedAtMs && timestamp <= completedAtMs + 2 * 60 * 1000;
  });
  const candidates = boundedEntries.length > 0 ? boundedEntries : fallbackEntries;
  return candidates.sort((left, right) => String(right.timestamp).localeCompare(String(left.timestamp)) || left.id.localeCompare(right.id));
}

function deriveTurnCount(replay: PlayerBattleReplaySummary): number {
  if (replay.steps.length === 0) {
    return Math.max(1, Math.floor(replay.initialState.round || 1));
  }

  const timeline = buildBattleReplayTimeline(replay);
  return Math.max(1, timeline.at(-1)?.resultingRound ?? Math.floor(replay.initialState.round || 1));
}

export function buildPlayerBattleReportSummary(
  replay: PlayerBattleReplaySummary,
  eventLog?: Partial<EventLogEntry>[] | null
): PlayerBattleReportSummary {
  const evidenceEntries = collectBattleReportEventLogEntries(replay, eventLog);
  const rewards = normalizeRewards(evidenceEntries.flatMap((entry) => entry.rewards));

  return {
    id: replay.id,
    replayId: replay.id,
    roomId: replay.roomId,
    playerId: replay.playerId,
    battleId: replay.battleId,
    battleKind: replay.battleKind,
    playerCamp: replay.playerCamp,
    heroId: replay.heroId,
    ...(replay.opponentHeroId ? { opponentHeroId: replay.opponentHeroId } : {}),
    ...(replay.neutralArmyId ? { neutralArmyId: replay.neutralArmyId } : {}),
    startedAt: replay.startedAt,
    completedAt: replay.completedAt,
    result: didPlayerWin(replay) ? "victory" : "defeat",
    turnCount: deriveTurnCount(replay),
    actionCount: replay.steps.length,
    rewards,
    evidence: {
      replay: "available",
      rewards: rewards.length > 0 ? "available" : "missing"
    }
  };
}

export function normalizePlayerBattleReportSummaries(
  reports?: Partial<PlayerBattleReportSummary>[] | null
): PlayerBattleReportSummary[] {
  return (reports ?? [])
    .map((report) => {
      const id = report?.id?.trim();
      const replayId = report?.replayId?.trim() ?? id;
      const roomId = report?.roomId?.trim();
      const playerId = report?.playerId?.trim();
      const battleId = report?.battleId?.trim();
      const heroId = report?.heroId?.trim();
      const startedAt = normalizeTimestamp(report?.startedAt);
      const completedAt = normalizeTimestamp(report?.completedAt);
      const result = report?.result;
      if (
        !id ||
        !replayId ||
        !roomId ||
        !playerId ||
        !battleId ||
        !heroId ||
        !startedAt ||
        !completedAt ||
        (report?.battleKind !== "neutral" && report?.battleKind !== "hero") ||
        (report?.playerCamp !== "attacker" && report?.playerCamp !== "defender") ||
        (result !== "victory" && result !== "defeat")
      ) {
        return null;
      }

      const replayAvailability = report?.evidence?.replay === "missing" ? "missing" : "available";
      const rewardAvailability = report?.evidence?.rewards === "available" ? "available" : "missing";

      return {
        id,
        replayId,
        roomId,
        playerId,
        battleId,
        battleKind: report.battleKind,
        playerCamp: report.playerCamp,
        heroId,
        ...(report.opponentHeroId?.trim() ? { opponentHeroId: report.opponentHeroId.trim() } : {}),
        ...(report.neutralArmyId?.trim() ? { neutralArmyId: report.neutralArmyId.trim() } : {}),
        startedAt,
        completedAt,
        result,
        turnCount: Math.max(1, Math.floor(report.turnCount ?? 1)),
        actionCount: Math.max(0, Math.floor(report.actionCount ?? 0)),
        rewards: normalizeRewards(report.rewards),
        evidence: {
          replay: replayAvailability,
          rewards: rewardAvailability
        }
      };
    })
    .filter((report): report is PlayerBattleReportSummary => Boolean(report))
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || left.id.localeCompare(right.id))
    .filter((report, index, list) => index === list.findIndex((candidate) => candidate.id === report.id));
}

export function buildPlayerBattleReportCenter(
  replays?: Partial<PlayerBattleReplaySummary>[] | null,
  eventLog?: Partial<EventLogEntry>[] | null,
  limit?: number
): PlayerBattleReportCenter {
  const normalizedReplays = normalizePlayerBattleReplaySummaries(replays);
  const safeLimit = limit == null ? normalizedReplays.length : Math.max(1, Math.floor(limit));
  const items = normalizedReplays.slice(0, safeLimit).map((replay) => buildPlayerBattleReportSummary(replay, eventLog));

  return {
    latestReportId: items[0]?.id ?? null,
    items
  };
}

export function normalizePlayerBattleReportCenter(
  center?: Partial<PlayerBattleReportCenter> | null,
  fallback?: {
    replays?: Partial<PlayerBattleReplaySummary>[] | null;
    eventLog?: Partial<EventLogEntry>[] | null;
    query?: PlayerBattleReplayQuery;
  }
): PlayerBattleReportCenter {
  const fallbackCenter = buildPlayerBattleReportCenter(
    fallback?.replays,
    fallback?.eventLog,
    fallback?.query?.limit
  );
  const items = normalizePlayerBattleReportSummaries(center?.items ?? fallbackCenter.items);
  const latestReportId = center?.latestReportId?.trim() ?? items[0]?.id ?? fallbackCenter.latestReportId ?? null;

  return {
    latestReportId: latestReportId && items.some((item) => item.id === latestReportId) ? latestReportId : items[0]?.id ?? null,
    items
  };
}

export function findPlayerBattleReportSummary(
  reports?: Partial<PlayerBattleReportSummary>[] | null,
  reportId?: string | null
): PlayerBattleReportSummary | null {
  const normalizedReportId = reportId?.trim();
  if (!normalizedReportId) {
    return null;
  }

  return normalizePlayerBattleReportSummaries(reports).find((report) => report.id === normalizedReportId) ?? null;
}
