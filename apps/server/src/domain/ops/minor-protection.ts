import type { PlayerAccountSnapshot } from "@server/persistence";

const DEFAULT_MINOR_PROTECTION_TIME_ZONE = "Asia/Shanghai";
const DEFAULT_MINOR_WEEKDAY_LIMIT_MINUTES = 90;
const DEFAULT_MINOR_HOLIDAY_LIMIT_MINUTES = 180;
const DEFAULT_MINOR_LOCKOUT_START_HOUR = 22;
const DEFAULT_MINOR_LOCKOUT_END_HOUR = 8;

export interface MinorProtectionConfig {
  timeZone: string;
  weekdayDailyLimitMinutes: number;
  holidayDailyLimitMinutes: number;
  restrictedStartHour: number;
  restrictedEndHour: number;
  holidayDates: Set<string>;
}

export interface MinorProtectionState {
  enforced: boolean;
  localDate: string;
  normalizedDailyPlayMinutes: number;
  dailyLimitMinutes: number;
  restrictedHours: boolean;
  dailyLimitReached: boolean;
}

export interface MinorProtectionEvaluation extends MinorProtectionState {
  wouldBlock: boolean;
  reason: "minor_restricted_hours" | "minor_daily_limit_reached" | null;
}

export interface MinorProtectionBlockDetails extends MinorProtectionEvaluation {
  currentServerTime: string;
  currentLocalTime: string;
  timeZone: string;
  restrictedWindow: {
    startHour: number;
    endHour: number;
  };
  remainingDailyMinutes: number;
  nextAllowedAt: string | null;
  nextAllowedLocalTime: string | null;
  nextAllowedCountdownSeconds: number | null;
}

function parseEnvInteger(value: string | undefined, fallback: number, minimum: number, maximum?: number): number {
  const parsed = Number(value?.trim());
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const normalized = Math.floor(parsed);
  if (normalized < minimum) {
    return fallback;
  }

  if (maximum != null && normalized > maximum) {
    return fallback;
  }

  return normalized;
}

function getDateParts(date: Date, timeZone: string): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  return {
    year: parts.find((part) => part.type === "year")?.value ?? "1970",
    month: parts.find((part) => part.type === "month")?.value ?? "01",
    day: parts.find((part) => part.type === "day")?.value ?? "01"
  };
}

function getHourInTimeZone(date: Date, timeZone: string): number {
  const hourPart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23"
  })
    .formatToParts(date)
    .find((part) => part.type === "hour")?.value;

  return Number(hourPart ?? "0");
}

function getMinuteInTimeZone(date: Date, timeZone: string): number {
  const minutePart = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "2-digit"
  })
    .formatToParts(date)
    .find((part) => part.type === "minute")?.value;

  return Number(minutePart ?? "0");
}

function getWeekdayInTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short"
  }).format(date);
}

function normalizeDateKey(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function formatLocalTime(date: Date, timeZone: string): string {
  const hour = String(getHourInTimeZone(date, timeZone)).padStart(2, "0");
  const minute = String(getMinuteInTimeZone(date, timeZone)).padStart(2, "0");
  return `${hour}:${minute}`;
}

function parseBirthdate(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function getNumericDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  const parts = getDateParts(date, timeZone);
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day)
  };
}

function compareDateParts(
  left: { year: number; month: number; day: number },
  right: { year: number; month: number; day: number }
): number {
  if (left.year !== right.year) {
    return left.year - right.year;
  }
  if (left.month !== right.month) {
    return left.month - right.month;
  }
  return left.day - right.day;
}

function deriveAgeFromBirthdate(
  birthdate: { year: number; month: number; day: number },
  now: Date,
  timeZone: string
): number {
  const today = getNumericDateParts(now, timeZone);
  let age = today.year - birthdate.year;
  if (today.month < birthdate.month || (today.month === birthdate.month && today.day < birthdate.day)) {
    age -= 1;
  }
  return age;
}

function isMinorAgeRange(ageRange: string): boolean | undefined {
  const normalized = ageRange.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (normalized.includes("adult") || normalized.includes("18+")) {
    return false;
  }

  if (normalized.includes("minor") || normalized.includes("under18") || normalized.includes("<18")) {
    return true;
  }

  const rangeMatch = normalized.match(/^(\d{1,2})\s*[-~]\s*(\d{1,2})$/);
  if (!rangeMatch) {
    return undefined;
  }

  const maxAge = Number(rangeMatch[2]);
  if (!Number.isFinite(maxAge)) {
    return undefined;
  }

  return maxAge < 18;
}

export function readMinorProtectionConfig(env: NodeJS.ProcessEnv = process.env): MinorProtectionConfig {
  const holidayDates = new Set(
    (env.VEIL_MINOR_PROTECTION_HOLIDAY_DATES ?? "")
      .split(",")
      .map((value) => normalizeDateKey(value))
      .filter((value): value is string => Boolean(value))
  );

  return {
    timeZone: env.VEIL_MINOR_PROTECTION_TIME_ZONE?.trim() || DEFAULT_MINOR_PROTECTION_TIME_ZONE,
    weekdayDailyLimitMinutes: parseEnvInteger(
      env.VEIL_MINOR_PROTECTION_WEEKDAY_LIMIT_MINUTES,
      DEFAULT_MINOR_WEEKDAY_LIMIT_MINUTES,
      1
    ),
    holidayDailyLimitMinutes: parseEnvInteger(
      env.VEIL_MINOR_PROTECTION_HOLIDAY_LIMIT_MINUTES,
      DEFAULT_MINOR_HOLIDAY_LIMIT_MINUTES,
      1
    ),
    restrictedStartHour: parseEnvInteger(
      env.VEIL_MINOR_PROTECTION_RESTRICTED_START_HOUR,
      DEFAULT_MINOR_LOCKOUT_START_HOUR,
      0,
      23
    ),
    restrictedEndHour: parseEnvInteger(
      env.VEIL_MINOR_PROTECTION_RESTRICTED_END_HOUR,
      DEFAULT_MINOR_LOCKOUT_END_HOUR,
      0,
      23
    ),
    holidayDates
  };
}

export function getMinorProtectionDateKey(date: Date, timeZone: string): string {
  const parts = getDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function deriveMinorProtectionState(
  account: Pick<PlayerAccountSnapshot, "isMinor" | "dailyPlayMinutes" | "lastPlayDate">,
  now = new Date(),
  config = readMinorProtectionConfig()
): MinorProtectionState {
  const localDate = getMinorProtectionDateKey(now, config.timeZone);
  const normalizedDailyPlayMinutes =
    account.lastPlayDate === localDate ? Math.max(0, Math.floor(account.dailyPlayMinutes ?? 0)) : 0;
  const weekday = getWeekdayInTimeZone(now, config.timeZone);
  const isHoliday = config.holidayDates.has(localDate) || weekday === "Sat" || weekday === "Sun";
  const dailyLimitMinutes = isHoliday ? config.holidayDailyLimitMinutes : config.weekdayDailyLimitMinutes;
  const hour = getHourInTimeZone(now, config.timeZone);
  const restrictedHours =
    config.restrictedStartHour > config.restrictedEndHour
      ? hour >= config.restrictedStartHour || hour < config.restrictedEndHour
      : hour >= config.restrictedStartHour && hour < config.restrictedEndHour;

  return {
    enforced: account.isMinor === true,
    localDate,
    normalizedDailyPlayMinutes,
    dailyLimitMinutes,
    restrictedHours,
    dailyLimitReached: normalizedDailyPlayMinutes >= dailyLimitMinutes
  };
}

export function evaluateMinorProtectionState(
  account: Pick<PlayerAccountSnapshot, "isMinor" | "dailyPlayMinutes" | "lastPlayDate">,
  now = new Date(),
  config = readMinorProtectionConfig()
): MinorProtectionEvaluation {
  const state = deriveMinorProtectionState(account, now, config);
  const wouldBlock = state.enforced && (state.restrictedHours || state.dailyLimitReached);

  return {
    ...state,
    wouldBlock,
    reason: !wouldBlock ? null : state.restrictedHours ? "minor_restricted_hours" : "minor_daily_limit_reached"
  };
}

export function normalizeMinorProtectionBirthdate(
  value: string,
  now = new Date(),
  config = readMinorProtectionConfig()
): string {
  const normalized = value.trim();
  const birthdate = parseBirthdate(normalized);
  if (!birthdate) {
    throw new Error('Expected optional string field: birthdate in "YYYY-MM-DD" format');
  }

  const today = getNumericDateParts(now, config.timeZone);
  if (compareDateParts(birthdate, today) > 0) {
    throw new Error("birthdate cannot be in the future");
  }

  const age = deriveAgeFromBirthdate(birthdate, now, config.timeZone);
  if (age > 120) {
    throw new Error("birthdate must be within the past 120 years");
  }

  return normalized;
}

export function findNextAllowedMinorProtectionTime(
  account: Pick<PlayerAccountSnapshot, "isMinor" | "dailyPlayMinutes" | "lastPlayDate">,
  now = new Date(),
  config = readMinorProtectionConfig()
): Date | null {
  const current = evaluateMinorProtectionState(account, now, config);
  if (!current.wouldBlock) {
    return now;
  }

  for (let minutes = 1; minutes <= 48 * 60; minutes += 1) {
    const candidate = new Date(now.getTime() + minutes * 60_000);
    if (!evaluateMinorProtectionState(account, candidate, config).wouldBlock) {
      return candidate;
    }
  }

  return null;
}

export function buildMinorProtectionBlockDetails(
  account: Pick<PlayerAccountSnapshot, "isMinor" | "dailyPlayMinutes" | "lastPlayDate">,
  now = new Date(),
  config = readMinorProtectionConfig()
): MinorProtectionBlockDetails {
  const evaluation = evaluateMinorProtectionState(account, now, config);
  const nextAllowedAt = evaluation.wouldBlock ? findNextAllowedMinorProtectionTime(account, now, config) : now;

  return {
    ...evaluation,
    currentServerTime: now.toISOString(),
    currentLocalTime: formatLocalTime(now, config.timeZone),
    timeZone: config.timeZone,
    restrictedWindow: {
      startHour: config.restrictedStartHour,
      endHour: config.restrictedEndHour
    },
    remainingDailyMinutes: Math.max(0, evaluation.dailyLimitMinutes - evaluation.normalizedDailyPlayMinutes),
    nextAllowedAt: nextAllowedAt?.toISOString() ?? null,
    nextAllowedLocalTime: nextAllowedAt ? formatLocalTime(nextAllowedAt, config.timeZone) : null,
    nextAllowedCountdownSeconds:
      nextAllowedAt == null ? null : Math.max(0, Math.ceil((nextAllowedAt.getTime() - now.getTime()) / 1000))
  };
}

export function deriveWechatMinorProtection(
  input: {
    birthdate?: string | null;
    ageVerified?: boolean | null;
    isAdult?: boolean | null;
    ageRange?: string | null;
  },
  now = new Date(),
  config = readMinorProtectionConfig()
): { ageVerified?: boolean; isMinor?: boolean } {
  if (typeof input.birthdate === "string") {
    const normalizedBirthdate = normalizeMinorProtectionBirthdate(input.birthdate, now, config);
    const birthdate = parseBirthdate(normalizedBirthdate);
    return {
      ageVerified: true,
      isMinor: birthdate != null && deriveAgeFromBirthdate(birthdate, now, config.timeZone) < 18
    };
  }

  if (typeof input.isAdult === "boolean") {
    return {
      ageVerified: true,
      isMinor: !input.isAdult
    };
  }

  if (typeof input.ageRange === "string") {
    const isMinor = isMinorAgeRange(input.ageRange);
    if (typeof isMinor === "boolean") {
      return {
        ageVerified: true,
        isMinor
      };
    }
  }

  if (typeof input.ageVerified === "boolean") {
    return {
      ageVerified: input.ageVerified
    };
  }

  return {};
}
