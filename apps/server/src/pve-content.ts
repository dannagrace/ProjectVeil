import { randomUUID } from "node:crypto";
import campaignDocument from "../../../configs/campaign-chapter1.json";
import campaignChapter2Document from "../../../configs/campaign-chapter2.json";
import campaignChapter3Document from "../../../configs/campaign-chapter3.json";
import campaignChapter4Document from "../../../configs/campaign-chapter4.json";
import dailyDungeonsDocument from "../../../configs/daily-dungeons.json";
import type {
  CampaignMission,
  CampaignUnlockRequirement,
  CampaignMissionProgress,
  CampaignMissionState,
  CampaignProgressState,
  DailyDungeonDefinition,
  DailyDungeonFloor,
  DailyDungeonReward,
  DailyDungeonRunRecord,
  DailyDungeonState,
  DialogueLine,
  MissionObjective,
  RankDivisionId
} from "../../../packages/shared/src/index";
import {
  getDefaultBossEncounterTemplateCatalog,
  getRankDivisionIndex,
  resolveCosmeticCatalog,
  validateDailyDungeonConfigDocument
} from "../../../packages/shared/src/index";
import { getDailyRewardDateKey } from "./daily-rewards";

interface CampaignConfigMissionDocument {
  id?: string | null;
  chapterId?: string | null;
  order?: number | null;
  mapId?: string | null;
  name?: string | null;
  description?: string | null;
  recommendedHeroLevel?: number | null;
  enemyArmyTemplateId?: string | null;
  enemyArmyCount?: number | null;
  enemyStatMultiplier?: number | null;
  bossEncounterName?: string | null;
  bossTemplateId?: string | null;
  unlockMissionId?: string | null;
  reward?: (DailyDungeonReward & { cosmeticId?: string | null }) | null;
  introDialogue?: Partial<DialogueLine>[] | null;
  midDialogue?: Partial<DialogueLine>[] | null;
  outroDialogue?: Partial<DialogueLine>[] | null;
  objectives?: Partial<MissionObjective>[] | null;
}

interface CampaignConfigDocument {
  missions?: CampaignConfigMissionDocument[] | null;
}

interface DailyDungeonConfigDocument {
  dungeons?: Array<
    Partial<DailyDungeonDefinition> & {
      activeWindow?: Partial<DailyDungeonDefinition["activeWindow"]> | null;
      floors?: Partial<DailyDungeonFloor>[] | null;
    }
  > | null;
}

export interface CampaignAccessContext {
  highestHeroLevel?: number | null;
  rankDivision?: RankDivisionId | null;
}

const DEFAULT_CAMPAIGN_DOCUMENTS: CampaignConfigDocument[] = [
  campaignDocument as CampaignConfigDocument,
  campaignChapter2Document as CampaignConfigDocument,
  campaignChapter3Document as CampaignConfigDocument,
  campaignChapter4Document as CampaignConfigDocument
];

const BASIC_CAMPAIGN_ENEMY_TEMPLATES = new Set(["wolf_pack", "hero_guard_basic"]);
const CHAPTER_FINAL_MISSION_IDS: Record<string, string> = {
  chapter1: "chapter1-defend-bridge",
  chapter2: "chapter2-break-the-ring",
  chapter3: "chapter3-tempest-crown",
  chapter4: "chapter4-veilfall-throne"
};
const CHAPTER_MINIMUM_RANK: Partial<Record<string, RankDivisionId>> = {
  chapter4: "silver_i"
};

function resolveCampaignDocuments(document: CampaignConfigDocument | CampaignConfigDocument[]): CampaignConfigDocument[] {
  return Array.isArray(document) ? document : [document];
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

function normalizeReward(
  rawReward: (DailyDungeonReward & { cosmeticId?: string | null }) | undefined,
  field: string
): CampaignMission["reward"] {
  const gems = normalizeNonNegativeInteger(rawReward?.gems ?? 0, `${field}.gems`);
  const gold = normalizeNonNegativeInteger(rawReward?.resources?.gold ?? 0, `${field}.resources.gold`);
  const wood = normalizeNonNegativeInteger(rawReward?.resources?.wood ?? 0, `${field}.resources.wood`);
  const ore = normalizeNonNegativeInteger(rawReward?.resources?.ore ?? 0, `${field}.resources.ore`);
  const cosmeticId = rawReward?.cosmeticId?.trim();
  if (cosmeticId && !resolveCosmeticCatalog().some((entry) => entry.id === cosmeticId)) {
    throw new Error(`${field}.cosmeticId references unknown cosmetic ${cosmeticId}`);
  }

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
      : {}),
    ...(cosmeticId ? { cosmeticId } : {})
  };
}

function normalizeDialogueLine(rawLine: Partial<DialogueLine> | null | undefined, field: string): DialogueLine {
  const id = rawLine?.id?.trim();
  const speakerId = rawLine?.speakerId?.trim();
  const speakerName = rawLine?.speakerName?.trim();
  const text = rawLine?.text?.trim();
  const portraitId = rawLine?.portraitId?.trim();

  if (!id || !speakerId || !speakerName || !text) {
    throw new Error(`${field} must define id, speakerId, speakerName, and text`);
  }

  return {
    id,
    speakerId,
    speakerName,
    text,
    ...(portraitId ? { portraitId } : {}),
    ...(rawLine?.mood ? { mood: rawLine.mood } : {})
  };
}

function normalizeMissionObjective(rawObjective: Partial<MissionObjective> | null | undefined, field: string): MissionObjective {
  const candidate = rawObjective ?? {};
  const id = candidate.id?.trim();
  const description = candidate.description?.trim();
  if (!id || !description) {
    throw new Error(`${field} must define id and description`);
  }

  const unlocksObjectiveIds = Array.from(
    new Set(
      (candidate.unlocksObjectiveIds ?? [])
        .map((objectiveId) => objectiveId?.trim())
        .filter((objectiveId): objectiveId is string => Boolean(objectiveId))
    )
  ).sort((left, right) => left.localeCompare(right));

  return {
    id,
    description,
    kind: candidate.kind ?? "defeat",
    ...(candidate.gate ? { gate: candidate.gate } : {}),
    ...(candidate.optional === true ? { optional: true } : {}),
    ...(candidate.targetCount != null
      ? { targetCount: normalizeNonNegativeInteger(candidate.targetCount, `${field}.targetCount`, 1) }
      : {}),
    ...(unlocksObjectiveIds.length > 0 ? { unlocksObjectiveIds } : {})
  };
}

export function resolveCampaignConfig(
  document: CampaignConfigDocument | CampaignConfigDocument[] = DEFAULT_CAMPAIGN_DOCUMENTS
): CampaignMission[] {
  const rawMissions = resolveCampaignDocuments(document).flatMap((entry) => entry.missions ?? []);
  if (rawMissions.length === 0) {
    throw new Error("campaign config must define at least one mission");
  }
  const bossTemplateIds = new Set(getDefaultBossEncounterTemplateCatalog().templates.map((template) => template.id));

  const missions = rawMissions.map((rawMission, index) => {
    const id = rawMission.id?.trim();
    const chapterId = rawMission.chapterId?.trim();
    const mapId = rawMission.mapId?.trim();
    const name = rawMission.name?.trim();
    const description = rawMission.description?.trim();
    const enemyArmyTemplateId = rawMission.enemyArmyTemplateId?.trim();
    const bossEncounterName = rawMission.bossEncounterName?.trim();
    const bossTemplateId = rawMission.bossTemplateId?.trim();
    if (!id || !chapterId || !mapId || !name || !description || !enemyArmyTemplateId) {
      throw new Error(
        `campaign mission[${index}] must define id, chapterId, mapId, name, description, and enemyArmyTemplateId`
      );
    }
    if (bossTemplateId && !bossTemplateIds.has(bossTemplateId)) {
      throw new Error(`campaign mission ${id} bossTemplateId references unknown template ${bossTemplateId}`);
    }

    const unlockMissionId = rawMission.unlockMissionId?.trim();
    const objectives = (rawMission.objectives ?? []).map((objective, objectiveIndex) =>
      normalizeMissionObjective(objective, `campaign mission ${id} objective[${objectiveIndex}]`)
    );
    if (objectives.length === 0) {
      throw new Error(`campaign mission ${id} must define at least one objective`);
    }

    const objectiveIds = new Set<string>();
    for (const objective of objectives) {
      if (objectiveIds.has(objective.id)) {
        throw new Error(`campaign mission ${id} objective ids must be unique: ${objective.id}`);
      }
      objectiveIds.add(objective.id);
    }

    for (const objective of objectives) {
      for (const unlockedObjectiveId of objective.unlocksObjectiveIds ?? []) {
        if (!objectiveIds.has(unlockedObjectiveId)) {
          throw new Error(`campaign mission ${id} objective ${objective.id} unlock references unknown objective ${unlockedObjectiveId}`);
        }
      }
    }

    const introDialogue = (rawMission.introDialogue ?? []).map((line, lineIndex) =>
      normalizeDialogueLine(line, `campaign mission ${id} introDialogue[${lineIndex}]`)
    );
    const midDialogue = (rawMission.midDialogue ?? []).map((line, lineIndex) =>
      normalizeDialogueLine(line, `campaign mission ${id} midDialogue[${lineIndex}]`)
    );
    const outroDialogue = (rawMission.outroDialogue ?? []).map((line, lineIndex) =>
      normalizeDialogueLine(line, `campaign mission ${id} outroDialogue[${lineIndex}]`)
    );
    return {
      id,
      chapterId,
      order: normalizeNonNegativeInteger(rawMission.order, `campaign mission ${id} order`, 1),
      mapId,
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
      ...(bossEncounterName ? { bossEncounterName } : {}),
      ...(bossTemplateId ? { bossTemplateId } : {}),
      ...(unlockMissionId ? { unlockMissionId } : {}),
      ...(introDialogue.length > 0 ? { introDialogue } : {}),
      ...(midDialogue.length > 0 ? { midDialogue } : {}),
      ...(outroDialogue.length > 0 ? { outroDialogue } : {}),
      objectives,
      reward: normalizeReward(rawMission.reward ?? undefined, `campaign mission ${id} reward`)
    } satisfies CampaignMission;
  });

  const ids = new Set<string>();
  for (const mission of missions) {
    if (ids.has(mission.id)) {
      throw new Error(`campaign mission ids must be unique: ${mission.id}`);
    }
    ids.add(mission.id);
  }

  const missionsByChapter = new Map<string, CampaignMission[]>();
  for (const mission of missions) {
    missionsByChapter.set(mission.chapterId, [...(missionsByChapter.get(mission.chapterId) ?? []), mission]);
  }
  for (const chapterId of ["chapter2", "chapter3", "chapter4"]) {
    const chapterMissions = missionsByChapter.get(chapterId) ?? [];
    if (chapterMissions.length < 6 || chapterMissions.length > 8) {
      throw new Error(`${chapterId} must define 6-8 missions`);
    }
    const bossMissions = chapterMissions.filter((mission) => mission.bossEncounterName);
    if (bossMissions.length === 0) {
      throw new Error(`${chapterId} must define a named boss encounter`);
    }
    if (bossMissions.some((mission) => BASIC_CAMPAIGN_ENEMY_TEMPLATES.has(mission.enemyArmyTemplateId))) {
      throw new Error(`${chapterId} boss encounters must use a distinct unit composition`);
    }
    if (!chapterMissions.some((mission) => mission.reward.cosmeticId)) {
      throw new Error(`${chapterId} must define a unique map cosmetic reward`);
    }
  }

  return [...missions].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function getMissionCompleted(
  progressByMissionId: Map<string, CampaignMissionProgress>,
  missionId: string | undefined
): boolean {
  return missionId ? Boolean(progressByMissionId.get(missionId)?.completedAt) : true;
}

function getChapterUnlockRequirements(
  missions: CampaignMission[],
  mission: CampaignMission,
  progressByMissionId: Map<string, CampaignMissionProgress>,
  accessContext?: CampaignAccessContext | null
): CampaignUnlockRequirement[] {
  const requirements: CampaignUnlockRequirement[] = [];
  const missionsById = new Map(missions.map((entry) => [entry.id, entry] as const));

  if (mission.unlockMissionId) {
    requirements.push({
      type: "mission_complete",
      description: `Complete ${missionsById.get(mission.unlockMissionId)?.name ?? mission.unlockMissionId}.`,
      satisfied: getMissionCompleted(progressByMissionId, mission.unlockMissionId),
      missionId: mission.unlockMissionId
    });
  }

  const previousChapterFinalMissionId =
    mission.chapterId === "chapter2"
      ? CHAPTER_FINAL_MISSION_IDS.chapter1
      : mission.chapterId === "chapter3"
        ? CHAPTER_FINAL_MISSION_IDS.chapter2
        : mission.chapterId === "chapter4"
          ? CHAPTER_FINAL_MISSION_IDS.chapter3
          : undefined;
  if (previousChapterFinalMissionId) {
    requirements.push({
      type: "mission_complete",
      description: `Complete ${missionsById.get(previousChapterFinalMissionId)?.name ?? previousChapterFinalMissionId}.`,
      satisfied: getMissionCompleted(progressByMissionId, previousChapterFinalMissionId),
      missionId: previousChapterFinalMissionId,
      chapterId: mission.chapterId
    });
  }

  if (mission.chapterId === "chapter3") {
    requirements.push({
      type: "hero_level",
      description: "Reach hero level 15.",
      satisfied: Math.max(1, Math.floor(accessContext?.highestHeroLevel ?? 1)) >= 15,
      minimumHeroLevel: 15,
      chapterId: mission.chapterId
    });
  }

  const minimumRankDivision = CHAPTER_MINIMUM_RANK[mission.chapterId];
  if (minimumRankDivision) {
    const currentRankDivision = accessContext?.rankDivision ?? "bronze_i";
    requirements.push({
      type: "rank_division",
      description: "Reach Silver rank or higher.",
      satisfied: getRankDivisionIndex(currentRankDivision) >= getRankDivisionIndex(minimumRankDivision),
      minimumRankDivision,
      chapterId: mission.chapterId
    });
  }

  return requirements;
}

export function buildCampaignMissionStates(
  missions: CampaignMission[],
  campaignProgress?: CampaignProgressState | null,
  accessContext?: CampaignAccessContext | null
): CampaignMissionState[] {
  const progressByMissionId = new Map((campaignProgress?.missions ?? []).map((progress) => [progress.missionId, progress] as const));

  return missions.map((mission) => {
    const progress = progressByMissionId.get(mission.id);
    const completed = Boolean(progress?.completedAt);
    const unlockRequirements = getChapterUnlockRequirements(missions, mission, progressByMissionId, accessContext);
    const unlocked = unlockRequirements.every((requirement) => requirement.satisfied === true);

    return {
      ...mission,
      missionId: mission.id,
      attempts: Math.max(0, progress?.attempts ?? 0),
      ...(progress?.completedAt ? { completedAt: progress.completedAt } : {}),
      ...(unlockRequirements.length > 0 ? { unlockRequirements } : {}),
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

  const dungeons = rawDungeons.map((rawDungeon, dungeonIndex) => {
    const id = rawDungeon.id?.trim();
    const name = rawDungeon.name?.trim();
    const description = rawDungeon.description?.trim();
    if (!id || !name || !description) {
      throw new Error(`daily dungeon[${dungeonIndex}] must define id, name, and description`);
    }

    const startDate = rawDungeon.activeWindow?.startDate?.trim();
    const endDate = rawDungeon.activeWindow?.endDate?.trim();
    if (!startDate || !endDate) {
      throw new Error(`daily dungeon ${id} must define activeWindow.startDate and activeWindow.endDate`);
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
      activeWindow: {
        startDate,
        endDate
      },
      floors: floors.sort((left, right) => left.floor - right.floor)
    } satisfies DailyDungeonDefinition;
  });

  const issues = validateDailyDungeonConfigDocument({ dungeons });
  if (issues.length > 0) {
    const [firstIssue] = issues;
    throw new Error(`daily dungeon config invalid at ${firstIssue?.path}: ${firstIssue?.message}`);
  }

  return dungeons.sort(
    (left, right) =>
      left.activeWindow.startDate.localeCompare(right.activeWindow.startDate) || left.id.localeCompare(right.id)
  );
}

export function resolveActiveDailyDungeon(
  now = new Date(),
  document: DailyDungeonConfigDocument = dailyDungeonsDocument as DailyDungeonConfigDocument
): DailyDungeonDefinition {
  const dateKey = getDailyRewardDateKey(now);
  const activeDungeons = resolveDailyDungeonConfig(document).filter(
    (dungeon) => dateKey >= dungeon.activeWindow.startDate && dateKey <= dungeon.activeWindow.endDate
  );
  if (activeDungeons.length === 0) {
    throw new Error(`daily_dungeon_not_active_for_${dateKey}`);
  }
  if (activeDungeons.length > 1) {
    throw new Error(`daily_dungeon_rotation_overlap_for_${dateKey}`);
  }

  const [activeDungeon] = activeDungeons;
  if (!activeDungeon) {
    throw new Error(`daily_dungeon_not_active_for_${dateKey}`);
  }

  return activeDungeon;
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
