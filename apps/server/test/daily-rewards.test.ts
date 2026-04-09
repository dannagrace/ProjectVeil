import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDailyRewardConfig,
  resolveDailyRewardForStreak,
  getPreviousDailyRewardDateKey
} from "../src/daily-rewards";
import type { DailyRewardTier } from "../src/daily-rewards";

// ──────────────────────────────────────────────────────────
// normalizeDailyRewardConfig
// ──────────────────────────────────────────────────────────

test("normalizeDailyRewardConfig: rejects null input", () => {
  assert.throws(() => normalizeDailyRewardConfig(null), /at least one reward/);
});

test("normalizeDailyRewardConfig: rejects empty rewards array", () => {
  assert.throws(() => normalizeDailyRewardConfig({ rewards: [] }), /at least one reward/);
});

test("normalizeDailyRewardConfig: rejects undefined rewards", () => {
  assert.throws(() => normalizeDailyRewardConfig({ rewards: undefined }), /at least one reward/);
});

test("normalizeDailyRewardConfig: rejects negative gems", () => {
  assert.throws(
    () => normalizeDailyRewardConfig({ rewards: [{ day: 1, gems: -10, gold: 0 }] }),
    /non-negative integer/
  );
});

test("normalizeDailyRewardConfig: rejects negative gold", () => {
  assert.throws(
    () => normalizeDailyRewardConfig({ rewards: [{ day: 1, gems: 0, gold: -100 }] }),
    /non-negative integer/
  );
});

test("normalizeDailyRewardConfig: valid single-entry config normalizes correctly", () => {
  const tiers = normalizeDailyRewardConfig({ rewards: [{ day: 1, gems: 10, gold: 100 }] });
  assert.equal(tiers.length, 1);
  assert.equal(tiers[0]?.day, 1);
  assert.equal(tiers[0]?.gems, 10);
  assert.equal(tiers[0]?.gold, 100);
});

test("normalizeDailyRewardConfig: floors fractional gems to integer", () => {
  const tiers = normalizeDailyRewardConfig({ rewards: [{ day: 1, gems: 5.9, gold: 0 }] });
  assert.equal(tiers[0]?.gems, 5);
});

test("normalizeDailyRewardConfig: floors fractional gold to integer", () => {
  const tiers = normalizeDailyRewardConfig({ rewards: [{ day: 1, gems: 0, gold: 99.7 }] });
  assert.equal(tiers[0]?.gold, 99);
});

test("normalizeDailyRewardConfig: missing day defaults to index+1", () => {
  const tiers = normalizeDailyRewardConfig({ rewards: [{ gems: 5, gold: 0 }, { gems: 10, gold: 0 }] as Partial<DailyRewardTier>[] });
  assert.equal(tiers[0]?.day, 1);
  assert.equal(tiers[1]?.day, 2);
});

test("normalizeDailyRewardConfig: zero gems and gold is valid", () => {
  const tiers = normalizeDailyRewardConfig({ rewards: [{ day: 1, gems: 0, gold: 0 }] });
  assert.equal(tiers[0]?.gems, 0);
  assert.equal(tiers[0]?.gold, 0);
});

// ──────────────────────────────────────────────────────────
// resolveDailyRewardForStreak
// ──────────────────────────────────────────────────────────

const SEVEN_DAY_TIERS: DailyRewardTier[] = [
  { day: 1, gems: 5, gold: 50 },
  { day: 2, gems: 5, gold: 50 },
  { day: 3, gems: 10, gold: 100 },
  { day: 4, gems: 5, gold: 50 },
  { day: 5, gems: 5, gold: 50 },
  { day: 6, gems: 10, gold: 100 },
  { day: 7, gems: 20, gold: 200 }
];

test("resolveDailyRewardForStreak: streak 1 returns first tier", () => {
  const grant = resolveDailyRewardForStreak(1, SEVEN_DAY_TIERS);
  assert.equal(grant.gems, 5);
  assert.equal(grant.gold, 50);
});

test("resolveDailyRewardForStreak: streak 7 returns last tier (big reward)", () => {
  const grant = resolveDailyRewardForStreak(7, SEVEN_DAY_TIERS);
  assert.equal(grant.gems, 20);
  assert.equal(grant.gold, 200);
});

test("resolveDailyRewardForStreak: streak 8 wraps to first tier (modulo behavior)", () => {
  const grant = resolveDailyRewardForStreak(8, SEVEN_DAY_TIERS);
  assert.equal(grant.gems, 5);
  assert.equal(grant.gold, 50);
});

test("resolveDailyRewardForStreak: streak 14 wraps to last tier", () => {
  const grant = resolveDailyRewardForStreak(14, SEVEN_DAY_TIERS);
  assert.equal(grant.gems, 20);
  assert.equal(grant.gold, 200);
});

test("resolveDailyRewardForStreak: streak 0 is treated as 1 (clamped)", () => {
  const grant = resolveDailyRewardForStreak(0, SEVEN_DAY_TIERS);
  assert.equal(grant.gems, 5);
});

test("resolveDailyRewardForStreak: negative streak is treated as 1 (clamped)", () => {
  const grant = resolveDailyRewardForStreak(-5, SEVEN_DAY_TIERS);
  assert.equal(grant.gems, 5);
});

test("resolveDailyRewardForStreak: fractional streak is floored before modulo", () => {
  // 3.9 → floor → 3 → index 2 → day 3 tier
  const grant = resolveDailyRewardForStreak(3.9, SEVEN_DAY_TIERS);
  assert.equal(grant.gems, 10);
});

test("resolveDailyRewardForStreak: single-tier config always returns that tier regardless of streak", () => {
  const singleTier: DailyRewardTier[] = [{ day: 1, gems: 15, gold: 150 }];
  assert.equal(resolveDailyRewardForStreak(1, singleTier).gems, 15);
  assert.equal(resolveDailyRewardForStreak(99, singleTier).gems, 15);
});

// ──────────────────────────────────────────────────────────
// getPreviousDailyRewardDateKey
// ──────────────────────────────────────────────────────────

test("getPreviousDailyRewardDateKey: returns the calendar day before the given date key", () => {
  assert.equal(getPreviousDailyRewardDateKey("2026-04-09"), "2026-04-08");
});

test("getPreviousDailyRewardDateKey: crosses month boundary correctly", () => {
  assert.equal(getPreviousDailyRewardDateKey("2026-04-01"), "2026-03-31");
});

test("getPreviousDailyRewardDateKey: crosses year boundary correctly", () => {
  assert.equal(getPreviousDailyRewardDateKey("2026-01-01"), "2025-12-31");
});

test("getPreviousDailyRewardDateKey: handles leap day correctly", () => {
  assert.equal(getPreviousDailyRewardDateKey("2024-03-01"), "2024-02-29");
});

test("getPreviousDailyRewardDateKey: throws for invalid date key format", () => {
  assert.throws(() => getPreviousDailyRewardDateKey("not-a-date"), /valid YYYY-MM-DD/);
});

test("getPreviousDailyRewardDateKey: returns YYYY-MM-DD formatted string", () => {
  const result = getPreviousDailyRewardDateKey("2026-04-09");
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});
