import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type LaunchAnnouncementTone = "info" | "warning" | "critical";

export interface LaunchAnnouncementRecord {
  id: string;
  title: string;
  message: string;
  tone: LaunchAnnouncementTone;
  startsAt: string;
  endsAt?: string;
}

export interface LaunchMaintenanceModeRecord {
  enabled: boolean;
  title: string;
  message: string;
  nextOpenAt?: string;
  whitelistPlayerIds: string[];
  whitelistLoginIds: string[];
}

export interface LaunchRuntimeState {
  announcements: LaunchAnnouncementRecord[];
  maintenanceMode: LaunchMaintenanceModeRecord;
  updatedAt: string;
}

export interface LaunchRuntimeStateStorage {
  loadLaunchRuntimeState(now?: Date): Promise<LaunchRuntimeState>;
  saveLaunchRuntimeState(state: LaunchRuntimeState): Promise<LaunchRuntimeState>;
}

export interface LaunchMaintenanceAccessInput {
  playerId?: string | null;
  loginId?: string | null;
  now?: string | Date;
}

export interface LaunchMaintenanceAccessResult {
  active: boolean;
  blocked: boolean;
  title: string;
  message: string;
  nextOpenAt?: string;
}

const DEFAULT_RUNTIME_STATE: LaunchRuntimeState = {
  announcements: [],
  maintenanceMode: {
    enabled: false,
    title: "停服维护中",
    message: "服务器正在维护，请稍后再试。",
    whitelistPlayerIds: [],
    whitelistLoginIds: []
  },
  updatedAt: "1970-01-01T00:00:00.000Z"
};

let configuredLaunchRuntimeStateStorage: LaunchRuntimeStateStorage | null = null;

export function configureLaunchRuntimeStateStorage(storage: LaunchRuntimeStateStorage | null): void {
  configuredLaunchRuntimeStateStorage = storage;
}

function normalizeTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => normalizeTrimmedString(entry))
        .filter((entry): entry is string => Boolean(entry))
    )
  ).sort((left, right) => left.localeCompare(right));
}

function normalizeIsoTimestamp(value: unknown, fallback: string): string {
  const normalized = normalizeTrimmedString(value);
  if (!normalized) {
    return fallback;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.valueOf()) ? fallback : parsed.toISOString();
}

function normalizeAnnouncementTone(value: unknown): LaunchAnnouncementTone {
  return value === "warning" || value === "critical" ? value : "info";
}

export function createDefaultLaunchRuntimeState(now = new Date()): LaunchRuntimeState {
  return {
    announcements: [],
    maintenanceMode: structuredClone(DEFAULT_RUNTIME_STATE.maintenanceMode),
    updatedAt: now.toISOString()
  };
}

export function normalizeLaunchRuntimeState(input: unknown, now = new Date()): LaunchRuntimeState {
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const announcementCandidates = Array.isArray(candidate.announcements) ? candidate.announcements : [];
  const announcements = announcementCandidates
    .map((entry, index) => {
      const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
      const id = normalizeTrimmedString(record.id) ?? `announcement-${index + 1}`;
      const title = normalizeTrimmedString(record.title);
      const message = normalizeTrimmedString(record.message);
      if (!title || !message) {
        return null;
      }

      const startsAt = normalizeIsoTimestamp(record.startsAt, now.toISOString());
      const endsAt = normalizeTrimmedString(record.endsAt);
      const normalizedEndsAt = endsAt ? normalizeIsoTimestamp(endsAt, startsAt) : undefined;
      if (normalizedEndsAt && new Date(normalizedEndsAt).valueOf() < new Date(startsAt).valueOf()) {
        return null;
      }

      return {
        id,
        title,
        message,
        tone: normalizeAnnouncementTone(record.tone),
        startsAt,
        ...(normalizedEndsAt ? { endsAt: normalizedEndsAt } : {})
      } satisfies LaunchAnnouncementRecord;
    })
    .filter((entry): entry is LaunchAnnouncementRecord => Boolean(entry))
    .sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id));

  const maintenanceCandidate =
    candidate.maintenanceMode && typeof candidate.maintenanceMode === "object"
      ? (candidate.maintenanceMode as Record<string, unknown>)
      : {};

  return {
    announcements,
    maintenanceMode: {
      enabled: maintenanceCandidate.enabled === true,
      title: normalizeTrimmedString(maintenanceCandidate.title) ?? DEFAULT_RUNTIME_STATE.maintenanceMode.title,
      message: normalizeTrimmedString(maintenanceCandidate.message) ?? DEFAULT_RUNTIME_STATE.maintenanceMode.message,
      ...(normalizeTrimmedString(maintenanceCandidate.nextOpenAt)
        ? { nextOpenAt: normalizeIsoTimestamp(maintenanceCandidate.nextOpenAt, now.toISOString()) }
        : {}),
      whitelistPlayerIds: normalizeStringList(maintenanceCandidate.whitelistPlayerIds),
      whitelistLoginIds: normalizeStringList(maintenanceCandidate.whitelistLoginIds)
    },
    updatedAt: normalizeIsoTimestamp(candidate.updatedAt, now.toISOString())
  };
}

export function readLaunchRuntimeStatePath(env: NodeJS.ProcessEnv = process.env): string {
  const configured = normalizeTrimmedString(env.VEIL_ANNOUNCEMENTS_CONFIG);
  return configured ?? join(process.cwd(), "configs", "announcements.json");
}

export async function loadLaunchRuntimeState(
  filePath?: string,
  now = new Date()
): Promise<LaunchRuntimeState> {
  if (!filePath && configuredLaunchRuntimeStateStorage) {
    return configuredLaunchRuntimeStateStorage.loadLaunchRuntimeState(now);
  }
  const resolvedFilePath = filePath ?? readLaunchRuntimeStatePath();
  try {
    const raw = await readFile(resolvedFilePath, "utf8");
    return normalizeLaunchRuntimeState(JSON.parse(raw), now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultLaunchRuntimeState(now);
    }
    throw error;
  }
}

export async function saveLaunchRuntimeState(
  state: LaunchRuntimeState,
  filePath?: string
): Promise<LaunchRuntimeState> {
  if (!filePath && configuredLaunchRuntimeStateStorage) {
    return configuredLaunchRuntimeStateStorage.saveLaunchRuntimeState(state);
  }
  const resolvedFilePath = filePath ?? readLaunchRuntimeStatePath();
  const normalized = normalizeLaunchRuntimeState(state, new Date());
  await mkdir(dirname(resolvedFilePath), { recursive: true });
  await writeFile(resolvedFilePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function toEpochMs(input?: string | Date): number {
  if (!input) {
    return Date.now();
  }
  const value = input instanceof Date ? input.valueOf() : new Date(input).valueOf();
  return Number.isNaN(value) ? Date.now() : value;
}

export function resolveActiveLaunchAnnouncements(
  state: LaunchRuntimeState,
  now: string | Date = new Date()
): LaunchAnnouncementRecord[] {
  const nowMs = toEpochMs(now);
  return state.announcements.filter((announcement) => {
    const startMs = toEpochMs(announcement.startsAt);
    const endMs = announcement.endsAt ? toEpochMs(announcement.endsAt) : Number.POSITIVE_INFINITY;
    return startMs <= nowMs && nowMs <= endMs;
  });
}

export function resolveLaunchMaintenanceAccess(
  state: LaunchRuntimeState,
  input: LaunchMaintenanceAccessInput = {}
): LaunchMaintenanceAccessResult {
  const maintenance = state.maintenanceMode;
  const nowMs = toEpochMs(input.now);
  const nextOpenAt = normalizeTrimmedString(maintenance.nextOpenAt ?? null);
  const maintenanceStillActive =
    maintenance.enabled && (!nextOpenAt || toEpochMs(nextOpenAt) > nowMs);
  const normalizedPlayerId = normalizeTrimmedString(input.playerId) ?? "";
  const normalizedLoginId = normalizeTrimmedString(input.loginId)?.toLowerCase() ?? "";
  const whitelisted =
    (normalizedPlayerId.length > 0 && maintenance.whitelistPlayerIds.includes(normalizedPlayerId)) ||
    (normalizedLoginId.length > 0 && maintenance.whitelistLoginIds.includes(normalizedLoginId));

  return {
    active: maintenanceStillActive,
    blocked: maintenanceStillActive && !whitelisted,
    title: maintenance.title,
    message: maintenance.message,
    ...(nextOpenAt ? { nextOpenAt } : {})
  };
}
