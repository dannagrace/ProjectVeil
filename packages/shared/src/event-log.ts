import { formatEquipmentRarityLabel } from "./equipment.ts";
import type { FogState, ResourceKind, WorldEvent, WorldState } from "./models.ts";

export type EventLogCategory = "movement" | "combat" | "building" | "skill" | "achievement" | "account";
export type EventLogRewardType = "resource" | "experience" | "skill_point" | "badge";
export type AchievementId = "first_battle" | "enemy_slayer" | "skill_scholar" | "world_explorer" | "epic_collector";
export type AchievementMetric =
  | "battles_started"
  | "battles_won"
  | "skills_learned"
  | "maps_fully_explored"
  | "epic_equipment_slots";

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

export interface EventLogQuery {
  limit?: number | undefined;
  offset?: number | undefined;
  category?: EventLogCategory | undefined;
  heroId?: string | undefined;
  achievementId?: AchievementId | undefined;
  worldEventType?: WorldEvent["type"] | undefined;
  since?: string | undefined;
  until?: string | undefined;
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
  progressUpdatedAt?: string;
  unlockedAt?: string;
}

export interface AchievementProgressQuery {
  limit?: number | undefined;
  achievementId?: AchievementId | undefined;
  metric?: AchievementMetric | undefined;
  unlocked?: boolean | undefined;
}

export interface NormalizedEventLogQuery {
  limit?: number;
  offset: number;
  category?: EventLogCategory;
  heroId?: string;
  achievementId?: AchievementId;
  worldEventType?: WorldEvent["type"];
  since?: string;
  until?: string;
}

export interface NormalizedAchievementProgressQuery {
  limit?: number;
  achievementId?: AchievementId;
  metric?: AchievementMetric;
  unlocked?: boolean;
}

export interface PlayerProgressionSummary {
  totalAchievements: number;
  unlockedAchievements: number;
  inProgressAchievements: number;
  latestProgressAchievementId?: AchievementId;
  latestProgressAchievementTitle?: string;
  latestProgressAt?: string;
  latestUnlockedAchievementId?: AchievementId;
  latestUnlockedAchievementTitle?: string;
  latestUnlockedAt?: string;
  recentEventCount: number;
  latestEventAt?: string;
}

export interface PlayerProgressionSnapshot {
  summary: PlayerProgressionSummary;
  achievements: PlayerAchievementProgress[];
  recentEventLog: EventLogEntry[];
}

export interface EventLogContext {
  roomId: string;
  playerId: string;
}

export function getLatestUnlockedAchievement(
  progress?: Partial<PlayerAchievementProgress>[] | null
): PlayerAchievementProgress | null {
  const unlocked = normalizeAchievementProgress(progress).filter((entry) => entry.unlocked && entry.unlockedAt);
  if (unlocked.length === 0) {
    return null;
  }

  return (
    unlocked.sort((left, right) => {
      const unlockedAtOrder = String(right.unlockedAt).localeCompare(String(left.unlockedAt));
      return unlockedAtOrder || left.id.localeCompare(right.id);
    })[0] ?? null
  );
}

export function getLatestProgressedAchievement(
  progress?: Partial<PlayerAchievementProgress>[] | null
): PlayerAchievementProgress | null {
  const progressed = normalizeAchievementProgress(progress).filter((entry) => entry.current > 0 && entry.progressUpdatedAt);
  if (progressed.length === 0) {
    return null;
  }

  return (
    progressed.sort((left, right) => {
      const progressOrder = String(right.progressUpdatedAt).localeCompare(String(left.progressUpdatedAt));
      return progressOrder || left.id.localeCompare(right.id);
    })[0] ?? null
  );
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
  },
  {
    id: "world_explorer",
    metric: "maps_fully_explored",
    title: "踏勘全境",
    description: "揭开整张地图的迷雾。",
    target: 1
  },
  {
    id: "epic_collector",
    metric: "epic_equipment_slots",
    title: "史诗武装",
    description: "为同一名英雄装备全套史诗装备。",
    target: 3
  }
];

const achievementDefinitionById = new Map(ACHIEVEMENT_DEFINITIONS.map((definition) => [definition.id, definition] as const));
const worldEventTypeLabels: Partial<Record<WorldEvent["type"], string>> = {
  "hero.moved": "英雄移动",
  "hero.collected": "资源收集",
  "hero.recruited": "部队招募",
  "hero.visited": "建筑造访",
  "hero.claimedMine": "矿点占领",
  "resource.produced": "矿点结算",
  "neutral.moved": "中立移动",
  "hero.progressed": "英雄成长",
  "hero.skillLearned": "技能学习",
  "hero.equipmentChanged": "装备调整",
  "hero.equipmentFound": "战利品获得",
  "battle.started": "战斗触发",
  "battle.resolved": "战斗结算",
  "turn.advanced": "世界推进"
};

function normalizeTimestamp(value?: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function normalizeTimestampFilter(value?: string | null): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }

  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function findHero(state: WorldState, heroId?: string): WorldState["heroes"][number] | undefined {
  return heroId ? state.heroes.find((hero) => hero.id === heroId) : undefined;
}

function createEventLogId(playerId: string, timestamp: string, key: string, sequence: number, suffix?: string): string {
  return `${playerId}:${timestamp}:${key}:${sequence}${suffix ? `:${suffix}` : ""}`;
}

function formatResourceReward(label: ResourceKind, amount: number): EventLogReward {
  return {
    type: "resource",
    label,
    amount: Math.max(0, Math.floor(amount))
  };
}

export function createWorldEventLogEntry(
  state: WorldState,
  playerId: string,
  event: WorldEvent,
  timestamp: string,
  sequence: number
): EventLogEntry | null {
  const hero = "heroId" in event ? findHero(state, event.heroId) : undefined;

  switch (event.type) {
    case "hero.moved":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "movement",
        description: `${hero?.name ?? event.heroId} 移动了 ${event.moveCost} 点行动力。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: []
      };
    case "hero.collected":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "building",
        description: `${hero?.name ?? event.heroId} 收集了 ${event.resource.kind} x${event.resource.amount}。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: [formatResourceReward(event.resource.kind, event.resource.amount)]
      };
    case "hero.recruited":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "building",
        description: `${hero?.name ?? event.heroId} 在 ${event.buildingId} 招募了 ${event.unitTemplateId} x${event.count}。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: []
      };
    case "hero.visited":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "building",
        description: `${hero?.name ?? event.heroId} 造访了 ${event.buildingId}。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: []
      };
    case "hero.claimedMine":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "building",
        description: `${hero?.name ?? event.heroId} 占领了 ${event.buildingId}，每日产出 ${event.resourceKind} +${event.income}。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: [formatResourceReward(event.resourceKind, event.income)]
      };
    case "resource.produced":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "building",
        description: `${event.buildingId} 产出 ${event.resource.kind} x${event.resource.amount}。`,
        worldEventType: event.type,
        rewards: [formatResourceReward(event.resource.kind, event.resource.amount)]
      };
    case "neutral.moved":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "movement",
        description:
          event.reason === "chase" && event.targetHeroId
            ? `${event.neutralArmyId} 追击 ${event.targetHeroId}，从 (${event.from.x},${event.from.y}) 移动到 (${event.to.x},${event.to.y})。`
            : `${event.neutralArmyId} 因 ${event.reason} 从 (${event.from.x},${event.from.y}) 移动到 (${event.to.x},${event.to.y})。`,
        ...(event.targetHeroId ? { heroId: event.targetHeroId } : {}),
        worldEventType: event.type,
        rewards: []
      };
    case "hero.progressed":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "combat",
        description: `${hero?.name ?? event.heroId} 获得 ${event.experienceGained} 经验，升至 ${event.level} 级。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: [
          {
            type: "experience",
            label: "经验",
            amount: event.experienceGained
          },
          {
            type: "skill_point",
            label: "技能点",
            amount: event.skillPointsAwarded
          }
        ]
      };
    case "hero.skillLearned":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "skill",
        description: `${hero?.name ?? event.heroId} 学会了 ${event.skillName}。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: []
      };
    case "hero.equipmentChanged": {
      const slotLabel = event.slot === "weapon" ? "武器" : event.slot === "armor" ? "护甲" : "饰品";
      const description =
        event.equippedItemId && event.unequippedItemId
          ? `${hero?.name ?? event.heroId} 将${slotLabel}从 ${event.unequippedItemId} 更换为 ${event.equippedItemId}。`
          : event.equippedItemId
            ? `${hero?.name ?? event.heroId} 装备了${slotLabel} ${event.equippedItemId}。`
            : `${hero?.name ?? event.heroId} 卸下了${slotLabel} ${event.unequippedItemId ?? "装备"}。`;
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "skill",
        description,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: []
      };
    }
    case "hero.equipmentFound":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "combat",
        description: `${hero?.name ?? event.heroId} 在战斗后获得了${formatEquipmentRarityLabel(event.rarity)}装备 ${event.equipmentName}。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: []
      };
    case "battle.started":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "combat",
        description:
          event.encounterKind === "hero"
            ? `${hero?.name ?? event.heroId} 与敌方英雄交战。`
            : `${hero?.name ?? event.heroId} 遭遇中立守军。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: []
      };
    case "battle.resolved":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "combat",
        description: `${hero?.name ?? event.heroId} 的战斗结果为 ${
          event.result === "attacker_victory" ? "胜利" : "失利"
        }。`,
        heroId: event.heroId,
        worldEventType: event.type,
        rewards: []
      };
    case "turn.advanced":
      return {
        id: createEventLogId(playerId, timestamp, event.type, sequence),
        timestamp,
        roomId: state.meta.roomId,
        playerId,
        category: "movement",
        description: `世界推进到第 ${event.day} 天。`,
        worldEventType: event.type,
        rewards: []
      };
    default:
      return null;
  }
}

export function createAchievementUnlockedEventLogEntry(
  context: EventLogContext,
  achievement: PlayerAchievementProgress,
  timestamp: string,
  sequence: number
): EventLogEntry {
  return {
    id: createEventLogId(context.playerId, timestamp, "achievement", sequence, achievement.id),
    timestamp,
    roomId: context.roomId,
    playerId: context.playerId,
    category: "achievement",
    description: `解锁成就：${achievement.title}`,
    achievementId: achievement.id,
    rewards: [
      {
        type: "badge",
        label: achievement.title
      }
    ]
  };
}

export function createAchievementProgressEventLogEntry(
  context: EventLogContext,
  achievement: PlayerAchievementProgress,
  timestamp: string,
  sequence: number
): EventLogEntry {
  return {
    id: createEventLogId(context.playerId, timestamp, "achievement-progress", sequence, achievement.id),
    timestamp,
    roomId: context.roomId,
    playerId: context.playerId,
    category: "achievement",
    description: `成就进度推进：${achievement.title} (${achievement.current}/${achievement.target})`,
    achievementId: achievement.id,
    rewards: []
  };
}

export function getAchievementDefinitions(): AchievementDefinition[] {
  return ACHIEVEMENT_DEFINITIONS.map((definition) => ({ ...definition }));
}

export function getAchievementDefinition(achievementId?: AchievementId | null): AchievementDefinition | null {
  if (!achievementId) {
    return null;
  }

  const definition = achievementDefinitionById.get(achievementId);
  return definition ? { ...definition } : null;
}

export function formatAchievementLabel(achievementId?: AchievementId | null): string {
  return getAchievementDefinition(achievementId)?.title ?? achievementId ?? "";
}

export function formatWorldEventTypeLabel(worldEventType?: WorldEvent["type"] | null): string {
  return worldEventType ? worldEventTypeLabels[worldEventType] ?? worldEventType : "";
}

export function countRevealedFogTiles(visibility?: FogState[] | null): number {
  return (visibility ?? []).filter((fog) => fog === "explored" || fog === "visible").length;
}

export function hasFullyExploredMap(visibility?: FogState[] | null, tileCount?: number): boolean {
  const safeTileCount = Math.max(0, Math.floor(tileCount ?? visibility?.length ?? 0));
  if (safeTileCount <= 0) {
    return false;
  }

  return countRevealedFogTiles(visibility) >= safeTileCount;
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
        const progressUpdatedAt =
          normalizeTimestamp(entry.progressUpdatedAt) ?? (current > 0 ? normalizeTimestamp(entry.unlockedAt) : undefined);
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
            ...(progressUpdatedAt ? { progressUpdatedAt } : {}),
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
  recordedAt = new Date().toISOString()
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
    if (current === entry.current) {
      return entry;
    }

    const nextEntry: PlayerAchievementProgress = {
      ...entry,
      current,
      ...(current > 0 ? { progressUpdatedAt: recordedAt } : {}),
      unlocked: current >= entry.target,
      ...(current >= entry.target
        ? { unlockedAt: entry.unlockedAt ?? recordedAt }
        : entry.unlockedAt
          ? { unlockedAt: entry.unlockedAt }
          : {})
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

export function applyAchievementProgressValue(
  progress: Partial<PlayerAchievementProgress>[] | null | undefined,
  achievementId: AchievementId,
  current: number,
  recordedAt = new Date().toISOString()
): {
  progress: PlayerAchievementProgress[];
  unlocked: PlayerAchievementProgress[];
} {
  const normalized = normalizeAchievementProgress(progress);
  const safeCurrent = Math.max(0, Math.floor(current));
  const unlocked: PlayerAchievementProgress[] = [];
  const nextProgress = normalized.map((entry) => {
    if (entry.id !== achievementId) {
      return entry;
    }

    const previousUnlocked = entry.unlocked;
    const nextCurrent = previousUnlocked ? entry.current : Math.min(entry.target, safeCurrent);
    if (nextCurrent === entry.current) {
      return entry;
    }

    const nextEntry: PlayerAchievementProgress = {
      ...entry,
      current: nextCurrent,
      ...(nextCurrent > 0 ? { progressUpdatedAt: recordedAt } : {}),
      unlocked: nextCurrent >= entry.target,
      ...(nextCurrent >= entry.target
        ? { unlockedAt: entry.unlockedAt ?? recordedAt }
        : entry.unlockedAt
          ? { unlockedAt: entry.unlockedAt }
          : {})
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

export function queryAchievementProgress(
  progress?: Partial<PlayerAchievementProgress>[] | null,
  query: AchievementProgressQuery = {}
): PlayerAchievementProgress[] {
  const normalizedQuery = normalizeAchievementProgressQuery(query);

  return normalizeAchievementProgress(progress)
    .filter((entry) => (normalizedQuery.achievementId ? entry.id === normalizedQuery.achievementId : true))
    .filter((entry) => (normalizedQuery.metric ? entry.metric === normalizedQuery.metric : true))
    .filter((entry) => (normalizedQuery.unlocked == null ? true : entry.unlocked === normalizedQuery.unlocked))
    .slice(0, normalizedQuery.limit);
}

export function normalizeAchievementProgressQuery(query: AchievementProgressQuery = {}): NormalizedAchievementProgressQuery {
  return {
    ...(query.limit == null ? {} : { limit: Math.max(1, Math.floor(query.limit)) }),
    ...(query.achievementId ? { achievementId: query.achievementId } : {}),
    ...(query.metric ? { metric: query.metric } : {}),
    ...(query.unlocked == null ? {} : { unlocked: query.unlocked })
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

export function queryEventLogEntries(
  entries?: Partial<EventLogEntry>[] | null,
  query: EventLogQuery = {}
): EventLogEntry[] {
  const normalizedQuery = normalizeEventLogQuery(query);

  return normalizeEventLogEntries(entries)
    .filter((entry) => (normalizedQuery.category ? entry.category === normalizedQuery.category : true))
    .filter((entry) => (normalizedQuery.heroId ? entry.heroId === normalizedQuery.heroId : true))
    .filter((entry) => (normalizedQuery.achievementId ? entry.achievementId === normalizedQuery.achievementId : true))
    .filter((entry) => (normalizedQuery.worldEventType ? entry.worldEventType === normalizedQuery.worldEventType : true))
    .filter((entry) => (normalizedQuery.since ? entry.timestamp >= normalizedQuery.since : true))
    .filter((entry) => (normalizedQuery.until ? entry.timestamp <= normalizedQuery.until : true))
    .slice(
      normalizedQuery.offset,
      normalizedQuery.limit == null ? undefined : normalizedQuery.offset + normalizedQuery.limit
    );
}

export function normalizeEventLogQuery(query: EventLogQuery = {}): NormalizedEventLogQuery {
  const since = normalizeTimestampFilter(query.since);
  const until = normalizeTimestampFilter(query.until);

  return {
    ...(query.limit == null ? {} : { limit: Math.max(1, Math.floor(query.limit)) }),
    offset: Math.max(0, Math.floor(query.offset ?? 0)),
    ...(query.category ? { category: query.category } : {}),
    ...(query.heroId?.trim() ? { heroId: query.heroId.trim() } : {}),
    ...(query.achievementId ? { achievementId: query.achievementId } : {}),
    ...(query.worldEventType ? { worldEventType: query.worldEventType } : {}),
    ...(since ? { since } : {}),
    ...(until ? { until } : {})
  };
}

export function buildPlayerProgressionSnapshot(
  achievements?: Partial<PlayerAchievementProgress>[] | null,
  recentEventLog?: Partial<EventLogEntry>[] | null,
  eventLimit = 12
): PlayerProgressionSnapshot {
  const normalizedAchievements = normalizeAchievementProgress(achievements);
  const normalizedRecentEventLog = normalizeEventLogEntries(recentEventLog).slice(0, Math.max(1, Math.floor(eventLimit)));
  const latestProgressed = getLatestProgressedAchievement(normalizedAchievements);
  const latestUnlocked = getLatestUnlockedAchievement(normalizedAchievements);
  const unlockedAchievements = normalizedAchievements.filter((entry) => entry.unlocked).length;

  return {
    summary: {
      totalAchievements: normalizedAchievements.length,
      unlockedAchievements,
      inProgressAchievements: normalizedAchievements.filter((entry) => !entry.unlocked && entry.current > 0).length,
      ...(latestProgressed
        ? {
            latestProgressAchievementId: latestProgressed.id,
            latestProgressAchievementTitle: latestProgressed.title,
            latestProgressAt: latestProgressed.progressUpdatedAt
          }
        : {}),
      ...(latestUnlocked
        ? {
            latestUnlockedAchievementId: latestUnlocked.id,
            latestUnlockedAchievementTitle: latestUnlocked.title,
            latestUnlockedAt: latestUnlocked.unlockedAt
          }
        : {}),
      recentEventCount: normalizedRecentEventLog.length,
      ...(normalizedRecentEventLog[0]?.timestamp ? { latestEventAt: normalizedRecentEventLog[0].timestamp } : {})
    },
    achievements: normalizedAchievements,
    recentEventLog: normalizedRecentEventLog
  };
}

export function normalizePlayerProgressionSnapshot(
  snapshot?: Partial<PlayerProgressionSnapshot> | null
): PlayerProgressionSnapshot {
  return buildPlayerProgressionSnapshot(snapshot?.achievements, snapshot?.recentEventLog, snapshot?.recentEventLog?.length ?? 12);
}
