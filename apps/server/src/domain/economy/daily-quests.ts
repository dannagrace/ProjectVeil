import type { EventLogEntry } from "@veil/shared/event-log";
import type { FeatureFlags } from "@veil/shared/platform";
import { buildDailyQuestBoard, createEmptyDailyQuestReward, type DailyQuestBoard, type DailyQuestDefinition } from "@veil/shared/progression";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import { loadDailyQuestConfig, type DailyQuestConfigDefinition } from "@server/domain/economy/daily-quest-config";
import { rotateDailyQuests } from "@server/domain/battle/event-engine";
import type { PlayerAccountSnapshot, PlayerQuestState, RoomSnapshotStore } from "@server/persistence";

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
  definition: Pick<DailyQuestDefinition, "id" | "title" | "reward">,
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

function createDisabledBoard(): DailyQuestBoard {
  return {
    enabled: false,
    availableClaims: 0,
    pendingRewards: createEmptyDailyQuestReward(),
    quests: []
  };
}

function updateCompletionTracking(state: PlayerQuestState, board: DailyQuestBoard): PlayerQuestState {
  const completedQuestIds = board.quests.filter((quest) => quest.completed).map((quest) => quest.id);
  const claimedQuestIds = board.quests.filter((quest) => quest.claimed).map((quest) => quest.id);

  return {
    ...state,
    rotations: state.rotations.map((entry) =>
      entry.dateKey === board.cycleKey
        ? {
            ...entry,
            completedQuestIds: Array.from(new Set(completedQuestIds)),
            claimedQuestIds: Array.from(new Set(claimedQuestIds))
          }
        : entry
    ),
    updatedAt: new Date().toISOString()
  };
}

async function resolveDailyQuestDefinitions(
  store: RoomSnapshotStore,
  playerId: string,
  cycleKey: string
): Promise<DailyQuestConfigDefinition[]> {
  const rotation = rotateDailyQuests({
    playerId,
    dateKey: cycleKey,
    questPool: loadDailyQuestConfig().quests,
    questState: (await store.loadPlayerQuestState?.(playerId)) ?? null
  });

  if (rotation.rotated) {
    await store.savePlayerQuestState?.(playerId, rotation.state);
    const tierCounts = rotation.quests.reduce(
      (counts, quest) => {
        counts[quest.tier] += 1;
        return counts;
      },
      { common: 0, rare: 0, epic: 0 }
    );
    emitAnalyticsEvent("QuestRotated", {
      playerId,
      roomId: "daily-quests",
      payload: {
        roomId: "daily-quests",
        dateKey: cycleKey,
        questIds: rotation.quests.map((quest) => quest.id),
        tierCounts
      }
    });
  }

  return rotation.quests;
}

export async function loadDailyQuestBoard(
  store: RoomSnapshotStore,
  account: PlayerAccountSnapshot,
  now = new Date(),
  options:
    | boolean
    | {
        enabled: boolean;
        featureFlags?: Partial<FeatureFlags>;
      } = readDailyQuestFeatureEnabled()
): Promise<DailyQuestBoard> {
  const enabled = typeof options === "boolean" ? options : options.enabled;
  if (!enabled) {
    return createDisabledBoard();
  }

  const cycleKey = getDailyQuestCycleKey(now);
  const history = await store.loadPlayerEventHistory(account.playerId, {
    since: `${cycleKey}T00:00:00.000Z`
  });
  const definitions = await resolveDailyQuestDefinitions(store, account.playerId, cycleKey);
  const board = buildDailyQuestBoard(history.items, {
    enabled: true,
    cycleKey,
    resetAt: getDailyQuestResetAt(cycleKey),
    definitions: definitions as DailyQuestDefinition[]
  });

  const questState = await store.loadPlayerQuestState?.(account.playerId);
  if (questState && board.cycleKey) {
    const nextState = updateCompletionTracking(questState, board);
    const currentEntry = questState.rotations.find((entry) => entry.dateKey === board.cycleKey);
    const nextEntry = nextState.rotations.find((entry) => entry.dateKey === board.cycleKey);
    if (
      JSON.stringify(currentEntry?.completedQuestIds ?? []) !== JSON.stringify(nextEntry?.completedQuestIds ?? []) ||
      JSON.stringify(currentEntry?.claimedQuestIds ?? []) !== JSON.stringify(nextEntry?.claimedQuestIds ?? [])
    ) {
      await store.savePlayerQuestState?.(account.playerId, nextState);
    }
  }

  return board;
}
