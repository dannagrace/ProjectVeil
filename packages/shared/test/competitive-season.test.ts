import assert from "node:assert/strict";
import test from "node:test";
import {
  getPromotionSeriesTargetDivision,
  rollRankedWeeklyProgress,
  shouldApplyWeeklyDivisionDecay
} from "../src/index";

test("promotion cutoffs use the next division threshold", () => {
  assert.equal(getPromotionSeriesTargetDivision("bronze_i", 349), null);
  assert.equal(getPromotionSeriesTargetDivision("bronze_i", 350), "bronze_ii");
  assert.equal(getPromotionSeriesTargetDivision("silver_iii", 1300), "gold_i");
  assert.equal(getPromotionSeriesTargetDivision("diamond_iii", 5000), null);
});

test("weekly progress rolls stale weeks forward and preserves last week's totals", () => {
  assert.deepEqual(
    rollRankedWeeklyProgress(
      {
        currentWeekStartsAt: "2026-03-30T00:00:00.000Z",
        currentWeekBattles: 4,
        currentWeekWins: 2
      },
      "2026-04-06T12:00:00.000Z"
    ),
    {
      currentWeekStartsAt: "2026-04-06T00:00:00.000Z",
      currentWeekBattles: 0,
      currentWeekWins: 0,
      previousWeekStartsAt: "2026-03-30T00:00:00.000Z",
      previousWeekBattles: 4,
      previousWeekWins: 2
    }
  );
});

test("weekly decay requires a crossed week boundary, inactivity, and a non-bottom division", () => {
  assert.equal(
    shouldApplyWeeklyDivisionDecay(
      "silver_i",
      {
        currentWeekStartsAt: "2026-03-30T00:00:00.000Z",
        currentWeekBattles: 0,
        currentWeekWins: 0
      },
      "2026-04-06T12:00:00.000Z"
    ),
    true
  );
  assert.equal(
    shouldApplyWeeklyDivisionDecay(
      "silver_i",
      {
        currentWeekStartsAt: "2026-03-30T00:00:00.000Z",
        currentWeekBattles: 1,
        currentWeekWins: 0
      },
      "2026-04-06T12:00:00.000Z"
    ),
    false
  );
  assert.equal(
    shouldApplyWeeklyDivisionDecay(
      "bronze_i",
      {
        currentWeekStartsAt: "2026-03-30T00:00:00.000Z",
        currentWeekBattles: 0,
        currentWeekWins: 0
      },
      "2026-04-06T12:00:00.000Z"
    ),
    false
  );
});
