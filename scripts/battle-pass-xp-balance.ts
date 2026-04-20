import battlePassConfigDocument from "../configs/battle-pass.json";
import { resolveBattlePassConfig, resolveBattlePassTierForXp, type BattlePassConfig } from "@server/domain/economy/battle-pass";

export interface BattlePassBalanceAssumptions {
  seasonDays: number;
  matchesPerDay: number;
  winRate: number;
  dailyLoginDays: number;
}

export interface BattlePassBalanceMilestone {
  tier: number;
  xpRequired: number;
  estimatedDay: number;
}

export interface BattlePassBalancePlan {
  assumptions: BattlePassBalanceAssumptions;
  dailyMatchXp: number;
  dailyLoginXp: number;
  expectedDailyXp: number;
  projectedSeasonXp: number;
  projectedTier: number;
  finalTierTargetDay: number;
  milestones: BattlePassBalanceMilestone[];
}

function normalizeNonNegativeInteger(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative number`);
  }
  return Math.floor(value);
}

function normalizeWinRate(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("winRate must be between 0 and 1");
  }
  return value;
}

export function buildBattlePassBalancePlan(
  config: BattlePassConfig,
  assumptions: BattlePassBalanceAssumptions
): BattlePassBalancePlan {
  const seasonDays = Math.max(1, normalizeNonNegativeInteger(assumptions.seasonDays, "seasonDays"));
  const matchesPerDay = normalizeNonNegativeInteger(assumptions.matchesPerDay, "matchesPerDay");
  const dailyLoginDays = Math.min(
    seasonDays,
    normalizeNonNegativeInteger(assumptions.dailyLoginDays, "dailyLoginDays")
  );
  const winRate = normalizeWinRate(assumptions.winRate);

  const expectedMatchXp = matchesPerDay * (
    (winRate * config.seasonXpPerWin) +
    ((1 - winRate) * config.seasonXpPerLoss)
  );
  const dailyMatchXp = Math.round(expectedMatchXp);
  const dailyLoginXp = dailyLoginDays > 0 ? Math.round((dailyLoginDays / seasonDays) * config.seasonXpDailyLoginBonus) : 0;
  const expectedDailyXp = dailyMatchXp + dailyLoginXp;
  const projectedSeasonXp = expectedDailyXp * seasonDays;
  const projectedTier = resolveBattlePassTierForXp(config, projectedSeasonXp);
  const finalTier = config.tiers[config.tiers.length - 1];
  const finalTierTargetDay = expectedDailyXp > 0 ? Math.ceil(finalTier.xpRequired / expectedDailyXp) : Number.POSITIVE_INFINITY;

  return {
    assumptions: {
      seasonDays,
      matchesPerDay,
      winRate,
      dailyLoginDays
    },
    dailyMatchXp,
    dailyLoginXp,
    expectedDailyXp,
    projectedSeasonXp,
    projectedTier,
    finalTierTargetDay,
    milestones: config.tiers.map((tier) => ({
      tier: tier.tier,
      xpRequired: tier.xpRequired,
      estimatedDay: expectedDailyXp > 0 ? Math.ceil(tier.xpRequired / expectedDailyXp) : Number.POSITIVE_INFINITY
    }))
  };
}

export function formatBattlePassBalancePlan(plan: BattlePassBalancePlan): string {
  const finalTierDay = Number.isFinite(plan.finalTierTargetDay) ? `D${plan.finalTierTargetDay}` : "unreachable";
  const milestoneLines = plan.milestones
    .filter((milestone) => milestone.tier === 1 || milestone.tier % 5 === 0)
    .map((milestone) => {
      const day = Number.isFinite(milestone.estimatedDay) ? `D${milestone.estimatedDay}` : "unreachable";
      return `T${milestone.tier}\t${milestone.xpRequired}\t${day}`;
    });

  return [
    "Battle Pass XP Balance Plan",
    `seasonDays=${plan.assumptions.seasonDays} matchesPerDay=${plan.assumptions.matchesPerDay} winRate=${plan.assumptions.winRate.toFixed(2)} dailyLoginDays=${plan.assumptions.dailyLoginDays}`,
    `dailyMatchXp=${plan.dailyMatchXp} dailyLoginXp=${plan.dailyLoginXp} expectedDailyXp=${plan.expectedDailyXp}`,
    `projectedSeasonXp=${plan.projectedSeasonXp} projectedTier=${plan.projectedTier} finalTierTarget=${finalTierDay}`,
    "",
    "milestone\txpRequired\testimatedDay",
    ...milestoneLines
  ].join("\n");
}

function readNumericFlag(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const raw = process.argv.find((value) => value.startsWith(prefix));
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw.slice(prefix.length));
  if (!Number.isFinite(parsed)) {
    throw new Error(`--${name} must be numeric`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const config = resolveBattlePassConfig(battlePassConfigDocument);
  const plan = buildBattlePassBalancePlan(config, {
    seasonDays: readNumericFlag("season-days", 28),
    matchesPerDay: readNumericFlag("matches-per-day", 8),
    winRate: readNumericFlag("win-rate", 0.55),
    dailyLoginDays: readNumericFlag("daily-login-days", 28)
  });

  process.stdout.write(`${formatBattlePassBalancePlan(plan)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
