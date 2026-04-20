import fs from "node:fs";
import path from "node:path";
import dailyQuestsDocument from "../../../../../configs/daily-quests.json";
import type { DailyQuestDefinition } from "@veil/shared/progression";

export type DailyQuestTier = "common" | "rare" | "epic";

export interface DailyQuestConfigDefinition extends DailyQuestDefinition {
  tier: DailyQuestTier;
}

export interface DailyQuestConfigDocument {
  schemaVersion: 1;
  quests: DailyQuestConfigDefinition[];
}

export interface DailyQuestConfigValidationIssue {
  path: string;
  message: string;
}

const DEFAULT_DAILY_QUESTS_PATH = path.resolve(process.cwd(), "configs/daily-quests.json");
const VALID_METRICS = new Set<DailyQuestDefinition["metric"]>(["hero_moves", "battle_wins", "resource_collections"]);
const VALID_TIERS = new Set<DailyQuestTier>(["common", "rare", "epic"]);

interface DailyQuestConfigRuntimeDependencies {
  readFileSync(filePath: string, encoding: BufferEncoding): string;
}

const defaultRuntimeDependencies: DailyQuestConfigRuntimeDependencies = {
  readFileSync: (filePath, encoding) => fs.readFileSync(filePath, encoding)
};

let runtimeDependencies = defaultRuntimeDependencies;
let cachedConfig: DailyQuestConfigDocument | null = null;

function normalizeNonNegativeInteger(value: number | null | undefined, fallback = 0): number {
  const normalized = Math.floor(value ?? Number.NaN);
  if (!Number.isFinite(normalized) || normalized < 0) {
    return fallback;
  }
  return normalized;
}

function normalizePositiveInteger(value: number | null | undefined, fallback: number): number {
  const normalized = Math.floor(value ?? Number.NaN);
  if (!Number.isFinite(normalized) || normalized < 1) {
    return fallback;
  }
  return normalized;
}

export function normalizeDailyQuestConfigDocument(input?: Partial<DailyQuestConfigDocument> | null): DailyQuestConfigDocument {
  const quests = Array.isArray(input?.quests) ? input.quests : [];
  return {
    schemaVersion: 1,
    quests: quests
      .filter((quest): quest is DailyQuestConfigDefinition => Boolean(quest && typeof quest === "object"))
      .map((quest, index) => ({
        id: typeof quest.id === "string" && quest.id.trim() ? quest.id.trim() : `daily-quest-${index + 1}`,
        title: typeof quest.title === "string" ? quest.title.trim() : "",
        description: typeof quest.description === "string" ? quest.description.trim() : "",
        metric: VALID_METRICS.has(quest.metric) ? quest.metric : "hero_moves",
        target: normalizePositiveInteger(quest.target, 1),
        tier: VALID_TIERS.has(quest.tier) ? quest.tier : "common",
        reward: {
          gems: normalizeNonNegativeInteger(quest.reward?.gems, 0),
          gold: normalizeNonNegativeInteger(quest.reward?.gold, 0)
        }
      }))
  };
}

export function validateDailyQuestConfigDocument(document: DailyQuestConfigDocument): DailyQuestConfigValidationIssue[] {
  const issues: DailyQuestConfigValidationIssue[] = [];
  if (document.quests.length < 15) {
    issues.push({ path: "quests", message: "Config must define at least 15 quests." });
  }

  const ids = new Set<string>();
  const tierCounts = {
    common: 0,
    rare: 0,
    epic: 0
  };

  for (const [index, quest] of document.quests.entries()) {
    const pathPrefix = `quests[${index}]`;
    if (!quest.id.trim()) {
      issues.push({ path: `${pathPrefix}.id`, message: "Quest id is required." });
    } else if (ids.has(quest.id)) {
      issues.push({ path: `${pathPrefix}.id`, message: `Duplicate quest id "${quest.id}".` });
    } else {
      ids.add(quest.id);
    }

    if (!quest.title.trim()) {
      issues.push({ path: `${pathPrefix}.title`, message: "Quest title is required." });
    }
    if (!quest.description.trim()) {
      issues.push({ path: `${pathPrefix}.description`, message: "Quest description is required." });
    }
    if (!VALID_METRICS.has(quest.metric)) {
      issues.push({ path: `${pathPrefix}.metric`, message: `Unsupported metric "${quest.metric}".` });
    }
    if (!VALID_TIERS.has(quest.tier)) {
      issues.push({ path: `${pathPrefix}.tier`, message: `Unsupported tier "${quest.tier}".` });
    } else {
      tierCounts[quest.tier] += 1;
    }
    if (!Number.isInteger(quest.target) || quest.target < 1) {
      issues.push({ path: `${pathPrefix}.target`, message: "target must be a positive integer." });
    }
    if (!Number.isInteger(quest.reward.gems) || quest.reward.gems < 0) {
      issues.push({ path: `${pathPrefix}.reward.gems`, message: "gems must be a non-negative integer." });
    }
    if (!Number.isInteger(quest.reward.gold) || quest.reward.gold < 0) {
      issues.push({ path: `${pathPrefix}.reward.gold`, message: "gold must be a non-negative integer." });
    }
    if ((quest.reward.gems ?? 0) <= 0 && (quest.reward.gold ?? 0) <= 0) {
      issues.push({ path: `${pathPrefix}.reward`, message: "Quest reward must grant positive gems or gold." });
    }
  }

  for (const tier of ["common", "rare", "epic"] as const) {
    if (tierCounts[tier] === 0) {
      issues.push({ path: "quests", message: `Config must define at least one ${tier} quest.` });
    }
  }

  return issues;
}

function validateOrFallback(document: DailyQuestConfigDocument, source: string): DailyQuestConfigDocument {
  const issues = validateDailyQuestConfigDocument(document);
  if (issues.length === 0) {
    return document;
  }

  console.warn(
    `[DailyQuestConfig] Falling back after invalid config from ${source}: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`
  );
  return normalizeDailyQuestConfigDocument(dailyQuestsDocument as DailyQuestConfigDocument);
}

export function configureDailyQuestConfigRuntimeDependencies(overrides: Partial<DailyQuestConfigRuntimeDependencies>): void {
  runtimeDependencies = {
    ...runtimeDependencies,
    ...overrides
  };
}

export function resetDailyQuestConfigRuntimeDependencies(): void {
  runtimeDependencies = defaultRuntimeDependencies;
  cachedConfig = null;
}

export function loadDailyQuestConfig(env: NodeJS.ProcessEnv = process.env): DailyQuestConfigDocument {
  if (cachedConfig) {
    return cachedConfig;
  }

  const configuredPath = env.VEIL_DAILY_QUESTS_PATH?.trim() || DEFAULT_DAILY_QUESTS_PATH;
  try {
    const raw = runtimeDependencies.readFileSync(configuredPath, "utf8");
    cachedConfig = validateOrFallback(
      normalizeDailyQuestConfigDocument(JSON.parse(raw) as DailyQuestConfigDocument),
      configuredPath
    );
  } catch (error) {
    console.warn(`[DailyQuestConfig] Falling back to bundled defaults after failing to load ${configuredPath}`, error);
    cachedConfig = normalizeDailyQuestConfigDocument(dailyQuestsDocument as DailyQuestConfigDocument);
  }

  return cachedConfig;
}
