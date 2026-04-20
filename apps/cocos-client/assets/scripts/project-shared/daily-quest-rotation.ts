const DAILY_QUEST_WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type DailyQuestId = string;
export type DailyQuestMetric = "hero_moves" | "battle_wins" | "resource_collections";
export type DailyQuestWeekday = (typeof DAILY_QUEST_WEEKDAYS)[number];

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

export interface DailyQuestSchedule {
  startDate?: string;
  endDate?: string;
  weekdays?: DailyQuestWeekday[];
  requiredFlags?: string[];
}

export interface DailyQuestRotationDefinition {
  id: string;
  label: string;
  schedule?: DailyQuestSchedule;
  quests: DailyQuestDefinition[];
}

export interface DailyQuestRotationConfigDocument {
  schemaVersion: 1;
  rotations: DailyQuestRotationDefinition[];
}

export interface DailyQuestRotationValidationIssue {
  path: string;
  message: string;
}

export interface DailyQuestRotationSelection {
  rotation: DailyQuestRotationDefinition;
  dateKey: string;
}

const DEFAULT_DAILY_QUEST_DEFINITIONS: DailyQuestDefinition[] = [
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

export const DEFAULT_DAILY_QUEST_ROTATION_CONFIG: DailyQuestRotationConfigDocument = {
  schemaVersion: 1,
  rotations: [
    {
      id: "spring-weekday-patrol",
      label: "Spring Weekday Patrol",
      schedule: {
        startDate: "2026-04-01",
        endDate: "2026-04-30",
        weekdays: ["mon", "tue", "wed", "thu", "fri"]
      },
      quests: [
        {
          id: "daily_explore_frontier",
          title: "侦察前线",
          description: "完成 3 次探索移动。",
          metric: "hero_moves",
          target: 3,
          reward: { gems: 3, gold: 40 }
        },
        {
          id: "daily_resource_run",
          title: "补给回收",
          description: "完成 2 次资源收集。",
          metric: "resource_collections",
          target: 2,
          reward: { gems: 2, gold: 35 }
        },
        {
          id: "daily_battle_victory",
          title: "凯旋号角",
          description: "取得 1 场战斗胜利。",
          metric: "battle_wins",
          target: 1,
          reward: { gems: 5, gold: 60 }
        }
      ]
    },
    {
      id: "spring-weekend-surge",
      label: "Spring Weekend Surge",
      schedule: {
        startDate: "2026-04-01",
        endDate: "2026-04-30",
        weekdays: ["sun", "sat"]
      },
      quests: DEFAULT_DAILY_QUEST_DEFINITIONS
    },
    {
      id: "pve-launch-weekday",
      label: "PvE Launch Weekday Rotation",
      schedule: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        weekdays: ["mon", "tue", "wed", "thu", "fri"],
        requiredFlags: ["pve_enabled"]
      },
      quests: [
        {
          id: "daily_explore_frontier",
          title: "远征探路",
          description: "完成 4 次探索移动。",
          metric: "hero_moves",
          target: 4,
          reward: { gems: 4, gold: 55 }
        },
        {
          id: "daily_battle_victory",
          title: "征战回响",
          description: "取得 2 场战斗胜利。",
          metric: "battle_wins",
          target: 2,
          reward: { gems: 8, gold: 85 }
        },
        {
          id: "daily_resource_run",
          title: "前线补给线",
          description: "完成 3 次资源收集。",
          metric: "resource_collections",
          target: 3,
          reward: { gems: 3, gold: 45 }
        }
      ]
    },
    {
      id: "pve-launch-weekend",
      label: "PvE Launch Weekend Rotation",
      schedule: {
        startDate: "2026-05-01",
        endDate: "2026-05-31",
        weekdays: ["sun", "sat"],
        requiredFlags: ["pve_enabled"]
      },
      quests: [
        {
          id: "daily_explore_frontier",
          title: "远征探路",
          description: "完成 4 次探索移动。",
          metric: "hero_moves",
          target: 4,
          reward: { gems: 4, gold: 55 }
        },
        {
          id: "daily_battle_victory",
          title: "征战回响",
          description: "取得 2 场战斗胜利。",
          metric: "battle_wins",
          target: 2,
          reward: { gems: 8, gold: 85 }
        },
        {
          id: "daily_resource_run",
          title: "前线补给线",
          description: "完成 3 次资源收集。",
          metric: "resource_collections",
          target: 3,
          reward: { gems: 3, gold: 45 }
        }
      ]
    }
  ]
};

const VALID_METRICS = new Set<DailyQuestMetric>(["hero_moves", "battle_wins", "resource_collections"]);
const VALID_WEEKDAYS = new Set<DailyQuestWeekday>(DAILY_QUEST_WEEKDAYS);
const MIN_TARGET = 1;
const MAX_TARGET = 50;
const MIN_REWARD = 0;
const MAX_GEMS_REWARD = 25;
const MAX_GOLD_REWARD = 500;
const MAX_CONFLICT_SCAN_DAYS = 400;

function cloneReward(reward: DailyQuestReward): DailyQuestReward {
  return {
    gems: reward.gems,
    gold: reward.gold
  };
}

export function cloneDailyQuestDefinition(definition: DailyQuestDefinition): DailyQuestDefinition {
  return {
    ...definition,
    reward: cloneReward(definition.reward)
  };
}

export function cloneDailyQuestRotation(rotation: DailyQuestRotationDefinition): DailyQuestRotationDefinition {
  return {
    ...rotation,
    ...(rotation.schedule ? { schedule: { ...rotation.schedule, ...(rotation.schedule.weekdays ? { weekdays: [...rotation.schedule.weekdays] } : {}), ...(rotation.schedule.requiredFlags ? { requiredFlags: [...rotation.schedule.requiredFlags] } : {}) } } : {}),
    quests: rotation.quests.map(cloneDailyQuestDefinition)
  };
}

export function getDefaultDailyQuestDefinitions(): DailyQuestDefinition[] {
  return DEFAULT_DAILY_QUEST_DEFINITIONS.map(cloneDailyQuestDefinition);
}

export function normalizeDailyQuestRotationConfigDocument(
  input?: Partial<DailyQuestRotationConfigDocument> | null
): DailyQuestRotationConfigDocument {
  if (!input || !Array.isArray(input.rotations) || input.rotations.length === 0) {
    return {
      schemaVersion: 1,
      rotations: DEFAULT_DAILY_QUEST_ROTATION_CONFIG.rotations.map(cloneDailyQuestRotation)
    };
  }

  return {
    schemaVersion: 1,
    rotations: input.rotations
      .filter((rotation): rotation is DailyQuestRotationDefinition => Boolean(rotation && typeof rotation === "object"))
      .map((rotation, index) => ({
        id: typeof rotation.id === "string" && rotation.id.trim() ? rotation.id.trim() : `rotation-${index + 1}`,
        label: typeof rotation.label === "string" && rotation.label.trim() ? rotation.label.trim() : `Rotation ${index + 1}`,
        ...(rotation.schedule
          ? {
              schedule: {
                ...(typeof rotation.schedule.startDate === "string" && rotation.schedule.startDate.trim()
                  ? { startDate: rotation.schedule.startDate.trim() }
                  : {}),
                ...(typeof rotation.schedule.endDate === "string" && rotation.schedule.endDate.trim()
                  ? { endDate: rotation.schedule.endDate.trim() }
                  : {}),
                ...(Array.isArray(rotation.schedule.weekdays)
                  ? {
                      weekdays: rotation.schedule.weekdays
                        .filter((weekday): weekday is DailyQuestWeekday => typeof weekday === "string")
                        .map((weekday) => weekday.trim().toLowerCase() as DailyQuestWeekday)
                    }
                  : {}),
                ...(Array.isArray(rotation.schedule.requiredFlags)
                  ? {
                      requiredFlags: rotation.schedule.requiredFlags
                        .filter((flag): flag is string => typeof flag === "string")
                        .map((flag) => flag.trim())
                        .filter((flag) => flag.length > 0)
                    }
                  : {})
              }
            }
          : {}),
        quests: Array.isArray(rotation.quests)
          ? rotation.quests
              .filter((quest): quest is DailyQuestDefinition => Boolean(quest && typeof quest === "object"))
              .map((quest) => ({
                id: typeof quest.id === "string" && quest.id.trim() ? quest.id.trim() : "",
                title: typeof quest.title === "string" ? quest.title : "",
                description: typeof quest.description === "string" ? quest.description : "",
                metric: VALID_METRICS.has(quest.metric) ? quest.metric : "hero_moves",
                target: Number.isFinite(quest.target) ? Math.floor(quest.target) : 0,
                reward: {
                  gems: Number.isFinite(quest.reward?.gems) ? Math.floor(quest.reward.gems) : 0,
                  gold: Number.isFinite(quest.reward?.gold) ? Math.floor(quest.reward.gold) : 0
                }
              }))
          : []
      }))
  };
}

function isValidDateKey(value: string | undefined): boolean {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeFlagSet(enabledFlags: Iterable<string>): Set<string> {
  return new Set(Array.from(enabledFlags, (flag) => String(flag).trim()).filter((flag) => flag.length > 0));
}

function scheduleAllowsDate(schedule: DailyQuestSchedule | undefined, dateKey: string, enabledFlags: Set<string>): boolean {
  if (!schedule) {
    return true;
  }

  if (schedule.startDate && dateKey < schedule.startDate) {
    return false;
  }

  if (schedule.endDate && dateKey > schedule.endDate) {
    return false;
  }

  if (schedule.weekdays?.length) {
    const weekday = DAILY_QUEST_WEEKDAYS[new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()];
    if (!weekday || !schedule.weekdays.includes(weekday)) {
      return false;
    }
  }

  if (schedule.requiredFlags?.length) {
    return schedule.requiredFlags.every((flag) => enabledFlags.has(flag));
  }

  return true;
}

export function validateDailyQuestRotationConfigDocument(
  document: DailyQuestRotationConfigDocument
): DailyQuestRotationValidationIssue[] {
  const issues: DailyQuestRotationValidationIssue[] = [];
  const rotationIds = new Set<string>();

  for (const [rotationIndex, rotation] of document.rotations.entries()) {
    const rotationPath = `rotations[${rotationIndex}]`;
    if (!rotation.id.trim()) {
      issues.push({ path: `${rotationPath}.id`, message: "Rotation id is required." });
    } else if (rotationIds.has(rotation.id)) {
      issues.push({ path: `${rotationPath}.id`, message: `Duplicate rotation id "${rotation.id}".` });
    } else {
      rotationIds.add(rotation.id);
    }

    if (!rotation.label.trim()) {
      issues.push({ path: `${rotationPath}.label`, message: "Rotation label is required." });
    }

    if (!rotation.quests.length) {
      issues.push({ path: `${rotationPath}.quests`, message: "Rotation must define at least one quest." });
    }

    if (rotation.schedule?.startDate && !isValidDateKey(rotation.schedule.startDate)) {
      issues.push({ path: `${rotationPath}.schedule.startDate`, message: "startDate must use YYYY-MM-DD." });
    }

    if (rotation.schedule?.endDate && !isValidDateKey(rotation.schedule.endDate)) {
      issues.push({ path: `${rotationPath}.schedule.endDate`, message: "endDate must use YYYY-MM-DD." });
    }

    if (
      rotation.schedule?.startDate &&
      rotation.schedule?.endDate &&
      isValidDateKey(rotation.schedule.startDate) &&
      isValidDateKey(rotation.schedule.endDate) &&
      rotation.schedule.startDate > rotation.schedule.endDate
    ) {
      issues.push({ path: `${rotationPath}.schedule`, message: "startDate cannot be later than endDate." });
    }

    for (const [weekdayIndex, weekday] of rotation.schedule?.weekdays?.entries() ?? []) {
      if (!VALID_WEEKDAYS.has(weekday)) {
        issues.push({
          path: `${rotationPath}.schedule.weekdays[${weekdayIndex}]`,
          message: `Invalid weekday "${weekday}".`
        });
      }
    }

    const questIds = new Set<string>();
    for (const [questIndex, quest] of rotation.quests.entries()) {
      const questPath = `${rotationPath}.quests[${questIndex}]`;
      if (!quest.id.trim()) {
        issues.push({ path: `${questPath}.id`, message: "Quest id is required." });
      } else if (questIds.has(quest.id)) {
        issues.push({ path: `${questPath}.id`, message: `Duplicate quest id "${quest.id}" in rotation "${rotation.id}".` });
      } else {
        questIds.add(quest.id);
      }

      if (!quest.title.trim()) {
        issues.push({ path: `${questPath}.title`, message: "Quest title is required." });
      }
      if (!quest.description.trim()) {
        issues.push({ path: `${questPath}.description`, message: "Quest description is required." });
      }
      if (!VALID_METRICS.has(quest.metric)) {
        issues.push({ path: `${questPath}.metric`, message: `Unsupported metric "${quest.metric}".` });
      }
      if (!Number.isInteger(quest.target) || quest.target < MIN_TARGET || quest.target > MAX_TARGET) {
        issues.push({
          path: `${questPath}.target`,
          message: `Quest target must be an integer between ${MIN_TARGET} and ${MAX_TARGET}.`
        });
      }
      if (!Number.isInteger(quest.reward.gems) || quest.reward.gems < MIN_REWARD || quest.reward.gems > MAX_GEMS_REWARD) {
        issues.push({
          path: `${questPath}.reward.gems`,
          message: `Gem reward must be an integer between ${MIN_REWARD} and ${MAX_GEMS_REWARD}.`
        });
      }
      if (!Number.isInteger(quest.reward.gold) || quest.reward.gold < MIN_REWARD || quest.reward.gold > MAX_GOLD_REWARD) {
        issues.push({
          path: `${questPath}.reward.gold`,
          message: `Gold reward must be an integer between ${MIN_REWARD} and ${MAX_GOLD_REWARD}.`
        });
      }
    }
  }

  for (let leftIndex = 0; leftIndex < document.rotations.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < document.rotations.length; rightIndex += 1) {
      const left = document.rotations[leftIndex]!;
      const right = document.rotations[rightIndex]!;
      const fallbackStart = "2026-01-01";
      const windowStart =
        left.schedule?.startDate && right.schedule?.startDate
          ? (left.schedule.startDate > right.schedule.startDate ? left.schedule.startDate : right.schedule.startDate)
          : left.schedule?.startDate ?? right.schedule?.startDate ?? fallbackStart;
      const inferredEnd = addUtcDays(new Date(`${windowStart}T00:00:00.000Z`), MAX_CONFLICT_SCAN_DAYS).toISOString().slice(0, 10);
      const windowEnd =
        left.schedule?.endDate && right.schedule?.endDate
          ? (left.schedule.endDate < right.schedule.endDate ? left.schedule.endDate : right.schedule.endDate)
          : left.schedule?.endDate ?? right.schedule?.endDate ?? inferredEnd;
      if (windowStart > windowEnd) {
        continue;
      }

      const start = new Date(`${windowStart}T00:00:00.000Z`);
      const end = new Date(`${windowEnd}T00:00:00.000Z`);
      const days = Math.min(
        MAX_CONFLICT_SCAN_DAYS,
        Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86_400_000))
      );
      const enabledFlags = normalizeFlagSet([...(left.schedule?.requiredFlags ?? []), ...(right.schedule?.requiredFlags ?? [])]);

      for (let dayOffset = 0; dayOffset <= days; dayOffset += 1) {
        const dateKey = getDateKey(addUtcDays(start, dayOffset));
        if (scheduleAllowsDate(left.schedule, dateKey, enabledFlags) && scheduleAllowsDate(right.schedule, dateKey, enabledFlags)) {
          issues.push({
            path: `rotations[${rightIndex}].schedule`,
            message: `Rotation "${right.id}" conflicts with "${left.id}" on ${dateKey}.`
          });
          break;
        }
      }
    }
  }

  return issues;
}

export function selectDailyQuestRotationForDate(
  document: DailyQuestRotationConfigDocument,
  now = new Date(),
  enabledFlags: Iterable<string> = []
): DailyQuestRotationDefinition | null {
  const dateKey = getDateKey(now);
  const flags = normalizeFlagSet(enabledFlags);
  return document.rotations.find((rotation) => scheduleAllowsDate(rotation.schedule, dateKey, flags)) ?? null;
}

export function findNextDailyQuestRotation(
  document: DailyQuestRotationConfigDocument,
  now = new Date(),
  enabledFlags: Iterable<string> = [],
  maxDays = MAX_CONFLICT_SCAN_DAYS
): DailyQuestRotationSelection | null {
  const flags = normalizeFlagSet(enabledFlags);
  const activeRotation = selectDailyQuestRotationForDate(document, now, flags);
  const start = addUtcDays(new Date(`${getDateKey(now)}T00:00:00.000Z`), 1);

  for (let dayOffset = 0; dayOffset <= maxDays; dayOffset += 1) {
    const candidateDate = addUtcDays(start, dayOffset);
    const dateKey = getDateKey(candidateDate);
    const rotation = document.rotations.find((entry) => scheduleAllowsDate(entry.schedule, dateKey, flags));
    if (!rotation) {
      continue;
    }
    if (rotation.id === activeRotation?.id) {
      continue;
    }
    return {
      rotation,
      dateKey
    };
  }

  return null;
}

export function summarizeDailyQuestRotation(rotation: DailyQuestRotationDefinition): string {
  const scheduleParts: string[] = [];
  if (rotation.schedule?.startDate || rotation.schedule?.endDate) {
    scheduleParts.push(`${rotation.schedule?.startDate ?? "open"} -> ${rotation.schedule?.endDate ?? "open"}`);
  }
  if (rotation.schedule?.weekdays?.length) {
    scheduleParts.push(rotation.schedule.weekdays.join(", "));
  }
  if (rotation.schedule?.requiredFlags?.length) {
    scheduleParts.push(`flags: ${rotation.schedule.requiredFlags.join(", ")}`);
  }

  const header = scheduleParts.length ? `${rotation.label} (${scheduleParts.join(" | ")})` : rotation.label;
  const lines = rotation.quests.map(
    (quest) =>
      `- ${quest.title} [${quest.id}] target=${quest.target} metric=${quest.metric} reward=${quest.reward.gems} gems/${quest.reward.gold} gold`
  );
  return [header, ...lines].join("\n");
}
