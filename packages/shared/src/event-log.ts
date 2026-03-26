import type { WorldEvent } from "./models";

export type EventLogCategory = "movement" | "combat" | "building" | "skill" | "achievement";
export type EventLogRewardType = "resource" | "experience" | "skill_point" | "badge";
export type AchievementId = "first_battle" | "enemy_slayer" | "skill_scholar";
export type AchievementMetric = "battles_started" | "battles_won" | "skills_learned";

export interface EventLogReward {
  type: EventLogRewardType;
  label: string;
  amount?: number;
}

export interface EventLogEntry {
  id: string;
  timestamp: string;
  roomId: string;
  playerId: string;
  category: EventLogCategory;
  description: string;
  heroId?: string;
  worldEventType?: WorldEvent["type"];
  achievementId?: AchievementId;
  rewards: EventLogReward[];
}

export interface AchievementDefinition {
  id: AchievementId;
  metric: AchievementMetric;
  title: string;
  description: string;
  target: number;
}

export interface PlayerAchievementProgress {
  id: AchievementId;
  title: string;
  description: string;
  metric: AchievementMetric;
  current: number;
  target: number;
  unlocked: boolean;
  unlockedAt?: string;
}

const ACHIEVEMENT_DEFINITIONS: AchievementDefinition[] = [
  {
    id: "first_battle",
    metric: "battles_started",
    title: "初次交锋",
    description: "首次进入战斗。",
    target: 1
  },
  {
    id: "enemy_slayer",
    metric: "battles_won",
    title: "猎敌者",
    description: "击败 3 名敌人或中立守军。",
    target: 3
  },
  {
    id: "skill_scholar",
    metric: "skills_learned",
    title: "求知者",
    description: "学习 5 个长期技能。",
    target: 5
  }
];

const achievementDefinitionById = new Map(ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition] as const));

function normalizeTimestamp(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export function getAchievementDefinitions(): AchievementDefinition[] {
  return ACHIEVEMENT_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function normalizeAchievementProgress(
  progress?: Partial<PlayerAchievementProgress>[] | null
): PlayerAchievementProgress[] {
  const progressById = new Map(
    (progress ?? [])
      .map((entry) => {
        const definition = entry?.id ? achievementDefinitionById.get(entry.id) : undefined;
        if (!definition) {
          return null;
        }

        const current = Math.max(0, Math.floor(entry.current ?? 0));
        const unlockedAt = normalizeTimestamp(entry.unlockedAt);
        return [
          definition.id,
          {
            id: definition.id,
            title: definition.title,
            description: definition.description,
            metric: definition.metric,
            current,
            target: definition.target,
            unlocked: current >= definition.target || Boolean(unlockedAt),
            ...(unlockedAt ? { unlockedAt } : {})
          }
        ] as const;
      })
      .filter((entry): entry is readonly [AchievementId, PlayerAchievementProgress] => Boolean(entry))
  );

  return ACHIEVEMENT_DEFINITIONS.map((definition) => {
    const existing = progressById.get(definition.id);
    return existing ?? {
      id: definition.id,
      title: definition.title,
      description: definition.description,
      metric: definition.metric,
      current: 0,
      target: definition.target,
      unlocked: false
    };
  });
}

export function applyAchievementMetricDelta(
  progress: Partial<PlayerAchievementProgress>[] | null | undefined,
  metric: AchievementMetric,
  amount: number,
  unlockedAt = new Date().toISOString()
): {
  progress: PlayerAchievementProgress[];
  unlocked: PlayerAchievementProgress[];
} {
  const safeAmount = Math.max(0, Math.floor(amount));
  const normalized = normalizeAchievementProgress(progress);
  if (safeAmount <= 0) {
    return {
      progress: normalized,
      unlocked: []
    };
  }

  const unlocked: PlayerAchievementProgress[] = [];
  const nextProgress = normalized.map((entry) => {
    if (entry.metric !== metric) {
      return entry;
    }

    const previousUnlocked = entry.unlocked;
    const current = Math.min(entry.target, entry.current + safeAmount);
    const nextEntry: PlayerAchievementProgress = {
      ...entry,
      current,
      unlocked: current >= entry.target,
      ...(current >= entry.target ? { unlockedAt: entry.unlockedAt ?? unlockedAt } : entry.unlockedAt ? { unlockedAt: entry.unlockedAt } : {})
    };

    if (!previousUnlocked && nextEntry.unlocked) {
      unlocked.push(nextEntry);
    }

    return nextEntry;
  });

  return {
    progress: nextProgress,
    unlocked
  };
}

export function normalizeEventLogEntries(entries?: Partial<EventLogEntry>[] | null): EventLogEntry[] {
  return (entries ?? [])
    .map((entry, index) => {
      const id = entry.id?.trim();
      const timestamp = normalizeTimestamp(entry.timestamp);
      const roomId = entry.roomId?.trim();
      const playerId = entry.playerId?.trim();
      const description = entry.description?.trim();
      const category = entry.category;
      if (!id || !timestamp || !roomId || !playerId || !description || !category) {
        return null;
      }

      return {
        id,
        timestamp,
        roomId,
        playerId,
        category,
        description,
        ...(entry.heroId?.trim() ? { heroId: entry.heroId.trim() } : {}),
        ...(entry.worldEventType ? { worldEventType: entry.worldEventType } : {}),
        ...(entry.achievementId ? { achievementId: entry.achievementId } : {}),
        rewards: (entry.rewards ?? [])
          .map((reward) => {
            if (!reward?.type || !reward.label?.trim()) {
              return null;
            }

            return {
              type: reward.type,
              label: reward.label.trim(),
              ...(reward.amount != null ? { amount: Math.max(0, Math.floor(reward.amount)) } : {})
            };
          })
          .filter((reward): reward is EventLogReward => Boolean(reward))
      };
    })
    .filter((entry): entry is EventLogEntry => Boolean(entry))
    .sort((left, right) => right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id))
    .filter((entry, index, list) => index === list.findIndex((candidate) => candidate.id === entry.id));
}

export function appendEventLogEntries(
  existing: Partial<EventLogEntry>[] | null | undefined,
  incoming: Partial<EventLogEntry>[] | null | undefined,
  limit = 12
): EventLogEntry[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  const normalizedIncoming = normalizeEventLogEntries(incoming);
  if (normalizedIncoming.length === 0) {
    return normalizeEventLogEntries(existing).slice(0, safeLimit);
  }

  return normalizeEventLogEntries([...normalizedIncoming, ...normalizeEventLogEntries(existing)]).slice(0, safeLimit);
}
