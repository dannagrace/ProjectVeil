import { appendEventLogEntries } from "@veil/shared/event-log";
import { emitAnalyticsEvent } from "./analytics";
import { resolveBattlePassConfig } from "./battle-pass";
import { getDailyRewardDateKey, getPreviousDailyRewardDateKey, resolveDailyRewardForStreak } from "./daily-rewards";
import type { PlayerAccountSnapshot, RoomSnapshotStore } from "./persistence";

export interface DailyLoginRewardGrant {
  gems: number;
  gold: number;
}

export interface DailyLoginRewardResult {
  claimed: boolean;
  account: PlayerAccountSnapshot;
  dateKey: string;
  reason?: "already_claimed_today";
  streak?: number;
  reward?: DailyLoginRewardGrant;
}

function createDailyRewardEventLogEntry(
  playerId: string,
  streak: number,
  reward: DailyLoginRewardGrant,
  timestamp = new Date().toISOString()
) {
  const rewardSummary = [
    reward.gems > 0 ? `宝石 x${reward.gems}` : null,
    reward.gold > 0 ? `金币 x${reward.gold}` : null
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("、");

  return {
    id: `${playerId}:${timestamp}:daily-login:${streak}`,
    timestamp,
    roomId: "daily-login",
    playerId,
    category: "account" as const,
    description: `每日签到奖励：连签第 ${streak} 天，获得 ${rewardSummary || "奖励已发放"}。`,
    rewards: [
      ...(reward.gems > 0 ? [{ type: "resource" as const, label: "gems", amount: reward.gems }] : []),
      ...(reward.gold > 0 ? [{ type: "resource" as const, label: "gold", amount: reward.gold }] : [])
    ]
  };
}

export async function issueDailyLoginReward(
  store: RoomSnapshotStore,
  account: PlayerAccountSnapshot,
  options: {
    now?: Date;
  } = {}
): Promise<DailyLoginRewardResult> {
  const now = options.now ?? new Date();
  const dateKey = getDailyRewardDateKey(now);

  if (account.lastPlayDate === dateKey) {
    return {
      claimed: false,
      account,
      dateKey,
      reason: "already_claimed_today"
    };
  }

  const streak =
    account.lastPlayDate === getPreviousDailyRewardDateKey(dateKey) ? Math.max(0, account.loginStreak ?? 0) + 1 : 1;
  const reward = resolveDailyRewardForStreak(streak);
  const eventEntry = createDailyRewardEventLogEntry(account.playerId, streak, reward, now.toISOString());
  const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
    gems: (account.gems ?? 0) + reward.gems,
    seasonXpDelta: resolveBattlePassConfig().seasonXpDailyLoginBonus,
    globalResources: {
      ...account.globalResources,
      gold: (account.globalResources.gold ?? 0) + reward.gold
    },
    recentEventLog: appendEventLogEntries(account.recentEventLog, [eventEntry]),
    lastPlayDate: dateKey,
    dailyPlayMinutes: 0,
    loginStreak: streak
  });

  emitAnalyticsEvent("daily_login", {
    playerId: account.playerId,
    roomId: "daily-login",
    payload: {
      dateKey,
      streak,
      reward
    }
  });

  return {
    claimed: true,
    account: nextAccount,
    dateKey,
    streak,
    reward
  };
}
