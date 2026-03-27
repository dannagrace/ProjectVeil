import {
  appendEventLogEntries,
  applyAchievementMetricDelta,
  applyAchievementProgressValue,
  hasFullyExploredMap,
  formatEquipmentRarityLabel,
  getEquipmentDefinition,
  type AchievementMetric,
  type AchievementId,
  type EventLogEntry,
  type EventLogReward,
  type PlayerAchievementProgress,
  type WorldEvent,
  type WorldState
} from "../../../packages/shared/src/index";
import type { PlayerAccountSnapshot } from "./persistence";

const RECENT_EVENT_LOG_LIMIT = 12;
const EQUIPMENT_SLOT_LABELS: Record<"weapon" | "armor" | "accessory" | "trinket", string> = {
  weapon: "武器",
  armor: "护甲",
  accessory: "饰品",
  trinket: "宝物"
};

function findHero(state: WorldState, heroId?: string): WorldState["heroes"][number] | undefined {
  return heroId ? state.heroes.find((hero) => hero.id === heroId) : undefined;
}

function formatResourceReward(label: string, amount: number): EventLogReward {
  return {
    type: "resource",
    label,
    amount: Math.max(0, Math.floor(amount))
  };
}

function createEventId(playerId: string, timestamp: string, worldEventType: WorldEvent["type"], sequence: number): string {
  return `${playerId}:${timestamp}:${worldEventType}:${sequence}`;
}

function createEventLogEntry(
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
      const slotLabel = EQUIPMENT_SLOT_LABELS[event.slot] ?? event.slot;
      const description =
        event.equippedItemId && event.unequippedItemId
          ? `${hero?.name ?? event.heroId} 将${slotLabel}从 ${event.unequippedItemId} 更换为 ${event.equippedItemId}。`
          : event.equippedItemId
            ? `${hero?.name ?? event.heroId} 装备了${slotLabel} ${event.equippedItemId}。`
            : `${hero?.name ?? event.heroId} 卸下了${slotLabel} ${event.unequippedItemId ?? "装备"}。`;
      return {
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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
        id: createEventId(playerId, timestamp, event.type, sequence),
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

function metricDeltaForEvent(state: WorldState, playerId: string, event: WorldEvent): {
  metric: AchievementMetric;
  amount: number;
} | null {
  switch (event.type) {
    case "battle.started":
      return {
        metric: "battles_started",
        amount: 1
      };
    case "hero.skillLearned":
      return {
        metric: "skills_learned",
        amount: 1
      };
    case "battle.resolved": {
      if (event.result === "attacker_victory" && event.attackerPlayerId === playerId) {
        return {
          metric: "battles_won",
          amount: 1
        };
      }
      if (event.result === "defender_victory" && event.defenderPlayerId === playerId) {
        return {
          metric: "battles_won",
          amount: 1
        };
      }

      const attacker = findHero(state, event.heroId);
      const defender = findHero(state, event.defenderHeroId);
      const winningPlayerId =
        event.result === "attacker_victory" ? attacker?.playerId : defender?.playerId ?? attacker?.playerId;
      return winningPlayerId === playerId
        ? {
            metric: "battles_won",
            amount: 1
          }
        : null;
    }
    default:
      return null;
  }
}

function countBestEpicEquipmentLoadout(state: WorldState, playerId: string): number {
  return state.heroes
    .filter((hero) => hero.playerId === playerId)
    .reduce((best, hero) => {
      const epicSlots = [
        hero.loadout.equipment.weaponId,
        hero.loadout.equipment.armorId,
        hero.loadout.equipment.accessoryId
      ].filter((equipmentId) => {
        const definition = equipmentId ? getEquipmentDefinition(equipmentId) : undefined;
        return definition?.rarity === "epic";
      }).length;

      return Math.max(best, epicSlots);
    }, 0);
}

function countFullyExploredMaps(state: WorldState, playerId: string): number {
  return hasFullyExploredMap(state.visibilityByPlayer[playerId], state.map.tiles.length) ? 1 : 0;
}

function createAchievementUnlockedEntry(
  state: WorldState,
  playerId: string,
  achievement: PlayerAchievementProgress,
  timestamp: string,
  sequence: number
): EventLogEntry {
  return {
    id: `${playerId}:${timestamp}:achievement:${sequence}:${achievement.id}`,
    timestamp,
    roomId: state.meta.roomId,
    playerId,
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

function createAchievementProgressEntry(
  state: WorldState,
  playerId: string,
  achievement: PlayerAchievementProgress,
  timestamp: string,
  sequence: number
): EventLogEntry {
  return {
    id: `${playerId}:${timestamp}:achievement-progress:${sequence}:${achievement.id}`,
    timestamp,
    roomId: state.meta.roomId,
    playerId,
    category: "achievement",
    description: `成就进度推进：${achievement.title} (${achievement.current}/${achievement.target})`,
    achievementId: achievement.id,
    rewards: []
  };
}

function getProgressedAchievements(
  previous: Partial<PlayerAchievementProgress>[] | null | undefined,
  next: PlayerAchievementProgress[],
  unlockedIds: Set<AchievementId>
): PlayerAchievementProgress[] {
  const previousById = new Map((previous ?? []).map((entry) => (entry?.id ? [entry.id, entry] : null)).filter(Boolean) as [
    AchievementId,
    Partial<PlayerAchievementProgress>
  ][]);

  return next.filter((entry) => {
    if (entry.current <= 0 || unlockedIds.has(entry.id)) {
      return false;
    }

    return Math.max(0, Math.floor(previousById.get(entry.id)?.current ?? 0)) !== entry.current;
  });
}

export function applyPlayerEventLogAndAchievements(
  account: PlayerAccountSnapshot,
  state: WorldState,
  events: WorldEvent[],
  timestamp = new Date().toISOString()
): PlayerAccountSnapshot {
  let achievements = account.achievements ?? [];
  const entries: EventLogEntry[] = [];
  let sequence = 0;

  for (const event of events) {
    sequence += 1;
    const entry = createEventLogEntry(state, account.playerId, event, timestamp, sequence);
    if (entry) {
      entries.push(entry);
    }

    const delta = metricDeltaForEvent(state, account.playerId, event);
    if (!delta) {
      continue;
    }

    const previousAchievements = achievements;
    const result = applyAchievementMetricDelta(achievements, delta.metric, delta.amount, timestamp);
    achievements = result.progress;
    const unlockedIds = new Set(result.unlocked.map((achievement) => achievement.id));
    for (const progressed of getProgressedAchievements(previousAchievements, achievements, unlockedIds)) {
      sequence += 1;
      entries.push(createAchievementProgressEntry(state, account.playerId, progressed, timestamp, sequence));
    }
    for (const unlocked of result.unlocked) {
      sequence += 1;
      entries.push(createAchievementUnlockedEntry(state, account.playerId, unlocked, timestamp, sequence));
    }
  }

  const achievementsBeforeEpicCollectorSync = achievements;
  const epicCollectorResult = applyAchievementProgressValue(
    achievements,
    "epic_collector",
    countBestEpicEquipmentLoadout(state, account.playerId),
    timestamp
  );
  achievements = epicCollectorResult.progress;
  for (
    const progressed of getProgressedAchievements(
      achievementsBeforeEpicCollectorSync,
      achievements,
      new Set(epicCollectorResult.unlocked.map((achievement) => achievement.id))
    )
  ) {
    sequence += 1;
    entries.push(createAchievementProgressEntry(state, account.playerId, progressed, timestamp, sequence));
  }
  for (const unlocked of epicCollectorResult.unlocked) {
    sequence += 1;
    entries.push(createAchievementUnlockedEntry(state, account.playerId, unlocked, timestamp, sequence));
  }

  const achievementsBeforeWorldExplorerSync = achievements;
  const worldExplorerResult = applyAchievementProgressValue(
    achievements,
    "world_explorer",
    countFullyExploredMaps(state, account.playerId),
    timestamp
  );
  achievements = worldExplorerResult.progress;
  for (
    const progressed of getProgressedAchievements(
      achievementsBeforeWorldExplorerSync,
      achievements,
      new Set(worldExplorerResult.unlocked.map((achievement) => achievement.id))
    )
  ) {
    sequence += 1;
    entries.push(createAchievementProgressEntry(state, account.playerId, progressed, timestamp, sequence));
  }
  for (const unlocked of worldExplorerResult.unlocked) {
    sequence += 1;
    entries.push(createAchievementUnlockedEntry(state, account.playerId, unlocked, timestamp, sequence));
  }

  if (entries.length === 0 && achievements === (account.achievements ?? [])) {
    return account;
  }

  return {
    ...account,
    achievements,
    recentEventLog: appendEventLogEntries(account.recentEventLog, entries, RECENT_EVENT_LOG_LIMIT)
  };
}
