import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlayerAccountReadModel } from "../src/player-account.ts";

// --- Null/undefined defaults ---

test("normalizePlayerAccountReadModel(null) → playerId='' and displayName falls back to 'player'", () => {
  const result = normalizePlayerAccountReadModel(null);
  assert.equal(result.playerId, "");
  // displayName defaults to playerId or "player" when both are empty
  assert.equal(result.displayName, "player");
});

test("normalizePlayerAccountReadModel(undefined) → globalResources defaults to {gold:0,wood:0,ore:0}", () => {
  const result = normalizePlayerAccountReadModel(undefined);
  assert.deepEqual(result.globalResources, { gold: 0, wood: 0, ore: 0 });
});

test("normalizePlayerAccountReadModel(null) → achievements=[] and recentEventLog=[]", () => {
  const result = normalizePlayerAccountReadModel(null);
  assert.deepEqual(result.achievements, []);
  assert.deepEqual(result.recentEventLog, []);
});

test("normalizePlayerAccountReadModel(null) → seasonPassTier omitted (defaults to 1, omitted since <= 1)", () => {
  const result = normalizePlayerAccountReadModel(null);
  // seasonPassTier is omitted from output when it equals 1 (the minimum)
  assert.equal(result.seasonPassTier, undefined);
});

// --- String normalization ---

test("playerId with surrounding whitespace is trimmed", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "  hello  " });
  assert.equal(result.playerId, "hello");
});

test("displayName with surrounding whitespace is trimmed", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", displayName: "  World  " });
  assert.equal(result.displayName, "World");
});

test("loginId is lowercased and trimmed", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", loginId: "  UPPER@test.com  " });
  assert.equal(result.loginId, "upper@test.com");
});

// --- Numeric clamping ---

test("dailyPlayMinutes=-5 is clamped to 0 (omitted from output)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", dailyPlayMinutes: -5 });
  assert.equal(result.dailyPlayMinutes, undefined);
});

test("dailyPlayMinutes=3.7 is floored to 3", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", dailyPlayMinutes: 3.7 });
  assert.equal(result.dailyPlayMinutes, 3);
});

test("loginStreak=-1 is clamped to 0 (omitted from output)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", loginStreak: -1 });
  assert.equal(result.loginStreak, undefined);
});

test("seasonPassTier=0 is raised to minimum of 1 (omitted since equals 1)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassTier: 0 });
  assert.equal(result.seasonPassTier, undefined);
});

test("seasonPassTier=0.5 is floored then clamped to 1 (omitted since equals 1)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassTier: 0.5 });
  assert.equal(result.seasonPassTier, undefined);
});

test("seasonPassTier=3 is preserved in output", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassTier: 3 });
  assert.equal(result.seasonPassTier, 3);
});

test("seasonXp=-100 is clamped to 0 (omitted from output)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonXp: -100 });
  assert.equal(result.seasonXp, undefined);
});

// --- Boolean normalization ---

test("seasonPassPremium=true is kept as true", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassPremium: true });
  assert.equal(result.seasonPassPremium, true);
});

test("seasonPassPremium='true' (string) is rejected → not present in output", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassPremium: "true" as unknown as boolean });
  assert.equal(result.seasonPassPremium, undefined);
});

test("ageVerified=true is kept as true", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", ageVerified: true });
  assert.equal(result.ageVerified, true);
});

test("isMinor=1 (number) is rejected → not present in output", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", isMinor: 1 as unknown as boolean });
  assert.equal(result.isMinor, undefined);
});

// --- banStatus ---

test("banStatus='permanent' is preserved", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", banStatus: "permanent" });
  assert.equal(result.banStatus, "permanent");
});

test("banStatus='temporary' is preserved", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", banStatus: "temporary" });
  assert.equal(result.banStatus, "temporary");
});

test("banStatus='hacked_value' is rejected → omitted (treated as none)", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", banStatus: "hacked_value" as "temporary" });
  assert.equal(result.banStatus, undefined);
});

test("banStatus=undefined → omitted from output", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1" });
  assert.equal(result.banStatus, undefined);
});

// --- lastPlayDate ---

test("lastPlayDate='2026-04-10' (valid format) is kept", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", lastPlayDate: "2026-04-10" });
  assert.equal(result.lastPlayDate, "2026-04-10");
});

test("lastPlayDate='April 10 2026' (invalid format) is rejected → omitted", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", lastPlayDate: "April 10 2026" });
  assert.equal(result.lastPlayDate, undefined);
});

test("lastPlayDate='2026-4-1' (non-zero-padded) is rejected → omitted", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", lastPlayDate: "2026-4-1" });
  assert.equal(result.lastPlayDate, undefined);
});

// --- seasonPassClaimedTiers ---

test("seasonPassClaimedTiers=[3,1,2,2,1] → deduped and sorted ascending to [1,2,3]", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassClaimedTiers: [3, 1, 2, 2, 1] });
  assert.deepEqual(result.seasonPassClaimedTiers, [1, 2, 3]);
});

test("seasonPassClaimedTiers=[0,-1,1] → non-positive removed, result is [1]", () => {
  const result = normalizePlayerAccountReadModel({ playerId: "p1", seasonPassClaimedTiers: [0, -1, 1] });
  assert.deepEqual(result.seasonPassClaimedTiers, [1]);
});
