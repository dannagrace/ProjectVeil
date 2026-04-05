import type { EventLogEntry } from "./event-log.ts";
import {
  cloneDailyQuestDefinition,
  getDefaultDailyQuestDefinitions,
  type DailyQuestDefinition,
  type DailyQuestId,
  type DailyQuestMetric,
  type DailyQuestReward
} from "./daily-quest-rotation.ts";

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

export function getDailyQuestDefinitions(): DailyQuestDefinition[] {
  return getDefaultDailyQuestDefinitions();
}

export function createEmptyDailyQuestReward(): DailyQuestReward {
  return { gems: 0, gold: 0 };
}

function hasClaimMarker(entry: Pick<EventLogEntry, "id">, questId: DailyQuestId): boolean {
  return entry.id.includes(`daily-quest-claim:`) && entry.id.endsWith(`:${questId}`);
}

function countQuestMetric(events: Pick<EventLogEntry, "id" | "worldEventType" | "description">[], metric: DailyQuestMetric): number {
  switch (metric) {
    case "hero_moves":
      return events.filter((entry) => entry.worldEventType === "hero.moved").length;
    case "battle_wins":
      return events.filter(
        (entry) => entry.worldEventType === "battle.resolved" && entry.description.includes("胜利")
      ).length;
    case "resource_collections":
      return events.filter((entry) => entry.worldEventType === "hero.collected").length;
    default:
      return 0;
  }
}

export function buildDailyQuestBoard(
  events: Pick<EventLogEntry, "id" | "worldEventType" | "description">[],
  options: {
    enabled: boolean;
    cycleKey?: string;
    resetAt?: string;
    definitions?: DailyQuestDefinition[];
  }
): DailyQuestBoard {
  if (!options.enabled) {
    return {
      enabled: false,
      availableClaims: 0,
      pendingRewards: createEmptyDailyQuestReward(),
      quests: []
    };
  }

  const definitions = (options.definitions?.length ? options.definitions : getDefaultDailyQuestDefinitions()).map(cloneDailyQuestDefinition);
  const quests = definitions.map((definition) => {
    const current = Math.min(definition.target, countQuestMetric(events, definition.metric));
    const completed = current >= definition.target;
    const claimed = events.some((entry) => hasClaimMarker(entry, definition.id));
    return {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      target: definition.target,
      current,
      completed,
      claimed,
      reward: { ...definition.reward }
    } satisfies DailyQuestProgress;
  });

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
    ...(options.cycleKey ? { cycleKey: options.cycleKey } : {}),
    ...(options.resetAt ? { resetAt: options.resetAt } : {}),
    availableClaims: quests.filter((quest) => quest.completed && !quest.claimed).length,
    pendingRewards,
    quests
  };
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
