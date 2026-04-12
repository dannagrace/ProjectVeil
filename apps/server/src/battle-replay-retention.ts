import {
  normalizePlayerBattleReplaySummaries,
  type PlayerBattleReplaySummary
} from "../../../packages/shared/src/index";

export const DEFAULT_BATTLE_REPLAY_TTL_DAYS = 90;
export const DEFAULT_BATTLE_REPLAY_MAX_BYTES = 512 * 1024;
export const DEFAULT_BATTLE_REPLAY_CLEANUP_INTERVAL_MINUTES = 24 * 60;
export const DEFAULT_BATTLE_REPLAY_CLEANUP_BATCH_SIZE = 100;

export interface BattleReplayRetentionPolicy {
  ttlDays: number | null;
  maxBytes: number | null;
  cleanupIntervalMinutes: number | null;
  cleanupBatchSize: number;
}

function readOptionalPositiveNumber(value: string | undefined, fallback: number): number | null {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed <= 0) {
    return null;
  }

  return parsed;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function readBattleReplayRetentionPolicy(env: NodeJS.ProcessEnv = process.env): BattleReplayRetentionPolicy {
  return {
    ttlDays: readOptionalPositiveNumber(env.VEIL_BATTLE_REPLAY_TTL_DAYS, DEFAULT_BATTLE_REPLAY_TTL_DAYS),
    maxBytes: readOptionalPositiveNumber(env.VEIL_BATTLE_REPLAY_MAX_BYTES, DEFAULT_BATTLE_REPLAY_MAX_BYTES),
    cleanupIntervalMinutes: readOptionalPositiveNumber(
      env.VEIL_BATTLE_REPLAY_CLEANUP_INTERVAL_MINUTES,
      DEFAULT_BATTLE_REPLAY_CLEANUP_INTERVAL_MINUTES
    ),
    cleanupBatchSize: readPositiveInteger(
      env.VEIL_BATTLE_REPLAY_CLEANUP_BATCH_SIZE,
      DEFAULT_BATTLE_REPLAY_CLEANUP_BATCH_SIZE
    )
  };
}

export function calculateBattleReplayExpiry(completedAt: string, ttlDays: number | null): string | undefined {
  if (ttlDays == null) {
    return undefined;
  }

  const completedAtMs = new Date(completedAt).getTime();
  if (!Number.isFinite(completedAtMs)) {
    return undefined;
  }

  return new Date(completedAtMs + ttlDays * 24 * 60 * 60 * 1000).toISOString();
}

export function measureBattleReplayPayloadBytes(replay: PlayerBattleReplaySummary): number {
  return Buffer.byteLength(JSON.stringify(replay), "utf8");
}

export function applyBattleReplayRetentionToSummary(
  replay: PlayerBattleReplaySummary,
  policy: BattleReplayRetentionPolicy
): PlayerBattleReplaySummary | null {
  const expiresAt = replay.expiresAt ?? calculateBattleReplayExpiry(replay.completedAt, policy.ttlDays);
  const retainedReplay = expiresAt ? { ...replay, expiresAt } : replay;

  if (policy.maxBytes != null && measureBattleReplayPayloadBytes(retainedReplay) > policy.maxBytes) {
    return null;
  }

  return retainedReplay;
}

export function prunePlayerBattleReplaysForRetention(
  replays: Partial<PlayerBattleReplaySummary>[] | null | undefined,
  policy: BattleReplayRetentionPolicy,
  referenceTime = new Date()
): { replays: PlayerBattleReplaySummary[]; removedCount: number; updatedCount: number } {
  const normalizedReplays = normalizePlayerBattleReplaySummaries(replays);
  const referenceTimeMs = referenceTime.getTime();
  let removedCount = 0;
  let updatedCount = 0;

  const retainedReplays = normalizedReplays.flatMap((replay) => {
    const expiresAt = replay.expiresAt ?? calculateBattleReplayExpiry(replay.completedAt, policy.ttlDays);
    if (expiresAt) {
      const expiresAtMs = new Date(expiresAt).getTime();
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= referenceTimeMs) {
        removedCount += 1;
        return [];
      }
    }

    if (expiresAt && replay.expiresAt !== expiresAt) {
      updatedCount += 1;
      return [{ ...replay, expiresAt }];
    }

    return [replay];
  });

  return {
    replays: retainedReplays,
    removedCount,
    updatedCount
  };
}
