import { normalizeEloRating, type PlayerTier } from "../../../packages/shared/src/index";

export interface LeaderboardTierThreshold {
  tier: PlayerTier;
  minRating: number;
  maxRating: number | null;
}

export interface LeaderboardTierThresholdsConfigDocument {
  key: "leaderboard.tier_thresholds";
  tiers: LeaderboardTierThreshold[];
}

export interface LeaderboardTierThresholdValidationIssue {
  path: string;
  message: string;
}

export const DEFAULT_LEADERBOARD_TIER_THRESHOLDS = [
  { tier: "bronze", minRating: 0, maxRating: 1099 },
  { tier: "silver", minRating: 1100, maxRating: 1299 },
  { tier: "gold", minRating: 1300, maxRating: 1499 },
  { tier: "platinum", minRating: 1500, maxRating: 1799 },
  { tier: "diamond", minRating: 1800, maxRating: null }
] as const satisfies readonly LeaderboardTierThreshold[];

const EXPECTED_TIER_ORDER: readonly PlayerTier[] = ["bronze", "silver", "gold", "platinum", "diamond"];

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? Math.floor(normalized) : fallback;
}

function normalizeNullableMaxRating(value: unknown, fallback: number | null): number | null {
  if (value == null) {
    return null;
  }

  const normalized = Number(value);
  return Number.isFinite(normalized) && normalized >= 0 ? Math.floor(normalized) : fallback;
}

export function normalizeLeaderboardTierThresholdsConfigDocument(
  input?: Partial<LeaderboardTierThresholdsConfigDocument> | null
): LeaderboardTierThresholdsConfigDocument {
  const tiers = Array.isArray(input?.tiers) ? input.tiers : [];
  return {
    key: "leaderboard.tier_thresholds",
    tiers: tiers.map((tier, index) => {
      const fallback = DEFAULT_LEADERBOARD_TIER_THRESHOLDS[index] ?? DEFAULT_LEADERBOARD_TIER_THRESHOLDS.at(-1)!;
      return {
        tier: EXPECTED_TIER_ORDER.includes(tier?.tier as PlayerTier) ? (tier?.tier as PlayerTier) : fallback.tier,
        minRating: normalizeNonNegativeInteger(tier?.minRating, fallback.minRating),
        maxRating: normalizeNullableMaxRating(tier?.maxRating, fallback.maxRating)
      };
    })
  };
}

export function validateLeaderboardTierThresholdsConfigDocument(
  document: LeaderboardTierThresholdsConfigDocument
): LeaderboardTierThresholdValidationIssue[] {
  const issues: LeaderboardTierThresholdValidationIssue[] = [];

  if (document.key !== "leaderboard.tier_thresholds") {
    issues.push({
      path: "key",
      message: 'key must be exactly "leaderboard.tier_thresholds".'
    });
  }

  if (document.tiers.length !== EXPECTED_TIER_ORDER.length) {
    issues.push({
      path: "tiers",
      message: `tiers must define exactly ${EXPECTED_TIER_ORDER.length} entries.`
    });
    return issues;
  }

  let expectedMinRating = 0;
  for (const [index, threshold] of document.tiers.entries()) {
    const pathPrefix = `tiers[${index}]`;
    const expectedTier = EXPECTED_TIER_ORDER[index];

    if (threshold.tier !== expectedTier) {
      issues.push({
        path: `${pathPrefix}.tier`,
        message: `tier must be ${expectedTier}.`
      });
    }

    if (!Number.isInteger(threshold.minRating) || threshold.minRating < 0) {
      issues.push({
        path: `${pathPrefix}.minRating`,
        message: "minRating must be a non-negative integer."
      });
    }

    if (threshold.maxRating !== null && (!Number.isInteger(threshold.maxRating) || threshold.maxRating < 0)) {
      issues.push({
        path: `${pathPrefix}.maxRating`,
        message: "maxRating must be null or a non-negative integer."
      });
    }

    if (threshold.minRating !== expectedMinRating) {
      issues.push({
        path: `${pathPrefix}.minRating`,
        message: `minRating must be ${expectedMinRating} to keep tiers contiguous.`
      });
    }

    if (index < document.tiers.length - 1) {
      if (threshold.maxRating == null) {
        issues.push({
          path: `${pathPrefix}.maxRating`,
          message: "Only the final tier may use a null maxRating."
        });
        continue;
      }
      if (threshold.maxRating < threshold.minRating) {
        issues.push({
          path: `${pathPrefix}.maxRating`,
          message: "maxRating must be greater than or equal to minRating."
        });
        continue;
      }
      expectedMinRating = threshold.maxRating + 1;
      continue;
    }

    if (threshold.maxRating !== null) {
      issues.push({
        path: `${pathPrefix}.maxRating`,
        message: "The final tier must use a null maxRating."
      });
    }
  }

  return issues;
}

export function parseLeaderboardTierThresholdsConfigDocument(content: string): LeaderboardTierThresholdsConfigDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Config content is not valid JSON");
  }

  const record = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const tiers = Array.isArray(record.tiers) ? record.tiers : [];
  const document: LeaderboardTierThresholdsConfigDocument = {
    key: record.key === "leaderboard.tier_thresholds" ? "leaderboard.tier_thresholds" : (String(record.key ?? "") as "leaderboard.tier_thresholds"),
    tiers: tiers.map((tier) => {
      const item = typeof tier === "object" && tier !== null ? (tier as Record<string, unknown>) : {};
      return {
        tier: String(item.tier ?? "") as PlayerTier,
        minRating: Number.isFinite(Number(item.minRating)) ? Math.floor(Number(item.minRating)) : Number.NaN,
        maxRating: item.maxRating == null ? null : Number.isFinite(Number(item.maxRating)) ? Math.floor(Number(item.maxRating)) : Number.NaN
      };
    })
  };
  const issues = validateLeaderboardTierThresholdsConfigDocument(document);
  if (issues.length > 0) {
    throw new Error(issues[0]!.message);
  }
  return document;
}

export function getLeaderboardTierForRating(
  rating: number | undefined | null,
  thresholds: readonly LeaderboardTierThreshold[] = DEFAULT_LEADERBOARD_TIER_THRESHOLDS
): PlayerTier {
  const normalizedRating = normalizeEloRating(rating);
  for (const threshold of thresholds) {
    if (threshold.maxRating == null) {
      if (normalizedRating >= threshold.minRating) {
        return threshold.tier;
      }
      continue;
    }

    if (normalizedRating >= threshold.minRating && normalizedRating <= threshold.maxRating) {
      return threshold.tier;
    }
  }

  return DEFAULT_LEADERBOARD_TIER_THRESHOLDS[0].tier;
}
