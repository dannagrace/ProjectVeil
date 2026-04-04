import type { EventLogEntry } from "./event-log.ts";

export type DailyQuestId = string;
export type DailyQuestMetric = "hero_moves" | "battle_wins" | "resource_collections";

export interface DailyQuestReward {
  gems: number;
  gold: number;
}

export interface DailyQuestDefinition {
  id: DailyQuestId;
  title: string;
  description: string;
  metric: DailyQuestMetric;
  target: number;
  reward: DailyQuestReward;
}

export interface DailyQuestProgress {
  id: DailyQuestId;
  title: string;
  description: string;
  target: number;
  current: number;
  completed: boolean;
  claimed: boolean;
  reward: DailyQuestReward;
}

export interface DailyQuestBoard {
  enabled: boolean;
  cycleKey?: string;
  resetAt?: string;
  availableClaims: number;
  pendingRewards: DailyQuestReward;
  quests: DailyQuestProgress[];
}

export function createEmptyDailyQuestReward(): DailyQuestReward {
  return { gems: 0, gold: 0 };
}

export function normalizeDailyQuestBoard(board?: Partial<DailyQuestBoard> | null): DailyQuestBoard | undefined {
  if (board?.enabled !== true) {
    return undefined;
  }

  const quests = (board.quests ?? [])
    .map((quest) => {
      if (!quest?.id || typeof quest.title !== "string" || typeof quest.description !== "string") {
        return null;
      }

      const target = Math.max(1, Math.floor(quest.target ?? 0));
      const current = Math.max(0, Math.min(target, Math.floor(quest.current ?? 0)));
      const completed = current >= target || quest.completed === true;
      return {
        id: String(quest.id),
        title: quest.title,
        description: quest.description,
        target,
        current,
        completed,
        claimed: quest.claimed === true,
        reward: {
          gems: Math.max(0, Math.floor(quest.reward?.gems ?? 0)),
          gold: Math.max(0, Math.floor(quest.reward?.gold ?? 0))
        }
      } satisfies DailyQuestProgress;
    })
    .filter((quest): quest is DailyQuestProgress => Boolean(quest));

  const pendingRewards = quests.reduce(
    (totals, quest) => {
      if (!quest.completed || quest.claimed) {
        return totals;
      }

      totals.gems += quest.reward.gems;
      totals.gold += quest.reward.gold;
      return totals;
    },
    createEmptyDailyQuestReward()
  );

  return {
    enabled: true,
    ...(board.cycleKey ? { cycleKey: String(board.cycleKey) } : {}),
    ...(board.resetAt ? { resetAt: String(board.resetAt) } : {}),
    availableClaims: quests.filter((quest) => quest.completed && !quest.claimed).length,
    pendingRewards,
    quests
  };
}

export function normalizeDailyQuestEvents(
  events: Pick<EventLogEntry, "id" | "worldEventType" | "description">[]
): Pick<EventLogEntry, "id" | "worldEventType" | "description">[] {
  return events;
}
