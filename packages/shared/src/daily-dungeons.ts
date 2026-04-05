import type {
  DailyDungeonActiveWindow,
  DailyDungeonDefinition,
  DailyDungeonFloor
} from "./models.ts";

export interface DailyDungeonConfigDocument {
  dungeons: DailyDungeonDefinition[];
}

export interface DailyDungeonValidationIssue {
  path: string;
  message: string;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEVEN_DAY_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;

function isValidDateKey(value: string): boolean {
  return DATE_KEY_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function toUtcMidnight(dateKey: string): number {
  return Date.parse(`${dateKey}T00:00:00.000Z`);
}

function validateRewardPresence(path: string, floor: DailyDungeonFloor, issues: DailyDungeonValidationIssue[]): void {
  const reward = floor.reward ?? {};
  const gemCount = reward.gems ?? 0;
  const hasGems = Number.isInteger(gemCount) && gemCount > 0;
  const resources = reward.resources ?? {};
  const hasResources = ["gold", "wood", "ore"].some((key) => {
    const amount = resources[key as keyof typeof resources] ?? 0;
    return Number.isInteger(amount) && amount > 0;
  });
  if (!hasGems && !hasResources) {
    issues.push({ path: `${path}.reward`, message: "Floor reward must grant at least one positive gem or resource payout." });
  }
}

function validateWindow(path: string, window: DailyDungeonActiveWindow, issues: DailyDungeonValidationIssue[]): void {
  if (!isValidDateKey(window.startDate)) {
    issues.push({ path: `${path}.startDate`, message: "startDate must use YYYY-MM-DD." });
  }
  if (!isValidDateKey(window.endDate)) {
    issues.push({ path: `${path}.endDate`, message: "endDate must use YYYY-MM-DD." });
  }
  if (!isValidDateKey(window.startDate) || !isValidDateKey(window.endDate)) {
    return;
  }
  if (window.startDate > window.endDate) {
    issues.push({ path, message: "activeWindow.startDate cannot be later than activeWindow.endDate." });
    return;
  }
  if (toUtcMidnight(window.endDate) - toUtcMidnight(window.startDate) !== SEVEN_DAY_WINDOW_MS) {
    issues.push({ path, message: "activeWindow must span exactly 7 calendar days for weekly rotation." });
  }
}

export function validateDailyDungeonDefinition(
  definition: DailyDungeonDefinition,
  path = "dungeon"
): DailyDungeonValidationIssue[] {
  const issues: DailyDungeonValidationIssue[] = [];
  if (!definition.id.trim()) {
    issues.push({ path: `${path}.id`, message: "Dungeon id is required." });
  }
  if (!definition.name.trim()) {
    issues.push({ path: `${path}.name`, message: "Dungeon name is required." });
  }
  if (!definition.description.trim()) {
    issues.push({ path: `${path}.description`, message: "Dungeon description is required." });
  }
  if (!Number.isInteger(definition.attemptLimit) || definition.attemptLimit < 1) {
    issues.push({ path: `${path}.attemptLimit`, message: "attemptLimit must be a positive integer." });
  }
  validateWindow(`${path}.activeWindow`, definition.activeWindow, issues);

  if (!definition.floors.length) {
    issues.push({ path: `${path}.floors`, message: "Dungeon must define at least one floor." });
    return issues;
  }

  const floorNumbers = new Set<number>();
  let previousFloor = 0;
  for (const [index, floor] of definition.floors.entries()) {
    const floorPath = `${path}.floors[${index}]`;
    if (!Number.isInteger(floor.floor) || floor.floor < 1) {
      issues.push({ path: `${floorPath}.floor`, message: "floor must be a positive integer." });
    }
    if (floorNumbers.has(floor.floor)) {
      issues.push({ path: `${floorPath}.floor`, message: `Duplicate floor number ${floor.floor}.` });
    } else {
      floorNumbers.add(floor.floor);
    }
    if (floor.floor !== previousFloor + 1) {
      issues.push({ path: `${floorPath}.floor`, message: "Floors must be sequential starting at 1." });
    }
    previousFloor = floor.floor;

    if (!Number.isInteger(floor.recommendedHeroLevel) || floor.recommendedHeroLevel < 1) {
      issues.push({ path: `${floorPath}.recommendedHeroLevel`, message: "recommendedHeroLevel must be a positive integer." });
    }
    if (!floor.enemyArmyTemplateId.trim()) {
      issues.push({ path: `${floorPath}.enemyArmyTemplateId`, message: "enemyArmyTemplateId is required." });
    }
    if (!Number.isInteger(floor.enemyArmyCount) || floor.enemyArmyCount < 1) {
      issues.push({ path: `${floorPath}.enemyArmyCount`, message: "enemyArmyCount must be a positive integer." });
    }
    if (typeof floor.enemyStatMultiplier !== "number" || !Number.isFinite(floor.enemyStatMultiplier) || floor.enemyStatMultiplier <= 0) {
      issues.push({ path: `${floorPath}.enemyStatMultiplier`, message: "enemyStatMultiplier must be a positive number." });
    }
    validateRewardPresence(floorPath, floor, issues);
  }

  return issues;
}

export function validateDailyDungeonConfigDocument(
  document: DailyDungeonConfigDocument
): DailyDungeonValidationIssue[] {
  const issues: DailyDungeonValidationIssue[] = [];
  if (!document.dungeons.length) {
    return [{ path: "dungeons", message: "Config must define at least one dungeon." }];
  }

  const dungeonIds = new Set<string>();
  const windows: Array<{ index: number; id: string; window: DailyDungeonActiveWindow }> = [];

  for (const [index, dungeon] of document.dungeons.entries()) {
    const path = `dungeons[${index}]`;
    if (dungeonIds.has(dungeon.id)) {
      issues.push({ path: `${path}.id`, message: `Duplicate dungeon id "${dungeon.id}".` });
    } else {
      dungeonIds.add(dungeon.id);
    }
    issues.push(...validateDailyDungeonDefinition(dungeon, path));
    windows.push({ index, id: dungeon.id, window: dungeon.activeWindow });
  }

  const validWindows = windows.filter(({ window }) => isValidDateKey(window.startDate) && isValidDateKey(window.endDate));
  validWindows.sort((left, right) => left.window.startDate.localeCompare(right.window.startDate) || left.id.localeCompare(right.id));

  for (let index = 1; index < validWindows.length; index += 1) {
    const previous = validWindows[index - 1];
    const current = validWindows[index];
    if (!previous || !current) {
      continue;
    }
    if (current.window.startDate <= previous.window.endDate) {
      issues.push({
        path: `dungeons[${current.index}].activeWindow`,
        message: `activeWindow overlaps with dungeon "${previous.id}".`
      });
    }
  }

  return issues;
}
