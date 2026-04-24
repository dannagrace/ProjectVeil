import type { IncomingMessage, ServerResponse } from "node:http";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  applySeasonalEventAdminPatch,
  type SeasonalEventRuntimeOverride
} from "@server/domain/battle/event-engine";
import {
  createDefaultLaunchRuntimeState,
  loadLaunchRuntimeState,
  normalizeLaunchRuntimeState,
  resolveActiveLaunchAnnouncements,
  resolveLaunchMaintenanceAccess,
  saveLaunchRuntimeState,
  type LaunchAnnouncementRecord,
  type LaunchRuntimeState,
  type LaunchAnnouncementTone,
  type LaunchRuntimeStateStorage,
  type LaunchMaintenanceModeRecord
} from "@server/domain/ops/launch-runtime-state";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";

type CalendarRequest = IncomingMessage & { params?: Record<string, string | undefined> };
type CalendarRouteHandler = (request: CalendarRequest, response: ServerResponse) => void | Promise<void>;
type CalendarApp = {
  get(path: string, handler: CalendarRouteHandler): void;
  post(path: string, handler: CalendarRouteHandler): void;
  delete?(path: string, handler: CalendarRouteHandler): void;
};

export type LiveOpsCalendarAction =
  | {
      type: "announcement_upsert";
      announcement: LaunchAnnouncementRecord;
    }
  | {
      type: "announcement_remove";
      announcementId: string;
    }
  | {
      type: "maintenance_mode";
      maintenanceMode: LaunchMaintenanceModeRecord;
    }
  | {
      type: "seasonal_event_patch";
      eventId: string;
      patch: SeasonalEventRuntimeOverride;
    };

export type LiveOpsCalendarEntryStatus = "scheduled" | "active" | "ended";

export interface LiveOpsCalendarEntry {
  id: string;
  title: string;
  description?: string;
  startsAt: string;
  endsAt?: string;
  status: LiveOpsCalendarEntryStatus;
  action: LiveOpsCalendarAction;
  endAction?: LiveOpsCalendarAction;
  startedAtActual?: string;
  endedAtActual?: string;
  updatedAt: string;
}

export interface LiveOpsCalendarState {
  entries: LiveOpsCalendarEntry[];
  updatedAt: string;
}

export interface LiveOpsCalendarTickResult {
  startedIds: string[];
  endedIds: string[];
  state: LiveOpsCalendarState;
}

export interface LiveOpsCalendarScheduler {
  refresh(): Promise<void>;
  stop(): void;
  tick(now?: Date): Promise<LiveOpsCalendarTickResult>;
}

interface LiveOpsCalendarRouteOptions {
  scheduler?: LiveOpsCalendarScheduler;
  now?: () => Date;
  filePath?: string;
  storage?: LiveOpsCalendarStorage;
}

interface LiveOpsCalendarSchedulerOptions {
  logger?: Pick<Console, "log" | "warn" | "error">;
  setInterval?: (handler: () => void, delayMs: number) => ReturnType<typeof globalThis.setInterval>;
  clearInterval?: (timer: ReturnType<typeof globalThis.setInterval>) => void;
  intervalMs?: number;
  filePath?: string;
  storage?: LiveOpsCalendarStorage;
}

export type LiveOpsRuntimeDocumentId = "liveOpsCalendar" | "launchRuntimeState";

export interface LiveOpsRuntimeDocument {
  content: string;
}

export interface LiveOpsRuntimeDocumentStore {
  loadRuntimeStateDocument(id: LiveOpsRuntimeDocumentId): Promise<LiveOpsRuntimeDocument | null>;
  saveRuntimeStateDocument(id: LiveOpsRuntimeDocumentId, content: string): Promise<LiveOpsRuntimeDocument>;
}

export interface LiveOpsCalendarStorage extends LaunchRuntimeStateStorage {
  loadCalendarState(now?: Date): Promise<LiveOpsCalendarState>;
  saveCalendarState(state: LiveOpsCalendarState): Promise<LiveOpsCalendarState>;
}

class InvalidLiveOpsCalendarPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLiveOpsCalendarPayloadError";
  }
}

class InvalidLiveOpsCalendarJsonError extends Error {
  constructor() {
    super("Request body must be valid JSON");
    this.name = "InvalidLiveOpsCalendarJsonError";
  }
}

function normalizeTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeIsoTimestamp(value: unknown, key: string, fallback?: string): string {
  const normalized = normalizeTrimmedString(value);
  if (!normalized) {
    if (fallback) {
      return fallback;
    }
    throw new InvalidLiveOpsCalendarPayloadError(`"${key}" must be a valid ISO timestamp`);
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    if (fallback) {
      return fallback;
    }
    throw new InvalidLiveOpsCalendarPayloadError(`"${key}" must be a valid ISO timestamp`);
  }
  return parsed.toISOString();
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

function normalizeAnnouncementTone(value: unknown): LaunchAnnouncementTone {
  return value === "warning" || value === "critical" ? value : "info";
}

function normalizeAnnouncementRecord(
  value: unknown,
  nowIso: string,
  keyPrefix = "announcement"
): LaunchAnnouncementRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}" must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const id = normalizeTrimmedString(candidate.id);
  const title = normalizeTrimmedString(candidate.title);
  const message = normalizeTrimmedString(candidate.message);
  if (!id || !title || !message) {
    throw new InvalidLiveOpsCalendarPayloadError(
      `"${keyPrefix}" requires non-empty id, title, and message`
    );
  }
  const startsAt = normalizeIsoTimestamp(candidate.startsAt, `${keyPrefix}.startsAt`, nowIso);
  const endsAt = normalizeTrimmedString(candidate.endsAt)
    ? normalizeIsoTimestamp(candidate.endsAt, `${keyPrefix}.endsAt`)
    : undefined;
  if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}.endsAt" must be later than startsAt`);
  }
  return {
    id,
    title,
    message,
    tone: normalizeAnnouncementTone(candidate.tone),
    startsAt,
    ...(endsAt ? { endsAt } : {})
  };
}

function normalizeMaintenanceModeRecord(
  value: unknown,
  nowIso: string,
  keyPrefix = "maintenanceMode"
): LaunchMaintenanceModeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}" must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const title = normalizeTrimmedString(candidate.title) ?? "停服维护中";
  const message = normalizeTrimmedString(candidate.message) ?? "服务器正在维护，请稍后再试。";
  const nextOpenAt = normalizeTrimmedString(candidate.nextOpenAt)
    ? normalizeIsoTimestamp(candidate.nextOpenAt, `${keyPrefix}.nextOpenAt`, nowIso)
    : undefined;
  return {
    enabled: candidate.enabled === true,
    title,
    message,
    ...(nextOpenAt ? { nextOpenAt } : {}),
    whitelistPlayerIds: normalizeStringList(candidate.whitelistPlayerIds),
    whitelistLoginIds: normalizeStringList(candidate.whitelistLoginIds)
  };
}

function normalizeSeasonalEventPatch(
  value: unknown,
  keyPrefix = "patch"
): SeasonalEventRuntimeOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}" must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const patch: SeasonalEventRuntimeOverride = {};
  if (candidate.startsAt !== undefined) {
    patch.startsAt = normalizeIsoTimestamp(candidate.startsAt, `${keyPrefix}.startsAt`);
  }
  if (candidate.endsAt !== undefined) {
    patch.endsAt = normalizeIsoTimestamp(candidate.endsAt, `${keyPrefix}.endsAt`);
  }
  if (candidate.isActive !== undefined) {
    if (typeof candidate.isActive !== "boolean") {
      throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}.isActive" must be a boolean`);
    }
    patch.isActive = candidate.isActive;
  }
  if (candidate.rewardDistributionAt !== undefined) {
    patch.rewardDistributionAt = normalizeIsoTimestamp(
      candidate.rewardDistributionAt,
      `${keyPrefix}.rewardDistributionAt`
    );
  }
  if (candidate.rewards !== undefined) {
    if (!Array.isArray(candidate.rewards)) {
      throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}.rewards" must be an array`);
    }
    patch.rewards = structuredClone(candidate.rewards) as NonNullable<SeasonalEventRuntimeOverride["rewards"]>;
  }
  if (candidate.leaderboard !== undefined) {
    if (!candidate.leaderboard || typeof candidate.leaderboard !== "object" || Array.isArray(candidate.leaderboard)) {
      throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}.leaderboard" must be an object`);
    }
    patch.leaderboard = structuredClone(
      candidate.leaderboard
    ) as NonNullable<SeasonalEventRuntimeOverride["leaderboard"]>;
  }
  return patch;
}

function normalizeAction(value: unknown, nowIso: string, keyPrefix = "action"): LiveOpsCalendarAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}" must be an object`);
  }
  const candidate = value as Record<string, unknown>;
  const type = normalizeTrimmedString(candidate.type);
  switch (type) {
    case "announcement_upsert":
      return {
        type,
        announcement: normalizeAnnouncementRecord(candidate.announcement, nowIso, `${keyPrefix}.announcement`)
      };
    case "announcement_remove": {
      const announcementId = normalizeTrimmedString(candidate.announcementId);
      if (!announcementId) {
        throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}.announcementId" must be a non-empty string`);
      }
      return { type, announcementId };
    }
    case "maintenance_mode":
      return {
        type,
        maintenanceMode: normalizeMaintenanceModeRecord(
          candidate.maintenanceMode,
          nowIso,
          `${keyPrefix}.maintenanceMode`
        )
      };
    case "seasonal_event_patch": {
      const eventId = normalizeTrimmedString(candidate.eventId);
      if (!eventId) {
        throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}.eventId" must be a non-empty string`);
      }
      return {
        type,
        eventId,
        patch: normalizeSeasonalEventPatch(candidate.patch, `${keyPrefix}.patch`)
      };
    }
    default:
      throw new InvalidLiveOpsCalendarPayloadError(`"${keyPrefix}.type" is not supported`);
  }
}

function normalizeStatus(value: unknown): LiveOpsCalendarEntryStatus {
  return value === "active" || value === "ended" ? value : "scheduled";
}

function normalizeEntry(value: unknown, nowIso: string): LiveOpsCalendarEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidLiveOpsCalendarPayloadError('"entry" must be an object');
  }
  const candidate = value as Record<string, unknown>;
  const id = normalizeTrimmedString(candidate.id);
  const title = normalizeTrimmedString(candidate.title);
  const startsAt = normalizeTrimmedString(candidate.startsAt)
    ? normalizeIsoTimestamp(candidate.startsAt, "entry.startsAt")
    : nowIso;
  const endsAt = normalizeTrimmedString(candidate.endsAt)
    ? normalizeIsoTimestamp(candidate.endsAt, "entry.endsAt")
    : undefined;
  if (!id || !title) {
    throw new InvalidLiveOpsCalendarPayloadError('"entry.id" and "entry.title" are required');
  }
  if (endsAt && new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
    throw new InvalidLiveOpsCalendarPayloadError('"entry.endsAt" must be later than startsAt');
  }
  const description = normalizeTrimmedString(candidate.description) ?? undefined;
  const status = normalizeStatus(candidate.status);
  const startedAtActual = normalizeTrimmedString(candidate.startedAtActual)
    ? normalizeIsoTimestamp(candidate.startedAtActual, "entry.startedAtActual")
    : undefined;
  const endedAtActual = normalizeTrimmedString(candidate.endedAtActual)
    ? normalizeIsoTimestamp(candidate.endedAtActual, "entry.endedAtActual")
    : undefined;
  const updatedAt = normalizeTrimmedString(candidate.updatedAt)
    ? normalizeIsoTimestamp(candidate.updatedAt, "entry.updatedAt")
    : nowIso;

  return {
    id,
    title,
    ...(description ? { description } : {}),
    startsAt,
    ...(endsAt ? { endsAt } : {}),
    status,
    action: normalizeAction(candidate.action, nowIso, "entry.action"),
    ...(candidate.endAction ? { endAction: normalizeAction(candidate.endAction, nowIso, "entry.endAction") } : {}),
    ...(startedAtActual ? { startedAtActual } : {}),
    ...(endedAtActual ? { endedAtActual } : {}),
    updatedAt
  };
}

export function createDefaultLiveOpsCalendarState(now = new Date()): LiveOpsCalendarState {
  return {
    entries: [],
    updatedAt: now.toISOString()
  };
}

export function normalizeLiveOpsCalendarState(input: unknown, now = new Date()): LiveOpsCalendarState {
  const nowIso = now.toISOString();
  const candidate = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const entries = Array.isArray(candidate.entries) ? candidate.entries.map((entry) => normalizeEntry(entry, nowIso)) : [];
  return {
    entries: entries.sort((left, right) => left.startsAt.localeCompare(right.startsAt) || left.id.localeCompare(right.id)),
    updatedAt: normalizeTrimmedString(candidate.updatedAt)
      ? normalizeIsoTimestamp(candidate.updatedAt, "updatedAt", nowIso)
      : nowIso
  };
}

export function readLiveOpsCalendarPath(env: NodeJS.ProcessEnv = process.env): string {
  return normalizeTrimmedString(env.VEIL_LIVE_OPS_CALENDAR_CONFIG) ?? join(process.cwd(), "configs", "live-ops-calendar.json");
}

export async function loadLiveOpsCalendarState(
  filePath = readLiveOpsCalendarPath(),
  now = new Date()
): Promise<LiveOpsCalendarState> {
  try {
    const raw = await readFile(filePath, "utf8");
    return normalizeLiveOpsCalendarState(JSON.parse(raw), now);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createDefaultLiveOpsCalendarState(now);
    }
    throw error;
  }
}

export async function saveLiveOpsCalendarState(
  state: LiveOpsCalendarState,
  filePath = readLiveOpsCalendarPath()
): Promise<LiveOpsCalendarState> {
  const normalized = normalizeLiveOpsCalendarState(state, new Date());
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

export function createFileLiveOpsCalendarStorage(options: {
  calendarFilePath?: string;
  launchRuntimeFilePath?: string;
} = {}): LiveOpsCalendarStorage {
  return {
    loadCalendarState(now = new Date()) {
      return loadLiveOpsCalendarState(options.calendarFilePath, now);
    },
    saveCalendarState(state) {
      return saveLiveOpsCalendarState(state, options.calendarFilePath);
    },
    loadLaunchRuntimeState(now = new Date()) {
      return loadLaunchRuntimeState(options.launchRuntimeFilePath, now);
    },
    saveLaunchRuntimeState(state) {
      return saveLaunchRuntimeState(state, options.launchRuntimeFilePath);
    }
  };
}

export function createSharedLiveOpsCalendarStorage(
  store: LiveOpsRuntimeDocumentStore
): LiveOpsCalendarStorage {
  return {
    async loadCalendarState(now = new Date()) {
      const document = await store.loadRuntimeStateDocument("liveOpsCalendar");
      if (!document) {
        return createDefaultLiveOpsCalendarState(now);
      }
      return normalizeLiveOpsCalendarState(JSON.parse(document.content), now);
    },
    async saveCalendarState(state) {
      const normalized = normalizeLiveOpsCalendarState(state, new Date());
      await store.saveRuntimeStateDocument("liveOpsCalendar", `${JSON.stringify(normalized, null, 2)}\n`);
      return normalized;
    },
    async loadLaunchRuntimeState(now = new Date()) {
      const document = await store.loadRuntimeStateDocument("launchRuntimeState");
      if (!document) {
        return createDefaultLaunchRuntimeState(now);
      }
      return normalizeLaunchRuntimeState(JSON.parse(document.content), now);
    },
    async saveLaunchRuntimeState(state: LaunchRuntimeState) {
      const normalized = normalizeLaunchRuntimeState(state, new Date());
      await store.saveRuntimeStateDocument("launchRuntimeState", `${JSON.stringify(normalized, null, 2)}\n`);
      return normalized;
    }
  };
}

function resolveLiveOpsCalendarStorage(
  storageOrFilePath?: LiveOpsCalendarStorage | string
): LiveOpsCalendarStorage {
  return typeof storageOrFilePath === "string"
    ? createFileLiveOpsCalendarStorage({ calendarFilePath: storageOrFilePath })
    : storageOrFilePath ?? createFileLiveOpsCalendarStorage();
}

async function applyAction(action: LiveOpsCalendarAction, now: Date, storage: LiveOpsCalendarStorage): Promise<void> {
  switch (action.type) {
    case "announcement_upsert": {
      const state = await storage.loadLaunchRuntimeState(now);
      await storage.saveLaunchRuntimeState({
        ...state,
        announcements: [
          ...state.announcements.filter((entry) => entry.id !== action.announcement.id),
          action.announcement
        ],
        updatedAt: now.toISOString()
      });
      return;
    }
    case "announcement_remove": {
      const state = await storage.loadLaunchRuntimeState(now);
      await storage.saveLaunchRuntimeState({
        ...state,
        announcements: state.announcements.filter((entry) => entry.id !== action.announcementId),
        updatedAt: now.toISOString()
      });
      return;
    }
    case "maintenance_mode": {
      const state = await storage.loadLaunchRuntimeState(now);
      await storage.saveLaunchRuntimeState({
        ...state,
        maintenanceMode: action.maintenanceMode,
        updatedAt: now.toISOString()
      });
      return;
    }
    case "seasonal_event_patch":
      applySeasonalEventAdminPatch(action.eventId, action.patch);
      return;
  }
}

function buildDefaultEndAction(entry: LiveOpsCalendarEntry, now: Date): LiveOpsCalendarAction | null {
  switch (entry.action.type) {
    case "announcement_upsert":
      return {
        type: "announcement_remove",
        announcementId: entry.action.announcement.id
      };
    case "maintenance_mode":
      return {
        type: "maintenance_mode",
        maintenanceMode: {
          ...entry.action.maintenanceMode,
          enabled: false
        }
      };
    case "seasonal_event_patch":
      return {
        type: "seasonal_event_patch",
        eventId: entry.action.eventId,
        patch: {
          isActive: false,
          endsAt: now.toISOString()
        }
      };
    default:
      return null;
  }
}

function hasPendingCalendarEntries(state: LiveOpsCalendarState): boolean {
  return state.entries.some((entry) => entry.status !== "ended");
}

function toEpochMs(value: string | Date): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export async function runLiveOpsCalendarTick(
  now = new Date(),
  storageOrFilePath?: LiveOpsCalendarStorage | string
): Promise<LiveOpsCalendarTickResult> {
  const storage = resolveLiveOpsCalendarStorage(storageOrFilePath);
  const state = await storage.loadCalendarState(now);
  const nextEntries = state.entries.map((entry) => ({ ...entry }));
  const startedIds: string[] = [];
  const endedIds: string[] = [];

  for (const entry of nextEntries) {
    if (entry.status === "scheduled" && toEpochMs(entry.startsAt) <= now.getTime()) {
      await applyAction(entry.action, now, storage);
      entry.status = "active";
      entry.startedAtActual = now.toISOString();
      entry.updatedAt = now.toISOString();
      startedIds.push(entry.id);
    }
  }

  for (const entry of nextEntries) {
    if (entry.status !== "active" || !entry.endsAt || toEpochMs(entry.endsAt) > now.getTime()) {
      continue;
    }
    const endAction = entry.endAction ?? buildDefaultEndAction(entry, now);
    if (endAction) {
      await applyAction(endAction, now, storage);
    }
    entry.status = "ended";
    entry.endedAtActual = now.toISOString();
    entry.updatedAt = now.toISOString();
    endedIds.push(entry.id);
  }

  if (startedIds.length === 0 && endedIds.length === 0) {
    return { startedIds, endedIds, state };
  }

  const nextState = await storage.saveCalendarState(
    {
      entries: nextEntries,
      updatedAt: now.toISOString()
    }
  );
  return {
    startedIds,
    endedIds,
    state: nextState
  };
}

async function runCalendarEntryTransition(
  entryId: string,
  transition: "start" | "end",
  now = new Date(),
  storageOrFilePath?: LiveOpsCalendarStorage | string
): Promise<LiveOpsCalendarEntry> {
  const storage = resolveLiveOpsCalendarStorage(storageOrFilePath);
  const state = await storage.loadCalendarState(now);
  const nextEntries = state.entries.map((entry) => ({ ...entry }));
  const entry = nextEntries.find((item) => item.id === entryId);
  if (!entry) {
    throw new InvalidLiveOpsCalendarPayloadError("calendar entry was not found");
  }

  if (transition === "start") {
    await applyAction(entry.action, now, storage);
    entry.status = "active";
    entry.startedAtActual = now.toISOString();
    entry.updatedAt = now.toISOString();
  } else {
    const endAction = entry.endAction ?? buildDefaultEndAction(entry, now);
    if (endAction) {
      await applyAction(endAction, now, storage);
    }
    entry.status = "ended";
    entry.endedAtActual = now.toISOString();
    entry.updatedAt = now.toISOString();
  }

  const nextState = await storage.saveCalendarState(
    {
      entries: nextEntries,
      updatedAt: now.toISOString()
    }
  );
  return nextState.entries.find((item) => item.id === entryId)!;
}

function readAdminSecret(): string | null {
  return readRuntimeSecret("ADMIN_SECRET") || null;
}

function readHeaderSecret(request: IncomingMessage): string | null {
  const header = request.headers["x-veil-admin-secret"];
  if (typeof header !== "string") {
    return null;
  }
  const normalized = header.trim();
  return normalized.length > 0 ? normalized : null;
}

function isAuthorized(request: IncomingMessage): boolean {
  const adminSecret = readAdminSecret();
  return Boolean(adminSecret && readHeaderSecret(request) === adminSecret);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, x-veil-admin-secret");
  response.end(JSON.stringify(payload));
}

function sendUnauthorized(response: ServerResponse): void {
  sendJson(response, 401, { error: "Unauthorized: Invalid Admin Secret" });
}

function sendAdminSecretNotConfigured(response: ServerResponse): void {
  sendJson(response, 503, { error: "ADMIN_SECRET is not configured" });
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InvalidLiveOpsCalendarJsonError();
  }
}

function summarizeCalendar(state: LiveOpsCalendarState, now = new Date()) {
  const counts = state.entries.reduce(
    (summary, entry) => {
      summary[entry.status] += 1;
      return summary;
    },
    { scheduled: 0, active: 0, ended: 0 }
  );
  return {
    counts,
    nextStartAt:
      state.entries
        .filter((entry) => entry.status === "scheduled")
        .map((entry) => entry.startsAt)
        .sort()[0] ?? null,
    activeEntryIds: state.entries.filter((entry) => entry.status === "active").map((entry) => entry.id),
    generatedAt: now.toISOString()
  };
}

export function registerLiveOpsCalendarRoutes(
  app: CalendarApp,
  options: LiveOpsCalendarRouteOptions = {}
): void {
  const nowFactory = options.now ?? (() => new Date());
  const storage =
    options.storage ??
    createFileLiveOpsCalendarStorage(
      options.filePath ? { calendarFilePath: options.filePath } : {}
    );
  const scheduler = options.scheduler;

  app.get("/admin/calendar", async (_request, response) => {
    try {
      const html = await readFile(join(process.cwd(), "apps/client/admin-calendar.html"), "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    } catch {
      response.statusCode = 500;
      response.end("Failed to load admin-calendar.html");
    }
  });

  app.get("/api/admin/live-ops-calendar", async (request, response) => {
    if (!readAdminSecret()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const state = await storage.loadCalendarState(nowFactory());
      const launchRuntime = await storage.loadLaunchRuntimeState(nowFactory());
      sendJson(response, 200, {
        entries: state.entries,
        summary: summarizeCalendar(state, nowFactory()),
        runtime: {
          activeAnnouncements: resolveActiveLaunchAnnouncements(launchRuntime, nowFactory()),
          maintenanceMode: resolveLaunchMaintenanceAccess(launchRuntime, { now: nowFactory() })
        },
        updatedAt: state.updatedAt
      });
    } catch (error) {
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/live-ops-calendar", async (request, response) => {
    if (!readAdminSecret()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const body = await readJsonBody(request);
      const rawEntry =
        body && typeof body === "object" && !Array.isArray(body) && "entry" in body
          ? (body as { entry: unknown }).entry
          : body;
      const state = await storage.loadCalendarState(nowFactory());
      const entry = normalizeEntry(rawEntry, nowFactory().toISOString());
      const nextState = await storage.saveCalendarState(
        {
          entries: [...state.entries.filter((item) => item.id !== entry.id), entry],
          updatedAt: nowFactory().toISOString()
        }
      );
      await scheduler?.refresh();
      sendJson(response, 200, {
        ok: true,
        entry,
        summary: summarizeCalendar(nextState, nowFactory())
      });
    } catch (error) {
      if (error instanceof InvalidLiveOpsCalendarJsonError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      if (error instanceof InvalidLiveOpsCalendarPayloadError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.delete?.("/api/admin/live-ops-calendar/:id", async (request, response) => {
    if (!readAdminSecret()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const entryId = normalizeTrimmedString(request.params?.id);
      if (!entryId) {
        throw new InvalidLiveOpsCalendarPayloadError("calendar entry id is required");
      }
      const state = await storage.loadCalendarState(nowFactory());
      const nextState = await storage.saveCalendarState(
        {
          entries: state.entries.filter((entry) => entry.id !== entryId),
          updatedAt: nowFactory().toISOString()
        }
      );
      await scheduler?.refresh();
      sendJson(response, 200, {
        ok: true,
        summary: summarizeCalendar(nextState, nowFactory())
      });
    } catch (error) {
      if (error instanceof InvalidLiveOpsCalendarPayloadError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/live-ops-calendar/:id/start", async (request, response) => {
    if (!readAdminSecret()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const entryId = normalizeTrimmedString(request.params?.id);
      if (!entryId) {
        throw new InvalidLiveOpsCalendarPayloadError("calendar entry id is required");
      }
      const entry = await runCalendarEntryTransition(entryId, "start", nowFactory(), storage);
      await scheduler?.refresh();
      sendJson(response, 200, { ok: true, entry });
    } catch (error) {
      if (error instanceof InvalidLiveOpsCalendarPayloadError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/live-ops-calendar/:id/end", async (request, response) => {
    if (!readAdminSecret()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const entryId = normalizeTrimmedString(request.params?.id);
      if (!entryId) {
        throw new InvalidLiveOpsCalendarPayloadError("calendar entry id is required");
      }
      const entry = await runCalendarEntryTransition(entryId, "end", nowFactory(), storage);
      await scheduler?.refresh();
      sendJson(response, 200, { ok: true, entry });
    } catch (error) {
      if (error instanceof InvalidLiveOpsCalendarPayloadError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });
}

export function createLiveOpsCalendarScheduler(
  options: LiveOpsCalendarSchedulerOptions = {}
): LiveOpsCalendarScheduler {
  const logger = options.logger ?? console;
  const setIntervalImpl = options.setInterval ?? globalThis.setInterval;
  const clearIntervalImpl = options.clearInterval ?? globalThis.clearInterval;
  const intervalMs = options.intervalMs ?? 30_000;
  const storage =
    options.storage ??
    createFileLiveOpsCalendarStorage(
      options.filePath ? { calendarFilePath: options.filePath } : {}
    );
  let timer: ReturnType<typeof globalThis.setInterval> | null = null;

  const stop = (): void => {
    if (timer) {
      clearIntervalImpl(timer);
      timer = null;
    }
  };

  const ensureRunning = async (): Promise<void> => {
    const state = await storage.loadCalendarState();
    if (!hasPendingCalendarEntries(state)) {
      stop();
      return;
    }
    if (timer) {
      return;
    }
    timer = setIntervalImpl(() => {
      void runLiveOpsCalendarTick(new Date(), storage)
        .then(async ({ state: nextState, startedIds, endedIds }) => {
          if (startedIds.length > 0 || endedIds.length > 0) {
            logger.log(
              `[LiveOpsCalendar] started=${startedIds.join(",") || "-"} ended=${endedIds.join(",") || "-"}`
            );
          }
          if (!hasPendingCalendarEntries(nextState)) {
            stop();
          }
        })
        .catch((error) => {
          logger.error("[LiveOpsCalendar] scheduler tick failed", error);
        });
    }, intervalMs);
    if ("unref" in timer && typeof timer.unref === "function") {
      timer.unref();
    }
  };

  return {
    async refresh() {
      await ensureRunning();
    },
    stop,
    async tick(now = new Date()) {
      const result = await runLiveOpsCalendarTick(now, storage);
      if (!hasPendingCalendarEntries(result.state)) {
        stop();
      } else if (!timer) {
        await ensureRunning();
      }
      return result;
    }
  };
}

export async function liveOpsCalendarConfigExists(filePath = readLiveOpsCalendarPath()): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
