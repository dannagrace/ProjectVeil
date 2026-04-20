import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMinorProtectionBlockDetails,
  deriveMinorProtectionState,
  deriveWechatMinorProtection,
  evaluateMinorProtectionState,
  findNextAllowedMinorProtectionTime,
  getMinorProtectionDateKey,
  normalizeMinorProtectionBirthdate,
  readMinorProtectionConfig
} from "@server/domain/ops/minor-protection";

test("readMinorProtectionConfig uses defaults when env is empty", () => {
  const config = readMinorProtectionConfig({});

  assert.equal(config.timeZone, "Asia/Shanghai");
  assert.equal(config.weekdayDailyLimitMinutes, 90);
  assert.equal(config.holidayDailyLimitMinutes, 180);
  assert.equal(config.restrictedStartHour, 22);
  assert.equal(config.restrictedEndHour, 8);
  assert.deepEqual([...config.holidayDates], []);
});

test("readMinorProtectionConfig normalizes valid overrides and ignores invalid values", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_TIME_ZONE: "  UTC ",
    VEIL_MINOR_PROTECTION_WEEKDAY_LIMIT_MINUTES: " 120.9 ",
    VEIL_MINOR_PROTECTION_HOLIDAY_LIMIT_MINUTES: "0",
    VEIL_MINOR_PROTECTION_RESTRICTED_START_HOUR: "24",
    VEIL_MINOR_PROTECTION_RESTRICTED_END_HOUR: "6.7",
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: "2026-04-04, invalid, 2026-04-05 ,2026-4-6"
  });

  assert.equal(config.timeZone, "UTC");
  assert.equal(config.weekdayDailyLimitMinutes, 120);
  assert.equal(config.holidayDailyLimitMinutes, 180);
  assert.equal(config.restrictedStartHour, 22);
  assert.equal(config.restrictedEndHour, 6);
  assert.deepEqual([...config.holidayDates], ["2026-04-04", "2026-04-05"]);
});

test("getMinorProtectionDateKey resolves the local day in the configured time zone", () => {
  const date = new Date("2026-04-03T16:30:00.000Z");

  assert.equal(getMinorProtectionDateKey(date, "Asia/Shanghai"), "2026-04-04");
  assert.equal(getMinorProtectionDateKey(date, "UTC"), "2026-04-03");
});

test("deriveMinorProtectionState resets play minutes when the stored day is stale", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai",
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: ""
  });

  const state = deriveMinorProtectionState(
    {
      isMinor: true,
      dailyPlayMinutes: 75,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-04T02:00:00.000Z"),
    config
  );

  assert.deepEqual(state, {
    enforced: true,
    localDate: "2026-04-04",
    normalizedDailyPlayMinutes: 0,
    dailyLimitMinutes: 180,
    restrictedHours: false,
    dailyLimitReached: false
  });
});

test("deriveMinorProtectionState clamps negative minutes and applies same-day weekday restrictions", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai",
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: ""
  });

  const state = deriveMinorProtectionState(
    {
      isMinor: false,
      dailyPlayMinutes: -12.4,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-03T14:30:00.000Z"),
    config
  );

  assert.deepEqual(state, {
    enforced: false,
    localDate: "2026-04-03",
    normalizedDailyPlayMinutes: 0,
    dailyLimitMinutes: 90,
    restrictedHours: true,
    dailyLimitReached: false
  });
});

test("deriveMinorProtectionState supports non-wrapping restricted hour windows", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_TIME_ZONE: "UTC",
    VEIL_MINOR_PROTECTION_RESTRICTED_START_HOUR: "8",
    VEIL_MINOR_PROTECTION_RESTRICTED_END_HOUR: "20",
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: ""
  });

  const state = deriveMinorProtectionState(
    {
      isMinor: true,
      dailyPlayMinutes: 30,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-03T12:00:00.000Z"),
    config
  );

  assert.equal(state.restrictedHours, true);
  assert.equal(state.dailyLimitMinutes, 90);
  assert.equal(state.dailyLimitReached, false);
});

test("evaluateMinorProtectionState returns no block for adults even during restricted hours", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai",
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: ""
  });

  const evaluation = evaluateMinorProtectionState(
    {
      isMinor: false,
      dailyPlayMinutes: 500,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-03T14:30:00.000Z"),
    config
  );

  assert.equal(evaluation.wouldBlock, false);
  assert.equal(evaluation.reason, null);
});

test("evaluateMinorProtectionState prefers restricted-hours reason when both rules block", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai",
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: ""
  });

  const evaluation = evaluateMinorProtectionState(
    {
      isMinor: true,
      dailyPlayMinutes: 90,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-03T14:30:00.000Z"),
    config
  );

  assert.equal(evaluation.restrictedHours, true);
  assert.equal(evaluation.dailyLimitReached, true);
  assert.equal(evaluation.wouldBlock, true);
  assert.equal(evaluation.reason, "minor_restricted_hours");
});

test("normalizeMinorProtectionBirthdate rejects impossible or future dates", () => {
  assert.throws(() => normalizeMinorProtectionBirthdate("2026-02-30", new Date("2026-04-03T00:00:00.000Z")), {
    message: 'Expected optional string field: birthdate in "YYYY-MM-DD" format'
  });
  assert.throws(() => normalizeMinorProtectionBirthdate("2026-04-04", new Date("2026-04-03T00:00:00.000Z")), {
    message: "birthdate cannot be in the future"
  });
});

test("deriveWechatMinorProtection derives minor status from self-declared birthdate", () => {
  assert.deepEqual(
    deriveWechatMinorProtection(
      {
        birthdate: "2009-04-04",
        isAdult: true
      },
      new Date("2026-04-03T16:00:00.000Z")
    ),
    {
      ageVerified: true,
      isMinor: true
    }
  );
});

test("deriveWechatMinorProtection prioritizes isAdult over legacy fields", () => {
  assert.deepEqual(
    deriveWechatMinorProtection({
      ageVerified: false,
      isAdult: false,
      ageRange: "adult"
    }),
    {
      ageVerified: true,
      isMinor: true
    }
  );
});

test("deriveWechatMinorProtection derives minor status from supported age ranges", () => {
  assert.deepEqual(deriveWechatMinorProtection({ ageRange: "13-17" }), {
    ageVerified: true,
    isMinor: true
  });
  assert.deepEqual(deriveWechatMinorProtection({ ageRange: "18+" }), {
    ageVerified: true,
    isMinor: false
  });
  assert.deepEqual(deriveWechatMinorProtection({ ageRange: "unknown", ageVerified: true }), {
    ageVerified: true
  });
  assert.deepEqual(deriveWechatMinorProtection({}), {});
});

test("findNextAllowedMinorProtectionTime resolves the next local 08:00 window during curfew", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai",
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: ""
  });

  const nextAllowedAt = findNextAllowedMinorProtectionTime(
    {
      isMinor: true,
      dailyPlayMinutes: 20,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-03T14:30:00.000Z"),
    config
  );

  assert.equal(nextAllowedAt?.toISOString(), "2026-04-04T00:00:00.000Z");
});

test("buildMinorProtectionBlockDetails includes countdown metadata", () => {
  const config = readMinorProtectionConfig({
    VEIL_MINOR_PROTECTION_TIME_ZONE: "Asia/Shanghai",
    VEIL_MINOR_PROTECTION_HOLIDAY_DATES: ""
  });

  const details = buildMinorProtectionBlockDetails(
    {
      isMinor: true,
      dailyPlayMinutes: 20,
      lastPlayDate: "2026-04-03"
    },
    new Date("2026-04-03T14:30:00.000Z"),
    config
  );

  assert.deepEqual(details, {
    enforced: true,
    localDate: "2026-04-03",
    normalizedDailyPlayMinutes: 20,
    dailyLimitMinutes: 90,
    restrictedHours: true,
    dailyLimitReached: false,
    wouldBlock: true,
    reason: "minor_restricted_hours",
    currentServerTime: "2026-04-03T14:30:00.000Z",
    currentLocalTime: "22:30",
    timeZone: "Asia/Shanghai",
    restrictedWindow: {
      startHour: 22,
      endHour: 8
    },
    remainingDailyMinutes: 70,
    nextAllowedAt: "2026-04-04T00:00:00.000Z",
    nextAllowedLocalTime: "08:00",
    nextAllowedCountdownSeconds: 34200
  });
});
