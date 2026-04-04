import { randomUUID } from "node:crypto";
import campaignDocument from "../../../configs/campaign.json";
import dailyDungeonsDocument from "../../../configs/daily-dungeons.json";
import type {
  CampaignMission,
  CampaignMissionProgress,
  CampaignMissionState,
  CampaignProgressState,
  DailyDungeonDefinition,
  DailyDungeonFloor,
  DailyDungeonReward,
  DailyDungeonRunRecord,
  DailyDungeonState
} from "../../../packages/shared/src/index";
import { getDailyRewardDateKey } from "./daily-rewards";

interface CampaignConfigDocument {
  missions?: Partial<CampaignMission>[] | null;
}

interface DailyDungeonConfigDocument {
  dungeons?: Array<Partial<DailyDungeonDefinition> & { floors?: Partial<DailyDungeonFloor>[] | null }> | null;
}

function normalizeNonNegativeInteger(value: number | null | undefined, field: string, minimum = 0): number {
  const normalized = Math.floor(value ?? Number.NaN);
  if (!Number.isFinite(normalized) || normalized < minimum) {
    throw new Error(`${field} must be an integer >= ${minimum}`);
  }
  return normalized;
}

function normalizePositiveNumber(value: number | null | undefined, field: string): number {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return normalized;
}

function normalizeReward(rawReward: DailyDungeonReward | undefined, field: string): DailyDungeonReward {
  const gems = normalizeNonNegativeInteger(rawReward?.gems ?? 0, `${field}.gems`);
  const gold = normalizeNonNegativeInteger(rawReward?.resources?.gold ?? 0, `${field}.resources.gold`);
  const wood = normalizeNonNegativeInteger(rawReward?.resources?.wood ?? 0, `${field}.resources.wood`);
  const ore = normalizeNonNegativeInteger(rawReward?.resources?.ore ?? 0, `${field}.resources.ore`);

  return {
    ...(gems > 0 ? { gems } : {}),
    ...(gold > 0 || wood > 0 || ore > 0
      ? {
          resources: {
            ...(gold > 0 ? { gold } : {}),
            ...(wood > 0 ? { wood } : {}),
            ...(ore > 0 ? { ore } : {})
          }
        }
      : {})
  };
}

export function resolveCampaignConfig(
  document: CampaignConfigDocument = campaignDocument as CampaignConfigDocument
): CampaignMission[] {
  const rawMissions = document.missions ?? [];
  if (rawMissions.length === 0) {
    throw new Error("campaign config must define at least one mission");
  }

  const missions = rawMissions.map((rawMission, index) => {
    const id = rawMission.id?.trim();
    const chapterId = rawMission.chapterId?.trim();
    const name = rawMission.name?.trim();
    const description = rawMission.description?.trim();
    const enemyArmyTemplateId = rawMission.enemyArmyTemplateId?.trim();
    if (!id || !chapterId || !name || !description || !enemyArmyTemplateId) {
      throw new Error(`campaign mission[${index}] must define id, chapterId, name, description, and enemyArmyTemplateId`);
    }

    const unlockMissionId = rawMission.unlockMissionId?.trim();
    return {
      id,
      chapterId,
      order: normalizeNonNegativeInteger(rawMission.order, `campaign mission ${id} order`, 1),
      name,
      description,
      recommendedHeroLevel: normalizeNonNegativeInteger(
        rawMission.recommendedHeroLevel,
        `campaign mission ${id} recommendedHeroLevel`,
        1
      ),
      enemyArmyTemplateId,
      enemyArmyCount: normalizeNonNegativeInteger(rawMission.enemyArmyCount, `campaign mission ${id} enemyArmyCount`, 1),
      enemyStatMultiplier: normalizePositiveNumber(
        rawMission.enemyStatMultiplier,
        `campaign mission ${id} enemyStatMultiplier`
      ),
      ...(unlockMissionId ? { unlockMissionId } : {}),
      reward: normalizeReward(rawMission.reward, `campaign mission ${id} reward`)
    } satisfies CampaignMission;
  });

  const ids = new Set<string>();
  for (const mission of missions) {
    if (ids.has(mission.id)) {
      throw new Error(`campaign mission ids must be unique: ${mission.id}`);
    }
    ids.add(mission.id);
  }

  return [...missions].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

export function buildCampaignMissionStates(
  missions: CampaignMission[],
  campaignProgress?: CampaignProgressState | null
): CampaignMissionState[] {
  const progressByMissionId = new Map((campaignProgress?.missions ?? []).map((progress) => [progress.missionId, progress] as const));

  return missions.map((mission) => {
    const progress = progressByMissionId.get(mission.id);
    const completed = Boolean(progress?.completedAt);
    const unlocked = !mission.unlockMissionId || Boolean(progressByMissionId.get(mission.unlockMissionId)?.completedAt);

    return {
      ...mission,
      missionId: mission.id,
      attempts: Math.max(0, progress?.attempts ?? 0),
      ...(progress?.completedAt ? { completedAt: progress.completedAt } : {}),
      status: completed ? "completed" : unlocked ? "available" : "locked"
    };
  });
}

export function completeCampaignMission(
  missions: CampaignMission[],
  campaignProgress: CampaignProgressState | undefined,
  missionId: string,
  completedAt = new Date().toISOString()
): { mission: CampaignMissionState; campaignProgress: CampaignProgressState; reward: CampaignMission["reward"] } {
  const campaignMissionStates = buildCampaignMissionStates(missions, campaignProgress);
  const mission = campaignMissionStates.find((entry) => entry.id === missionId);
  if (!mission) {
    throw new Error("campaign_mission_not_found");
  }
  if (mission.status === "locked") {
    throw new Error("campaign_mission_locked");
  }
  if (mission.status === "completed") {
    throw new Error("campaign_mission_already_completed");
  }

  const progressByMissionId = new Map((campaignProgress?.missions ?? []).map((progress) => [progress.missionId, progress] as const));
  progressByMissionId.set(missionId, {
    missionId,
    attempts: Math.max(0, progressByMissionId.get(missionId)?.attempts ?? 0) + 1,
    completedAt
  });

  return {
    mission: {
      ...mission,
      attempts: Math.max(0, mission.attempts) + 1,
      completedAt,
      status: "completed"
    },
    campaignProgress: {
      missions: Array.from(progressByMissionId.values()).sort((left, right) => left.missionId.localeCompare(right.missionId))
    },
    reward: mission.reward
  };
}

export function resolveDailyDungeonConfig(
  document: DailyDungeonConfigDocument = dailyDungeonsDocument as DailyDungeonConfigDocument
): DailyDungeonDefinition[] {
  const rawDungeons = document.dungeons ?? [];
  if (rawDungeons.length === 0) {
    throw new Error("daily dungeon config must define at least one dungeon");
  }

  return rawDungeons.map((rawDungeon, dungeonIndex) => {
    const id = rawDungeon.id?.trim();
    const name = rawDungeon.name?.trim();
    const description = rawDungeon.description?.trim();
    if (!id || !name || !description) {
      throw new Error(`daily dungeon[${dungeonIndex}] must define id, name, and description`);
    }

    const floors = (rawDungeon.floors ?? []).map((rawFloor, floorIndex) => {
      const enemyArmyTemplateId = rawFloor.enemyArmyTemplateId?.trim();
      if (!enemyArmyTemplateId) {
        throw new Error(`daily dungeon ${id} floor[${floorIndex}] enemyArmyTemplateId is required`);
      }

      return {
        floor: normalizeNonNegativeInteger(rawFloor.floor, `daily dungeon ${id} floor[${floorIndex}] floor`, 1),
        recommendedHeroLevel: normalizeNonNegativeInteger(
          rawFloor.recommendedHeroLevel,
          `daily dungeon ${id} floor[${floorIndex}] recommendedHeroLevel`,
          1
        ),
        enemyArmyTemplateId,
        enemyArmyCount: normalizeNonNegativeInteger(
          rawFloor.enemyArmyCount,
          `daily dungeon ${id} floor[${floorIndex}] enemyArmyCount`,
          1
        ),
        enemyStatMultiplier: normalizePositiveNumber(
          rawFloor.enemyStatMultiplier,
          `daily dungeon ${id} floor[${floorIndex}] enemyStatMultiplier`
        ),
        reward: normalizeReward(rawFloor.reward, `daily dungeon ${id} floor ${rawFloor.floor} reward`)
      } satisfies DailyDungeonFloor;
    });

    if (floors.length === 0) {
      throw new Error(`daily dungeon ${id} must define at least one floor`);
    }

    return {
      id,
      name,
      description,
      attemptLimit: normalizeNonNegativeInteger(rawDungeon.attemptLimit, `daily dungeon ${id} attemptLimit`, 1),
      floors: floors.sort((left, right) => left.floor - right.floor)
    } satisfies DailyDungeonDefinition;
  });
}

export function getCurrentDailyDungeonState(state?: DailyDungeonState | null, now = new Date()): DailyDungeonState {
  const dateKey = getDailyRewardDateKey(now);
  if (!state || state.dateKey !== dateKey) {
    return {
      dateKey,
      attemptsUsed: 0,
      claimedRunIds: [],
      runs: []
    };
  }

  return {
    dateKey,
    attemptsUsed: Math.max(0, Math.floor(state.attemptsUsed ?? 0)),
    claimedRunIds: Array.from(new Set(state.claimedRunIds ?? [])),
    runs: [...(state.runs ?? [])].sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.runId.localeCompare(right.runId))
  };
}

export function startDailyDungeonRun(
  dungeon: DailyDungeonDefinition,
  dailyDungeonState?: DailyDungeonState | null,
  floorNumber?: number,
  now = new Date()
): { dailyDungeonState: DailyDungeonState; run: DailyDungeonRunRecord; floor: DailyDungeonFloor } {
  const currentState = getCurrentDailyDungeonState(dailyDungeonState, now);
  if (currentState.attemptsUsed >= dungeon.attemptLimit) {
    throw new Error("daily_dungeon_attempt_limit_reached");
  }

  const floor = dungeon.floors.find((entry) => entry.floor === Math.max(1, Math.floor(floorNumber ?? 1)));
  if (!floor) {
    throw new Error("daily_dungeon_floor_not_found");
  }

  const run: DailyDungeonRunRecord = {
    runId: randomUUID(),
    dungeonId: dungeon.id,
    floor: floor.floor,
    startedAt: now.toISOString()
  };

  return {
    run,
    floor,
    dailyDungeonState: {
      ...currentState,
      attemptsUsed: currentState.attemptsUsed + 1,
      runs: [run, ...currentState.runs]
    }
  };
}

export function claimDailyDungeonRunReward(
  dungeon: DailyDungeonDefinition,
  dailyDungeonState?: DailyDungeonState | null,
  runId?: string | null,
  now = new Date()
): { dailyDungeonState: DailyDungeonState; run: DailyDungeonRunRecord; floor: DailyDungeonFloor } {
  const currentState = getCurrentDailyDungeonState(dailyDungeonState, now);
  const normalizedRunId = runId?.trim();
  const run = currentState.runs.find((entry) => entry.runId === normalizedRunId);
  if (!run) {
    throw new Error("daily_dungeon_run_not_found");
  }
  if (currentState.claimedRunIds.includes(run.runId) || run.rewardClaimedAt) {
    throw new Error("daily_dungeon_reward_already_claimed");
  }

  const floor = dungeon.floors.find((entry) => entry.floor === run.floor);
  if (!floor) {
    throw new Error("daily_dungeon_floor_not_found");
  }

  const claimedAt = now.toISOString();
  return {
    floor,
    run: {
      ...run,
      rewardClaimedAt: claimedAt
    },
    dailyDungeonState: {
      ...currentState,
      claimedRunIds: [...currentState.claimedRunIds, run.runId].sort((left, right) => left.localeCompare(right)),
      runs: currentState.runs.map((entry) =>
        entry.runId === run.runId
          ? {
              ...entry,
              rewardClaimedAt: claimedAt
            }
          : entry
      )
    }
  };
}

export function buildDailyDungeonSummary(
  dungeon: DailyDungeonDefinition,
  dailyDungeonState?: DailyDungeonState | null,
  now = new Date()
): {
  dungeon: DailyDungeonDefinition;
  dateKey: string;
  attemptsUsed: number;
  attemptsRemaining: number;
  runs: DailyDungeonRunRecord[];
} {
  const currentState = getCurrentDailyDungeonState(dailyDungeonState, now);
  return {
    dungeon,
    dateKey: currentState.dateKey,
    attemptsUsed: currentState.attemptsUsed,
    attemptsRemaining: Math.max(0, dungeon.attemptLimit - currentState.attemptsUsed),
    runs: currentState.runs
  };
}
