import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSeasonRewardConfigDocument,
  normalizeSeasonRewardConfig,
  resolveSeasonRewardBracket,
  resolveSeasonRewardConfig,
  computeSeasonReward
} from "@server/domain/social/season-rewards";
import type { ResolvedSeasonRewardConfig } from "@server/domain/social/season-rewards";

// ──────────────────────────────────────────────────────────
// Stub config helpers
// ──────────────────────────────────────────────────────────

function stubConfig(brackets: Array<{ topPercentile: number; gems: number; badge: string }>): ResolvedSeasonRewardConfig {
  return normalizeSeasonRewardConfig({ brackets });
}

const SIMPLE_CONFIG = stubConfig([
  { topPercentile: 10, gems: 500, badge: "diamond" },
  { topPercentile: 30, gems: 200, badge: "gold" },
  { topPercentile: 60, gems: 50, badge: "silver" }
]);

// ──────────────────────────────────────────────────────────
// normalizeSeasonRewardConfig
// ──────────────────────────────────────────────────────────

test("normalizeSeasonRewardConfig: rejects empty brackets array", () => {
  assert.throws(
    () => normalizeSeasonRewardConfig({ brackets: [] }),
    /at least one reward bracket/
  );
});

test("normalizeSeasonRewardConfig: rejects null input", () => {
  assert.throws(() => normalizeSeasonRewardConfig(null));
});

test("normalizeSeasonRewardConfig: rejects bracket with missing badge", () => {
  assert.throws(
    () => normalizeSeasonRewardConfig({ brackets: [{ topPercentile: 10, gems: 100, badge: "  " }] }),
    /badge is required/
  );
});

test("normalizeSeasonRewardConfig: rejects topPercentile of 0", () => {
  assert.throws(
    () => normalizeSeasonRewardConfig({ brackets: [{ topPercentile: 0, gems: 100, badge: "gold" }] }),
    /within 0-100/
  );
});

test("normalizeSeasonRewardConfig: rejects topPercentile above 100", () => {
  assert.throws(
    () => normalizeSeasonRewardConfig({ brackets: [{ topPercentile: 101, gems: 100, badge: "gold" }] }),
    /within 0-100/
  );
});

test("normalizeSeasonRewardConfig: rejects negative gems", () => {
  assert.throws(
    () => normalizeSeasonRewardConfig({ brackets: [{ topPercentile: 10, gems: -50, badge: "gold" }] }),
    /non-negative integer/
  );
});

test("normalizeSeasonRewardConfig: rejects duplicate topPercentile values", () => {
  assert.throws(
    () => normalizeSeasonRewardConfig({
      brackets: [
        { topPercentile: 10, gems: 100, badge: "gold" },
        { topPercentile: 10, gems: 50, badge: "silver" }
      ]
    }),
    /unique/
  );
});

test("parseSeasonRewardConfigDocument: bundled season reward config is valid", () => {
  const config = resolveSeasonRewardConfig();
  assert.ok(config.brackets.length > 0);
});

test("parseSeasonRewardConfigDocument: rejects unexpected root properties", () => {
  assert.throws(
    () => parseSeasonRewardConfigDocument({ brackets: [{ topPercentile: 10, gems: 100, badge: "gold" }], extra: true }),
    /is not allowed/
  );
});

test("parseSeasonRewardConfigDocument: rejects non-array brackets", () => {
  assert.throws(
    () => parseSeasonRewardConfigDocument({ brackets: "not-an-array" }),
    /must be an array/
  );
});

test("parseSeasonRewardConfigDocument: rejects fractional gems in config documents", () => {
  assert.throws(
    () => parseSeasonRewardConfigDocument({ brackets: [{ topPercentile: 10, gems: 99.9, badge: "gold" }] }),
    /non-negative integer/
  );
});

test("normalizeSeasonRewardConfig: valid config returns sorted brackets by topPercentile", () => {
  const config = normalizeSeasonRewardConfig({
    brackets: [
      { topPercentile: 50, gems: 50, badge: "silver" },
      { topPercentile: 10, gems: 200, badge: "gold" }
    ]
  });
  assert.equal(config.brackets[0]?.topPercentile, 10);
  assert.equal(config.brackets[1]?.topPercentile, 50);
});

test("normalizeSeasonRewardConfig: floors fractional gems to integer", () => {
  const config = normalizeSeasonRewardConfig({ brackets: [{ topPercentile: 10, gems: 99.9, badge: "gold" }] });
  assert.equal(config.brackets[0]?.gems, 99);
});

// ──────────────────────────────────────────────────────────
// resolveSeasonRewardBracket
// ──────────────────────────────────────────────────────────

test("resolveSeasonRewardBracket: top 1 of 100 gets diamond bracket (top 10%)", () => {
  const bracket = resolveSeasonRewardBracket(1, 100, SIMPLE_CONFIG);
  assert.equal(bracket?.badge, "diamond");
  assert.equal(bracket?.rankPosition, 1);
});

test("resolveSeasonRewardBracket: rank 10 of 100 is within top 10%, gets diamond", () => {
  const bracket = resolveSeasonRewardBracket(10, 100, SIMPLE_CONFIG);
  assert.equal(bracket?.badge, "diamond");
});

test("resolveSeasonRewardBracket: rank 11 of 100 is in top 30%, gets gold", () => {
  const bracket = resolveSeasonRewardBracket(11, 100, SIMPLE_CONFIG);
  assert.equal(bracket?.badge, "gold");
});

test("resolveSeasonRewardBracket: rank 30 of 100 is within top 30%, gets gold", () => {
  const bracket = resolveSeasonRewardBracket(30, 100, SIMPLE_CONFIG);
  assert.equal(bracket?.badge, "gold");
});

test("resolveSeasonRewardBracket: rank 60 of 100 gets silver (top 60%)", () => {
  const bracket = resolveSeasonRewardBracket(60, 100, SIMPLE_CONFIG);
  assert.equal(bracket?.badge, "silver");
});

test("resolveSeasonRewardBracket: rank below all brackets returns null", () => {
  const bracket = resolveSeasonRewardBracket(61, 100, SIMPLE_CONFIG);
  assert.equal(bracket, null);
});

test("resolveSeasonRewardBracket: invalid rank 0 returns null", () => {
  assert.equal(resolveSeasonRewardBracket(0, 100, SIMPLE_CONFIG), null);
});

test("resolveSeasonRewardBracket: invalid negative rank returns null", () => {
  assert.equal(resolveSeasonRewardBracket(-1, 100, SIMPLE_CONFIG), null);
});

test("resolveSeasonRewardBracket: invalid rankedPlayerCount 0 returns null", () => {
  assert.equal(resolveSeasonRewardBracket(1, 0, SIMPLE_CONFIG), null);
});

test("resolveSeasonRewardBracket: rank 1 of 1 player is top 100% — gets highest bracket", () => {
  const bracket = resolveSeasonRewardBracket(1, 1, SIMPLE_CONFIG);
  assert.equal(bracket?.badge, "diamond");
});

test("resolveSeasonRewardBracket: rankPosition is preserved in result", () => {
  const bracket = resolveSeasonRewardBracket(5, 100, SIMPLE_CONFIG);
  assert.equal(bracket?.rankPosition, 5);
});

// ──────────────────────────────────────────────────────────
// computeSeasonReward
// ──────────────────────────────────────────────────────────

test("computeSeasonReward: rank in top bracket returns gems and badge", () => {
  const reward = computeSeasonReward(1, 100, SIMPLE_CONFIG);
  assert.equal(reward?.gems, 500);
  assert.equal(reward?.badge, "diamond");
  assert.equal(reward?.rankPosition, 1);
});

test("computeSeasonReward: rank in middle bracket returns correct gems", () => {
  const reward = computeSeasonReward(20, 100, SIMPLE_CONFIG);
  assert.equal(reward?.gems, 200);
  assert.equal(reward?.badge, "gold");
});

test("computeSeasonReward: rank outside all brackets returns null", () => {
  const reward = computeSeasonReward(99, 100, SIMPLE_CONFIG);
  assert.equal(reward, null);
});

test("computeSeasonReward: zero gems bracket returns 0 gems", () => {
  const config = stubConfig([{ topPercentile: 100, gems: 0, badge: "participation" }]);
  const reward = computeSeasonReward(1, 10, config);
  assert.equal(reward?.gems, 0);
  assert.equal(reward?.badge, "participation");
});
