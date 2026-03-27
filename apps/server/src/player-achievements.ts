import {
  appendEventLogEntries,
  applyAchievementMetricDelta,
  applyAchievementProgressValue,
  createAchievementProgressEventLogEntry,
  createAchievementUnlockedEventLogEntry,
  createWorldEventLogEntry,
  hasFullyExploredMap,
  getEquipmentDefinition,
  type AchievementMetric,
  type AchievementId,
  type EventLogEntry,
  type PlayerAchievementProgress,
  type WorldEvent,
  type WorldState
} from "../../../packages/shared/src/index";
import type { PlayerAccountSnapshot } from "./persistence";

const RECENT_EVENT_LOG_LIMIT = 12;

function findHero(state: WorldState, heroId?: string): WorldState["heroes"][number] | undefined {
  return heroId ? state.heroes.find((hero) => hero.id === heroId) : undefined;
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
  const eventLogContext = {
    roomId: state.meta.roomId,
    playerId: account.playerId
  };

  for (const event of events) {
    sequence += 1;
    const entry = createWorldEventLogEntry(state, account.playerId, event, timestamp, sequence);
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
      entries.push(createAchievementProgressEventLogEntry(eventLogContext, progressed, timestamp, sequence));
    }
    for (const unlocked of result.unlocked) {
      sequence += 1;
      entries.push(createAchievementUnlockedEventLogEntry(eventLogContext, unlocked, timestamp, sequence));
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
    entries.push(createAchievementProgressEventLogEntry(eventLogContext, progressed, timestamp, sequence));
  }
  for (const unlocked of epicCollectorResult.unlocked) {
    sequence += 1;
    entries.push(createAchievementUnlockedEventLogEntry(eventLogContext, unlocked, timestamp, sequence));
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
    entries.push(createAchievementProgressEventLogEntry(eventLogContext, progressed, timestamp, sequence));
  }
  for (const unlocked of worldExplorerResult.unlocked) {
    sequence += 1;
    entries.push(createAchievementUnlockedEventLogEntry(eventLogContext, unlocked, timestamp, sequence));
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
