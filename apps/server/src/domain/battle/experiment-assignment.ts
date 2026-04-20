import { type AnalyticsEvent, type ExperimentAssignment, type ExperimentDefinition, type FeatureFlagConfigDocument, normalizeFeatureFlagConfigDocument } from "@veil/shared/platform";

export interface ExperimentAssignmentSubject {
  playerId: string;
  loginId?: string | null;
  wechatOpenId?: string | null;
}

export interface ExperimentVariantMetricsSummary {
  variant: string;
  exposures: number;
  conversions: number;
  conversionRate: number;
  purchasers: number;
  revenue: number;
  arpu: number;
  chiSquare: number | null;
  welchT: number | null;
  significant: boolean;
}

export interface ExperimentMetricsSummary {
  experimentKey: string;
  experimentName: string;
  owner: string;
  stickyBucketKey: string;
  trafficAllocation: number;
  totalExposures: number;
  totalRevenue: number;
  variants: ExperimentVariantMetricsSummary[];
  generatedAt: string;
}

export interface AdminExperimentSummary {
  experimentKey: string;
  experimentName: string;
  owner: string;
  enabled: boolean;
  stickyBucketKey: string;
  trafficAllocation: number;
  variants: Array<{
    key: string;
    allocation: number;
  }>;
  windowSummary: string;
  metrics: ExperimentMetricsSummary | null;
}

interface ExposureLedger {
  playerId: string;
  variant: string;
  at: string;
}

function hashExperimentBucket(subjectKey: string, experimentKey: string): number {
  let hash = 2166136261;
  const input = `${subjectKey}:${experimentKey}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.min(99, Math.floor(((hash >>> 0) / 0x1_0000_0000) * 100));
}

function resolveStickySubjectKey(subject: ExperimentAssignmentSubject, stickyBucketKey?: string | null): string {
  const normalizedMode = stickyBucketKey?.trim().toLowerCase() || "player_id";
  if (normalizedMode === "login_id") {
    return subject.loginId?.trim() || subject.playerId.trim();
  }
  if (normalizedMode === "wechat_open_id") {
    return subject.wechatOpenId?.trim() || subject.playerId.trim();
  }
  return subject.playerId.trim();
}

export function assignExperimentForSubject(
  subject: ExperimentAssignmentSubject,
  experimentKey: string,
  definition: ExperimentDefinition,
  now: Date = new Date()
): ExperimentAssignment {
  const normalizedPlayerId = subject.playerId.trim();
  const stickyBucketKey = definition.stickyBucketKey?.trim() || "player_id";
  const trafficAllocation = Math.max(0, Math.min(100, Math.floor(definition.trafficAllocation ?? 100)));
  const subjectKey = resolveStickySubjectKey(subject, stickyBucketKey);
  const bucket = hashExperimentBucket(subjectKey, experimentKey);
  const baseAssignment: ExperimentAssignment = {
    experimentKey,
    experimentName: definition.name,
    owner: definition.owner,
    bucket,
    stickyBucketKey,
    trafficAllocation,
    variant: definition.fallbackVariant,
    fallbackVariant: definition.fallbackVariant,
    ...(definition.startAt ? { startAt: definition.startAt } : {}),
    ...(definition.endAt ? { endAt: definition.endAt } : {}),
    assigned: false,
    reason: "fallback"
  };

  const whitelistVariant = definition.whitelist?.[normalizedPlayerId];
  if (whitelistVariant) {
    return {
      ...baseAssignment,
      variant: whitelistVariant,
      assigned: true,
      reason: "whitelist"
    };
  }

  if (definition.enabled === false) {
    return {
      ...baseAssignment,
      reason: "inactive"
    };
  }

  if (definition.startAt && now < new Date(definition.startAt)) {
    return {
      ...baseAssignment,
      reason: "before_start"
    };
  }

  if (definition.endAt && now > new Date(definition.endAt)) {
    return {
      ...baseAssignment,
      reason: "after_end"
    };
  }

  if (bucket >= trafficAllocation) {
    return {
      ...baseAssignment,
      reason: "traffic_cap"
    };
  }

  let upperBound = 0;
  for (const variant of definition.variants) {
    upperBound += Math.max(0, Math.floor(variant.allocation));
    if (bucket < upperBound) {
      return {
        ...baseAssignment,
        variant: variant.key,
        assigned: true,
        reason: "bucket"
      };
    }
  }

  return baseAssignment;
}

export function evaluateExperimentsForSubject(
  subject: ExperimentAssignmentSubject,
  config: FeatureFlagConfigDocument,
  now: Date = new Date()
): ExperimentAssignment[] {
  const normalizedConfig = normalizeFeatureFlagConfigDocument(config);
  return Object.entries(normalizedConfig.experiments ?? {})
    .map(([experimentKey, definition]) => assignExperimentForSubject(subject, experimentKey, definition, now))
    .sort((left, right) => left.experimentKey.localeCompare(right.experimentKey));
}

function extractPurchaseRevenue(event: AnalyticsEvent): number {
  if (event.name !== "purchase" && event.name !== "purchase_completed") {
    return 0;
  }

  const value = Number((event.payload as { totalPrice?: unknown }).totalPrice);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : 0;
}

function computeChiSquare(
  exposedA: number,
  convertedA: number,
  exposedB: number,
  convertedB: number
): number | null {
  if (exposedA <= 0 || exposedB <= 0) {
    return null;
  }

  const nonConvertedA = Math.max(0, exposedA - convertedA);
  const nonConvertedB = Math.max(0, exposedB - convertedB);
  const total = convertedA + convertedB + nonConvertedA + nonConvertedB;
  if (total <= 0) {
    return null;
  }

  const row1 = convertedA + nonConvertedA;
  const row2 = convertedB + nonConvertedB;
  const col1 = convertedA + convertedB;
  const col2 = nonConvertedA + nonConvertedB;
  const expected = [
    (row1 * col1) / total,
    (row1 * col2) / total,
    (row2 * col1) / total,
    (row2 * col2) / total
  ];
  if (expected.some((value) => value <= 0)) {
    return null;
  }

  const observed = [convertedA, nonConvertedA, convertedB, nonConvertedB];
  return observed.reduce((sum, value, index) => sum + ((value - expected[index]!) ** 2) / expected[index]!, 0);
}

function computeWelchT(
  exposuresA: number,
  purchasersA: number,
  revenueA: number,
  exposuresB: number,
  purchasersB: number,
  revenueB: number
): number | null {
  if (exposuresA <= 1 || exposuresB <= 1) {
    return null;
  }

  const meanA = revenueA / exposuresA;
  const meanB = revenueB / exposuresB;
  const varianceA = purchasersA > 0 ? (revenueA ** 2) / Math.max(1, purchasersA) / exposuresA - meanA ** 2 : meanA ** 2;
  const varianceB = purchasersB > 0 ? (revenueB ** 2) / Math.max(1, purchasersB) / exposuresB - meanB ** 2 : meanB ** 2;
  const denominator = Math.sqrt(Math.max(0, varianceA / exposuresA) + Math.max(0, varianceB / exposuresB));
  if (denominator <= 0) {
    return null;
  }

  return (meanA - meanB) / denominator;
}

export function buildExperimentMetricsSummary(
  experimentKey: string,
  definition: ExperimentDefinition,
  events: AnalyticsEvent[],
  generatedAt = new Date().toISOString()
): ExperimentMetricsSummary {
  const exposures = new Map<string, ExposureLedger>();
  const conversionsByVariant = new Map<string, Set<string>>();
  const purchasersByVariant = new Map<string, Set<string>>();
  const revenueByVariant = new Map<string, number>();

  const relevantEvents = [...events].sort((left, right) => left.at.localeCompare(right.at));
  for (const event of relevantEvents) {
    if (event.name === "experiment_exposure") {
      const payload = event.payload as {
        experimentKey?: string;
        variant?: string;
      };
      if (payload.experimentKey === experimentKey && payload.variant) {
        exposures.set(event.playerId, {
          playerId: event.playerId,
          variant: payload.variant,
          at: event.at
        });
      }
      continue;
    }

    if (event.name === "experiment_conversion") {
      const payload = event.payload as {
        experimentKey?: string;
        variant?: string;
      };
      const exposure = exposures.get(event.playerId);
      if (payload.experimentKey === experimentKey && payload.variant && exposure) {
        const bucket = conversionsByVariant.get(payload.variant) ?? new Set<string>();
        bucket.add(event.playerId);
        conversionsByVariant.set(payload.variant, bucket);
      }
      continue;
    }

    const revenue = extractPurchaseRevenue(event);
    if (revenue <= 0) {
      continue;
    }

    const exposure = exposures.get(event.playerId);
    if (!exposure) {
      continue;
    }

    purchasersByVariant.set(exposure.variant, (purchasersByVariant.get(exposure.variant) ?? new Set<string>()).add(event.playerId));
    revenueByVariant.set(exposure.variant, (revenueByVariant.get(exposure.variant) ?? 0) + revenue);
  }

  const exposureCounts = new Map<string, number>();
  for (const exposure of exposures.values()) {
    exposureCounts.set(exposure.variant, (exposureCounts.get(exposure.variant) ?? 0) + 1);
  }

  const baselineVariant = definition.variants[0]?.key ?? definition.fallbackVariant;
  const baselineExposures = exposureCounts.get(baselineVariant) ?? 0;
  const baselineConversions = conversionsByVariant.get(baselineVariant)?.size ?? 0;
  const baselinePurchasers = purchasersByVariant.get(baselineVariant)?.size ?? 0;
  const baselineRevenue = revenueByVariant.get(baselineVariant) ?? 0;

  const variants = definition.variants.map<ExperimentVariantMetricsSummary>((variant) => {
    const exposuresForVariant = exposureCounts.get(variant.key) ?? 0;
    const conversions = conversionsByVariant.get(variant.key)?.size ?? 0;
    const purchasers = purchasersByVariant.get(variant.key)?.size ?? 0;
    const revenue = revenueByVariant.get(variant.key) ?? 0;
    const chiSquare =
      variant.key === baselineVariant
        ? null
        : computeChiSquare(exposuresForVariant, conversions, baselineExposures, baselineConversions);
    const welchT =
      variant.key === baselineVariant
        ? null
        : computeWelchT(exposuresForVariant, purchasers, revenue, baselineExposures, baselinePurchasers, baselineRevenue);

    return {
      variant: variant.key,
      exposures: exposuresForVariant,
      conversions,
      conversionRate: roundMetric(exposuresForVariant > 0 ? conversions / exposuresForVariant : 0),
      purchasers,
      revenue: roundMetric(revenue),
      arpu: roundMetric(exposuresForVariant > 0 ? revenue / exposuresForVariant : 0),
      chiSquare: chiSquare == null ? null : roundMetric(chiSquare),
      welchT: welchT == null ? null : roundMetric(welchT),
      significant:
        (chiSquare != null && chiSquare >= 3.841) ||
        (welchT != null && Math.abs(welchT) >= 1.96)
    };
  });

  return {
    experimentKey,
    experimentName: definition.name,
    owner: definition.owner,
    stickyBucketKey: definition.stickyBucketKey?.trim() || "player_id",
    trafficAllocation: Math.max(0, Math.min(100, Math.floor(definition.trafficAllocation ?? 100))),
    totalExposures: Array.from(exposureCounts.values()).reduce((sum, value) => sum + value, 0),
    totalRevenue: roundMetric(Array.from(revenueByVariant.values()).reduce((sum, value) => sum + value, 0)),
    variants,
    generatedAt
  };
}

export function buildAdminExperimentSummaries(
  config: FeatureFlagConfigDocument,
  events: AnalyticsEvent[],
  now = new Date().toISOString()
): AdminExperimentSummary[] {
  const normalizedConfig = normalizeFeatureFlagConfigDocument(config);
  return Object.entries(normalizedConfig.experiments ?? {})
    .map(([experimentKey, definition]) => {
      const metrics = buildExperimentMetricsSummary(experimentKey, definition, events, now);
      return {
        experimentKey,
        experimentName: definition.name,
        owner: definition.owner,
        enabled: definition.enabled !== false,
        stickyBucketKey: definition.stickyBucketKey?.trim() || "player_id",
        trafficAllocation: Math.max(0, Math.min(100, Math.floor(definition.trafficAllocation ?? 100))),
        variants: definition.variants.map((variant) => ({
          key: variant.key,
          allocation: Math.max(0, Math.floor(variant.allocation))
        })),
        windowSummary:
          metrics.totalExposures > 0
            ? `曝光 ${metrics.totalExposures} · 收入 ${metrics.totalRevenue.toFixed(2)}`
            : "尚无曝光样本",
        metrics
      };
    })
    .sort((left, right) => left.experimentKey.localeCompare(right.experimentKey));
}

