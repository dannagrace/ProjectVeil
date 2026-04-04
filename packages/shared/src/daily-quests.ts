import type { EventLogEntry } from "./event-log.ts";

export type DailyQuestId = "daily_explore_frontier" | "daily_battle_victory" | "daily_resource_run";
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

const DAILY_QUEST_DEFINITIONS: DailyQuestDefinition[] = [
  {
    id: "daily_explore_frontier",
    title: "侦察前线",
    description: "完成 3 次探索移动。",
    metric: "hero_moves",
    target: 3,
    reward: { gems: 3, gold: 40 }
  },
  {
    id: "daily_battle_victory",
    title: "凯旋号角",
    description: "取得 1 场战斗胜利。",
    metric: "battle_wins",
    target: 1,
    reward: { gems: 5, gold: 60 }
  },
  {
    id: "daily_resource_run",
    title: "补给回收",
    description: "完成 2 次资源收集。",
    metric: "resource_collections",
    target: 2,
    reward: { gems: 2, gold: 35 }
  }
];

export function getDailyQuestDefinitions(): DailyQuestDefinition[] {
  return DAILY_QUEST_DEFINITIONS.map((definition) => ({ ...definition, reward: { ...definition.reward } }));
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

  const quests = DAILY_QUEST_DEFINITIONS.map((definition) => {
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

  const definitions = new Map(DAILY_QUEST_DEFINITIONS.map((definition) => [definition.id, definition] as const));
  const quests = (board.quests ?? [])
    .map((quest) => {
      const definition = quest?.id ? definitions.get(quest.id) : undefined;
      if (!definition) {
        return null;
      }

      const current = Math.max(0, Math.min(definition.target, Math.floor(quest.current ?? 0)));
      const completed = current >= definition.target || quest.completed === true;
      return {
        id: definition.id,
        title: definition.title,
        description: definition.description,
        target: definition.target,
        current,
        completed,
        claimed: quest.claimed === true,
        reward: { ...definition.reward }
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
