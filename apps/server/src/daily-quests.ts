import {
  buildDailyQuestBoard,
  createEmptyDailyQuestReward,
  getDailyQuestDefinitions,
  type DailyQuestBoard,
  type DailyQuestDefinition,
  type DailyQuestId,
  type EventLogEntry
} from "../../../packages/shared/src/index";
import type { PlayerAccountSnapshot, RoomSnapshotStore } from "./persistence";

const DAILY_QUEST_ID_SET = new Set(getDailyQuestDefinitions().map((definition) => definition.id));

export function readDailyQuestFeatureEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const normalized = env.VEIL_DAILY_QUESTS_ENABLED?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function getDailyQuestCycleKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function getDailyQuestResetAt(cycleKey = getDailyQuestCycleKey()): string {
  return `${cycleKey}T23:59:59.999Z`;
}

export function createDailyQuestClaimEventLogEntry(
  playerId: string,
  roomId: string,
  definition: DailyQuestDefinition,
  timestamp: string,
  sequence = 1
): EventLogEntry {
  return {
    id: `${playerId}:${timestamp}:daily-quest-claim:${sequence}:${definition.id}`,
    timestamp,
    roomId,
    playerId,
    category: "account",
    description: `领取每日任务：${definition.title}`,
    rewards: [
      ...(definition.reward.gems > 0 ? [{ type: "resource" as const, label: "gems", amount: definition.reward.gems }] : []),
      ...(definition.reward.gold > 0 ? [{ type: "resource" as const, label: "gold", amount: definition.reward.gold }] : [])
    ]
  };
}

export async function loadDailyQuestBoard(
  store: RoomSnapshotStore,
  account: PlayerAccountSnapshot,
  now = new Date(),
  enabled = readDailyQuestFeatureEnabled()
): Promise<DailyQuestBoard> {
  if (!enabled) {
    return {
      enabled: false,
      availableClaims: 0,
      pendingRewards: createEmptyDailyQuestReward(),
      quests: []
    };
  }

  const cycleKey = getDailyQuestCycleKey(now);
  const history = await store.loadPlayerEventHistory(account.playerId, {
    since: `${cycleKey}T00:00:00.000Z`
  });

  return buildDailyQuestBoard(history.items, {
    enabled: true,
    cycleKey,
    resetAt: getDailyQuestResetAt(cycleKey)
  });
}

export function findDailyQuestDefinition(questId?: string | null): DailyQuestDefinition | null {
  const normalizedQuestId = questId?.trim() as DailyQuestId | undefined;
  if (!normalizedQuestId || !DAILY_QUEST_ID_SET.has(normalizedQuestId)) {
    return null;
  }

  return getDailyQuestDefinitions().find((definition) => definition.id === normalizedQuestId) ?? null;
}
