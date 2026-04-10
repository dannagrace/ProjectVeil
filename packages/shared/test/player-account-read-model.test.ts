import assert from "node:assert/strict";
import test from "node:test";

import { normalizePlayerAccountReadModel } from "../src/index.ts";

test("player account read model defaults null and undefined fields to normalized empty values", () => {
  const account = normalizePlayerAccountReadModel({
    playerId: undefined,
    displayName: undefined,
    seasonPassClaimedTiers: null,
    seasonBadges: null,
    globalResources: null,
    achievements: null,
    recentEventLog: null,
    recentBattleReplays: null,
    battleReportCenter: null,
    mailbox: null,
    mailboxSummary: null,
    experiments: null
  });

  assert.equal(account.playerId, "");
  assert.equal(account.displayName, "player");
  assert.equal(account.gems, 0);
  assert.deepEqual(account.globalResources, {
    gold: 0,
    wood: 0,
    ore: 0
  });
  assert.ok(account.achievements.length > 0);
  assert.ok(account.achievements.every((achievement) => achievement.current === 0));
  assert.deepEqual(account.recentEventLog, []);
  assert.deepEqual(account.recentBattleReplays, []);
  assert.equal(account.banStatus, undefined);
  assert.equal(account.lastPlayDate, undefined);
  assert.equal(account.seasonPassClaimedTiers, undefined);
});

test("player account read model trims strings and lowercases login ids", () => {
  const account = normalizePlayerAccountReadModel({
    playerId: "  player-123  ",
    displayName: "  Veil Runner  ",
    avatarUrl: "  https://cdn.example/avatar.png  ",
    loginId: "  Player.Name@Example.COM  ",
    phoneNumber: "  +1 555 0100  ",
    credentialBoundAt: " 2026-04-10T00:00:00.000Z ",
    privacyConsentAt: " 2026-04-09T00:00:00.000Z ",
    phoneNumberBoundAt: " 2026-04-08T00:00:00.000Z ",
    banExpiry: " 2026-05-01T00:00:00.000Z ",
    banReason: "  repeated abuse  ",
    lastRoomId: "  room-7  ",
    lastSeenAt: " 2026-04-10T12:30:00.000Z ",
    seasonBadges: ["  founder  ", "founder", "  beta "]
  });

  assert.equal(account.playerId, "player-123");
  assert.equal(account.displayName, "Veil Runner");
  assert.equal(account.avatarUrl, "https://cdn.example/avatar.png");
  assert.equal(account.loginId, "player.name@example.com");
  assert.equal(account.phoneNumber, "+1 555 0100");
  assert.equal(account.credentialBoundAt, "2026-04-10T00:00:00.000Z");
  assert.equal(account.privacyConsentAt, "2026-04-09T00:00:00.000Z");
  assert.equal(account.phoneNumberBoundAt, "2026-04-08T00:00:00.000Z");
  assert.equal(account.banExpiry, "2026-05-01T00:00:00.000Z");
  assert.equal(account.banReason, "repeated abuse");
  assert.equal(account.lastRoomId, "room-7");
  assert.equal(account.lastSeenAt, "2026-04-10T12:30:00.000Z");
  assert.deepEqual(account.seasonBadges, ["founder", "beta"]);
});

test("player account read model normalizes ban status and validates YYYY-MM-DD play dates", () => {
  const defaults = normalizePlayerAccountReadModel({
    playerId: "player-ban-default",
    banStatus: "none",
    lastPlayDate: "2026-4-9"
  });
  const temporary = normalizePlayerAccountReadModel({
    playerId: "player-ban-temporary",
    banStatus: "temporary",
    lastPlayDate: " 2026-04-09 "
  });
  const permanent = normalizePlayerAccountReadModel({
    playerId: "player-ban-permanent",
    banStatus: "permanent"
  });
  const invalid = normalizePlayerAccountReadModel({
    playerId: "player-ban-invalid",
    banStatus: "temporary " as "temporary",
    lastPlayDate: "not-a-date"
  });

  assert.equal(defaults.banStatus, undefined);
  assert.equal(defaults.lastPlayDate, undefined);
  assert.equal(temporary.banStatus, "temporary");
  assert.equal(temporary.lastPlayDate, "2026-04-09");
  assert.equal(permanent.banStatus, "permanent");
  assert.equal(invalid.banStatus, undefined);
  assert.equal(invalid.lastPlayDate, undefined);
});

test("player account read model clamps numeric fields to supported minimums", () => {
  const account = normalizePlayerAccountReadModel({
    playerId: "player-clamp",
    gems: -3.8,
    loginStreak: -4.7,
    seasonXp: -9.2,
    seasonPassTier: -12.4,
    dailyPlayMinutes: -15.6,
    globalResources: {
      gold: -1.2,
      wood: 3.9,
      ore: -8.4
    }
  });

  assert.equal(account.gems, 0);
  assert.equal(account.loginStreak, undefined);
  assert.equal(account.seasonXp, undefined);
  assert.equal(account.seasonPassTier, undefined);
  assert.equal(account.dailyPlayMinutes, undefined);
  assert.deepEqual(account.globalResources, {
    gold: 0,
    wood: 3,
    ore: 0
  });
});

test("player account read model deduplicates, filters, and sorts claimed season pass tiers", () => {
  const account = normalizePlayerAccountReadModel({
    playerId: "player-pass",
    seasonPassClaimedTiers: [8, 2.9, 4, 8, 1, -3, 4.1, Number.NaN, Number.POSITIVE_INFINITY, 2]
  });

  assert.deepEqual(account.seasonPassClaimedTiers, [1, 2, 4, 8]);
});
