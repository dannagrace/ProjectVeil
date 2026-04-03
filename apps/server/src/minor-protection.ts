import type { PlayerAccountSnapshot } from "./persistence";

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

export function deriveWechatMinorProtection(input: {
  ageVerified?: boolean | null;
  isAdult?: boolean | null;
  ageRange?: string | null;
}): { ageVerified?: boolean; isMinor?: boolean } {
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
