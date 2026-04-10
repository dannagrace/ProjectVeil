import assert from "node:assert/strict";
import test from "node:test";
import {
  readMinorProtectionConfig,
  getMinorProtectionDateKey,
  deriveMinorProtectionState,
  evaluateMinorProtectionState,
  deriveWechatMinorProtection,
} from "../src/minor-protection";

function makeAccount(opts: { isMinor?: boolean; dailyPlayMinutes?: number; lastPlayDate?: string } = {}) {
  return { isMinor: opts.isMinor ?? false, dailyPlayMinutes: opts.dailyPlayMinutes ?? 0, lastPlayDate: opts.lastPlayDate };
}

// Fixed timestamps for deterministic tests
// 2026-04-10T02:00:00.000Z = 10:00 Asia/Shanghai (daytime, within allowed hours)
const DAYTIME = new Date("2026-04-10T02:00:00.000Z");
// 2026-04-10T14:30:00.000Z = 22:30 Asia/Shanghai (restricted: >= 22)
const NIGHTTIME_RESTRICTED = new Date("2026-04-10T14:30:00.000Z");
// 2026-04-10T23:00:00.000Z = 07:00 Asia/Shanghai (restricted: < 8)
const MORNING_RESTRICTED = new Date("2026-04-10T23:00:00.000Z");

const DEFAULT_CONFIG = readMinorProtectionConfig({});

// ─── readMinorProtectionConfig ───────────────────────────────────────────────

test("readMinorProtectionConfig: empty env → default values", () => {
  const config = readMinorProtectionConfig({});
  assert.equal(config.timeZone, "Asia/Shanghai");
  assert.equal(config.weekdayDailyLimitMinutes, 90);
  assert.equal(config.holidayDailyLimitMinutes, 180);
  assert.equal(config.restrictedStartHour, 22);
  assert.equal(config.restrictedEndHour, 8);
  assert.equal(config.holidayDates.size, 0);
});

test("readMinorProtectionConfig: VEIL_MINOR_PROTECTION_WEEKDAY_LIMIT_MINUTES=60 → 60", () => {
  const config = readMinorProtectionConfig({ VEIL_MINOR_PROTECTION_WEEKDAY_LIMIT_MINUTES: "60" });
  assert.equal(config.weekdayDailyLimitMinutes, 60);
});

test("readMinorProtectionConfig: VEIL_MINOR_PROTECTION_HOLIDAY_LIMIT_MINUTES=120 → 120", () => {
  const config = readMinorProtectionConfig({ VEIL_MINOR_PROTECTION_HOLIDAY_LIMIT_MINUTES: "120" });
  assert.equal(config.holidayDailyLimitMinutes, 120);
});

test("readMinorProtectionConfig: VEIL_MINOR_PROTECTION_RESTRICTED_START_HOUR=23 → 23", () => {
  const config = readMinorProtectionConfig({ VEIL_MINOR_PROTECTION_RESTRICTED_START_HOUR: "23" });
  assert.equal(config.restrictedStartHour, 23);
});

test("readMinorProtectionConfig: VEIL_MINOR_PROTECTION_RESTRICTED_END_HOUR=7 → 7", () => {
  const config = readMinorProtectionConfig({ VEIL_MINOR_PROTECTION_RESTRICTED_END_HOUR: "7" });
  assert.equal(config.restrictedEndHour, 7);
});

test("readMinorProtectionConfig: VEIL_MINOR_PROTECTION_HOLIDAY_DATES → holidayDates set", () => {
  const config = readMinorProtectionConfig({ VEIL_MINOR_PROTECTION_HOLIDAY_DATES: "2026-06-01,2026-10-01" });
  assert.ok(config.holidayDates.has("2026-06-01"));
  assert.ok(config.holidayDates.has("2026-10-01"));
  assert.equal(config.holidayDates.size, 2);
});

test("readMinorProtectionConfig: invalid 'abc' for numeric env var → falls back to default", () => {
  const config = readMinorProtectionConfig({ VEIL_MINOR_PROTECTION_WEEKDAY_LIMIT_MINUTES: "abc" });
  assert.equal(config.weekdayDailyLimitMinutes, 90);
});

test("readMinorProtectionConfig: VEIL_MINOR_PROTECTION_TIME_ZONE=UTC → timeZone=UTC", () => {
  const config = readMinorProtectionConfig({ VEIL_MINOR_PROTECTION_TIME_ZONE: "UTC" });
  assert.equal(config.timeZone, "UTC");
});

// ─── getMinorProtectionDateKey ───────────────────────────────────────────────

test("getMinorProtectionDateKey: 2026-04-10T12:00:00Z in UTC → '2026-04-10'", () => {
  const date = new Date("2026-04-10T12:00:00.000Z");
  assert.equal(getMinorProtectionDateKey(date, "UTC"), "2026-04-10");
});

test("getMinorProtectionDateKey: 2026-04-10T20:00:00Z in America/New_York (16:00 EDT) → '2026-04-10'", () => {
  const date = new Date("2026-04-10T20:00:00.000Z");
  assert.equal(getMinorProtectionDateKey(date, "America/New_York"), "2026-04-10");
});

test("getMinorProtectionDateKey: 2026-04-10T00:30:00Z in Asia/Shanghai (08:30) → '2026-04-10'", () => {
  const date = new Date("2026-04-10T00:30:00.000Z");
  assert.equal(getMinorProtectionDateKey(date, "Asia/Shanghai"), "2026-04-10");
});

// ─── deriveMinorProtectionState ─────────────────────────────────────────────

test("deriveMinorProtectionState: non-minor account → enforced=false", () => {
  const state = deriveMinorProtectionState(makeAccount({ isMinor: false }), DAYTIME, DEFAULT_CONFIG);
  assert.equal(state.enforced, false);
});

test("deriveMinorProtectionState: minor, daytime 10:00 Shanghai, below limit → enforced=true, restrictedHours=false, dailyLimitReached=false", () => {
  const account = makeAccount({ isMinor: true, dailyPlayMinutes: 30, lastPlayDate: "2026-04-10" });
  const state = deriveMinorProtectionState(account, DAYTIME, DEFAULT_CONFIG);
  assert.equal(state.enforced, true);
  assert.equal(state.restrictedHours, false);
  assert.equal(state.dailyLimitReached, false);
});

test("deriveMinorProtectionState: minor, 100 minutes played today (weekday limit=90) → dailyLimitReached=true", () => {
  const account = makeAccount({ isMinor: true, dailyPlayMinutes: 100, lastPlayDate: "2026-04-10" });
  const state = deriveMinorProtectionState(account, DAYTIME, DEFAULT_CONFIG);
  assert.equal(state.dailyLimitReached, true);
});

test("deriveMinorProtectionState: minor, lastPlayDate differs from localDate → normalizedDailyPlayMinutes=0 (reset)", () => {
  const account = makeAccount({ isMinor: true, dailyPlayMinutes: 80, lastPlayDate: "2026-04-09" });
  const state = deriveMinorProtectionState(account, DAYTIME, DEFAULT_CONFIG);
  assert.equal(state.normalizedDailyPlayMinutes, 0);
  assert.equal(state.dailyLimitReached, false);
});

test("deriveMinorProtectionState: minor, 22:30 Shanghai time → restrictedHours=true", () => {
  const account = makeAccount({ isMinor: true, dailyPlayMinutes: 0, lastPlayDate: "2026-04-10" });
  const state = deriveMinorProtectionState(account, NIGHTTIME_RESTRICTED, DEFAULT_CONFIG);
  assert.equal(state.restrictedHours, true);
});

test("deriveMinorProtectionState: minor, 07:00 Shanghai time (morning restricted, < 8) → restrictedHours=true", () => {
  const account = makeAccount({ isMinor: true, dailyPlayMinutes: 0, lastPlayDate: "2026-04-11" });
  const state = deriveMinorProtectionState(account, MORNING_RESTRICTED, DEFAULT_CONFIG);
  assert.equal(state.restrictedHours, true);
});

// ─── evaluateMinorProtectionState ───────────────────────────────────────────

test("evaluateMinorProtectionState: non-minor during restricted hours → wouldBlock=false, reason=null", () => {
  const account = makeAccount({ isMinor: false });
  const result = evaluateMinorProtectionState(account, NIGHTTIME_RESTRICTED, DEFAULT_CONFIG);
  assert.equal(result.wouldBlock, false);
  assert.equal(result.reason, null);
});

test("evaluateMinorProtectionState: minor during restricted hours → wouldBlock=true, reason='minor_restricted_hours'", () => {
  const account = makeAccount({ isMinor: true, dailyPlayMinutes: 0, lastPlayDate: "2026-04-10" });
  const result = evaluateMinorProtectionState(account, NIGHTTIME_RESTRICTED, DEFAULT_CONFIG);
  assert.equal(result.wouldBlock, true);
  assert.equal(result.reason, "minor_restricted_hours");
});

test("evaluateMinorProtectionState: minor over daily limit, daytime → wouldBlock=true, reason='minor_daily_limit_reached'", () => {
  const account = makeAccount({ isMinor: true, dailyPlayMinutes: 100, lastPlayDate: "2026-04-10" });
  const result = evaluateMinorProtectionState(account, DAYTIME, DEFAULT_CONFIG);
  assert.equal(result.wouldBlock, true);
  assert.equal(result.reason, "minor_daily_limit_reached");
});

test("evaluateMinorProtectionState: minor under limit, daytime → wouldBlock=false, reason=null", () => {
  const account = makeAccount({ isMinor: true, dailyPlayMinutes: 30, lastPlayDate: "2026-04-10" });
  const result = evaluateMinorProtectionState(account, DAYTIME, DEFAULT_CONFIG);
  assert.equal(result.wouldBlock, false);
  assert.equal(result.reason, null);
});

// ─── deriveWechatMinorProtection ─────────────────────────────────────────────

test("deriveWechatMinorProtection: isAdult=true → {ageVerified:true, isMinor:false}", () => {
  const result = deriveWechatMinorProtection({ isAdult: true });
  assert.deepEqual(result, { ageVerified: true, isMinor: false });
});

test("deriveWechatMinorProtection: isAdult=false → {ageVerified:true, isMinor:true}", () => {
  const result = deriveWechatMinorProtection({ isAdult: false });
  assert.deepEqual(result, { ageVerified: true, isMinor: true });
});

test("deriveWechatMinorProtection: ageRange='18+' → {ageVerified:true, isMinor:false}", () => {
  const result = deriveWechatMinorProtection({ ageRange: "18+" });
  assert.deepEqual(result, { ageVerified: true, isMinor: false });
});

test("deriveWechatMinorProtection: ageRange='minor' → {ageVerified:true, isMinor:true}", () => {
  const result = deriveWechatMinorProtection({ ageRange: "minor" });
  assert.deepEqual(result, { ageVerified: true, isMinor: true });
});

test("deriveWechatMinorProtection: ageRange='14-17' → {ageVerified:true, isMinor:true}", () => {
  const result = deriveWechatMinorProtection({ ageRange: "14-17" });
  assert.deepEqual(result, { ageVerified: true, isMinor: true });
});

test("deriveWechatMinorProtection: ageRange='18-25' → {ageVerified:true, isMinor:false}", () => {
  const result = deriveWechatMinorProtection({ ageRange: "18-25" });
  assert.deepEqual(result, { ageVerified: true, isMinor: false });
});

test("deriveWechatMinorProtection: ageVerified=true (no isAdult/ageRange) → {ageVerified:true} (no isMinor key)", () => {
  const result = deriveWechatMinorProtection({ ageVerified: true });
  assert.deepEqual(result, { ageVerified: true });
  assert.ok(!("isMinor" in result));
});

test("deriveWechatMinorProtection: all undefined → {}", () => {
  const result = deriveWechatMinorProtection({});
  assert.deepEqual(result, {});
});
