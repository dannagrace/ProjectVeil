import dailyRewardsDocument from "../../../../../configs/daily-rewards.json";
import { getMinorProtectionDateKey } from "@server/domain/ops/minor-protection";

const DAILY_REWARD_TIME_ZONE = "Asia/Shanghai";

export interface DailyRewardTier {
  day: number;
  gems: number;
  gold: number;
}

interface DailyRewardsConfigDocument {
  rewards?: Partial<DailyRewardTier>[] | null;
}

export interface DailyRewardGrant {
  gems: number;
  gold: number;
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  const normalized = Math.floor(value);
  if (!Number.isFinite(value) || normalized < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }

  return normalized;
}

export function normalizeDailyRewardConfig(rawConfig?: Partial<DailyRewardsConfigDocument> | null): DailyRewardTier[] {
  const rewards = rawConfig?.rewards ?? [];
  if (rewards.length === 0) {
    throw new Error("daily rewards config must define at least one reward");
  }

  return rewards.map((reward, index) => {
    const day = Math.max(1, Math.floor(reward.day ?? index + 1));
    return {
      day,
      gems: normalizeNonNegativeInteger(reward.gems ?? 0, `rewards[${index}].gems`),
      gold: normalizeNonNegativeInteger(reward.gold ?? 0, `rewards[${index}].gold`)
    };
  });
}

export function resolveDailyRewardConfig(): DailyRewardTier[] {
  return normalizeDailyRewardConfig(dailyRewardsDocument as DailyRewardsConfigDocument);
}

export function getDailyRewardDateKey(date = new Date()): string {
  return getMinorProtectionDateKey(date, DAILY_REWARD_TIME_ZONE);
}

export function getPreviousDailyRewardDateKey(dateKey: string): string {
  const parsed = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("dateKey must be a valid YYYY-MM-DD date");
  }
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

export function resolveDailyRewardForStreak(
  streak: number,
  rewardConfig: DailyRewardTier[] = resolveDailyRewardConfig()
): DailyRewardGrant {
  const safeStreak = Math.max(1, Math.floor(streak));
  const reward = rewardConfig[(safeStreak - 1) % rewardConfig.length];
  if (!reward) {
    throw new Error("daily rewards config must define at least one reward");
  }

  return {
    gems: reward.gems,
    gold: reward.gold
  };
}
