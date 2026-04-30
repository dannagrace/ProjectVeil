import type { IncomingMessage, ServerResponse } from "node:http";
import defendTheBridgeDocument from "../../../../../configs/event-defend-the-bridge.json";
import seasonalEventsDocument from "../../../../../configs/seasonal-events.json";
import type { EventLeaderboardEntry, SeasonalEventDefinition, SeasonalEventLeaderboardRewardTier, SeasonalEventObjective, SeasonalEventReward, SeasonalEventState } from "@veil/shared/models";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import { validateAuthSessionFromRequest } from "@server/domain/account/auth";
import type { DailyQuestConfigDefinition } from "@server/domain/economy/daily-quest-config";
import type { PlayerAccountSnapshot, PlayerQuestRotationHistoryEntry, PlayerQuestState, RoomSnapshotStore } from "@server/persistence";
import { normalizePlayerMailboxMessage } from "@server/domain/account/player-mailbox";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import {
  recordSeasonalEventOpsAuditLocalFallbackWrite,
  recordSeasonalEventOpsAuditMySqlPersistFailure,
  recordSeasonalEventOpsAuditPersistFailure,
  recordSeasonalEventOpsAuditPersistSuccess,
  recordSeasonalEventOpsAuditReadFailure,
  recordSeasonalEventRuntimeOverrideLocalFallbackWrite,
  recordSeasonalEventRuntimeOverridePersistFailure,
  recordSeasonalEventRuntimeOverrideReadFailure
} from "@server/domain/ops/observability";
import {
  consumeRedisBackedOrLocalRateLimit,
  createLocalRateLimitState,
  type RateLimitResult
} from "@server/infra/http-rate-limit";
import { createRedisClient, readRedisUrl, type RedisClientLike } from "@server/infra/redis";

interface SeasonalEventSummaryDocument {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  durationDays?: number | null;
  bannerText?: string | null;
  leaderboard?: {
    size?: number | null;
  } | null;
}

interface SeasonalEventsDocument {
  events?: SeasonalEventSummaryDocument[] | null;
}

interface SeasonalEventDefinitionDocument {
  id?: string | null;
  name?: string | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  durationDays?: number | null;
  bannerText?: string | null;
  objectives?: Partial<SeasonalEventObjective>[] | null;
  rewards?: Partial<SeasonalEventReward>[] | null;
  leaderboard?: {
    size?: number | null;
    rewardTiers?: Partial<SeasonalEventLeaderboardRewardTier>[] | null;
  } | null;
}

interface RuntimeSeasonalEventDefinition extends SeasonalEventDefinition {
  isActive?: boolean;
  rewardDistributionAt?: string;
}

export interface SeasonalEventRuntimeOverride {
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
  rewards?: SeasonalEventReward[];
  leaderboard?: {
    size?: number;
    rewardTiers?: SeasonalEventLeaderboardRewardTier[];
  };
  rewardDistributionAt?: string;
}

export interface SeasonalEventOpsAuditEntry {
  id: string;
  action: "patched" | "force_ended" | "player_progress_reset";
  actor: string;
  eventId: string;
  occurredAt: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface SeasonalEventOpsAuditRedisClient {
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  del?(key: string): Promise<unknown>;
  expire?(key: string, seconds: number): Promise<unknown>;
}

export interface SeasonalEventOpsAuditArchiveStore {
  appendSeasonalEventOpsAuditLog?(entry: SeasonalEventOpsAuditEntry): Promise<unknown>;
  listSeasonalEventOpsAuditLogs?(options?: {
    since?: string;
    actor?: string;
    eventId?: string;
    limit?: number;
  }): Promise<SeasonalEventOpsAuditEntry[]>;
}

export interface RegisterEventRoutesOptions {
  now?: () => Date;
  eventIndexDocument?: SeasonalEventsDocument;
  eventDocuments?: Record<string, SeasonalEventDefinitionDocument>;
  rateLimitRedisClient?: RedisClientLike | null;
  rateLimitRedisUrl?: string | null;
  rateLimitCreateRedisClient?: typeof createRedisClient;
  seasonalEventRuntimeRedisClient?: RedisClientLike | null;
  seasonalEventRuntimeRedisUrl?: string | null;
  seasonalEventRuntimeCreateRedisClient?: typeof createRedisClient;
  seasonalEventOpsAuditRedisClient?: SeasonalEventOpsAuditRedisClient | null;
  seasonalEventOpsAuditRedisUrl?: string | null;
  seasonalEventOpsAuditCreateRedisClient?: typeof createRedisClient;
}

export interface SeasonalEventActionInput {
  actionId: string;
  actionType: SeasonalEventObjective["actionType"];
  dungeonId?: string;
  occurredAt?: string;
}

export interface RotateDailyQuestsInput {
  playerId: string;
  dateKey: string;
  questPool: DailyQuestConfigDefinition[];
  questState?: PlayerQuestState | null;
}

export interface RotateDailyQuestsResult {
  quests: DailyQuestConfigDefinition[];
  state: PlayerQuestState;
  rotated: boolean;
}

const DAILY_QUEST_SELECTION_SIZE = 3;
const DAILY_QUEST_NO_REPEAT_WINDOW_DAYS = 7;
const DAILY_QUEST_TIER_WEIGHTS: Record<DailyQuestConfigDefinition["tier"], number> = {
  common: 0.6,
  rare: 0.3,
  epic: 0.1
};
const ACTION_SUBMISSION_RATE_LIMIT_WINDOW_MS = 5_000;
const ACTION_SUBMISSION_RATE_LIMIT_MAX = 1;
const ACTION_SUBMISSION_RATE_LIMIT_CLUSTER_KEY_PREFIX = "veil:action-submission-rate:";
const SEASONAL_EVENT_RUNTIME_OVERRIDE_REDIS_HASH_KEY = "veil:seasonal-event-runtime-overrides";
const SEASONAL_EVENT_OPS_AUDIT_REDIS_LIST_KEY = "veil:seasonal-event-ops-audit";
const SEASONAL_EVENT_OPS_AUDIT_MAX_ENTRIES = 200;
const SEASONAL_EVENT_OPS_AUDIT_TTL_SECONDS = 60 * 60 * 24 * 90;
const SERVER_VERIFIABLE_SEASONAL_EVENT_ACTION_TYPES = new Set<string>(["daily_dungeon_reward_claimed"]);
const seasonalEventRuntimeOverrides = new Map<string, SeasonalEventRuntimeOverride>();
const seasonalEventOpsAuditTrail: SeasonalEventOpsAuditEntry[] = [];
const actionSubmissionRateLimitState = createLocalRateLimitState();
let defaultActionSubmissionRateLimitRedisClient: RedisClientLike | null | undefined;

interface SeasonalEventOpsAuditAppendResult {
  entry: SeasonalEventOpsAuditEntry;
  degraded: boolean;
}

interface SeasonalEventOpsAuditListResult {
  entries: SeasonalEventOpsAuditEntry[];
  degraded: boolean;
  source: "redis-recent" | "mysql-archived" | "local";
}

interface SeasonalEventRuntimeOverrideLoadResult {
  override: SeasonalEventRuntimeOverride | null;
  degraded: boolean;
}

interface SeasonalEventRuntimeOverrideApplyResult {
  degraded: boolean;
}

interface SeasonalEventClusterStateResult {
  events: SeasonalEventDefinition[];
  degraded: boolean;
}

export interface ActionSubmissionRateLimitOptions {
  redisClient?: RedisClientLike | null;
  nowMs?: number;
}

function isServerVerifiableSeasonalEventActionType(actionType: string): boolean {
  return SERVER_VERIFIABLE_SEASONAL_EVENT_ACTION_TYPES.has(actionType);
}

export function isActionSubmissionRateLimitEnabled(): boolean {
  return (
    process.env.NODE_ENV?.trim().toLowerCase() === "production" &&
    process.env.VEIL_DISABLE_ACTION_SUBMISSION_RATE_LIMIT?.trim() !== "1"
  );
}

export function resetActionSubmissionRateLimitState(): void {
  actionSubmissionRateLimitState.counters.clear();
  actionSubmissionRateLimitState.lastPrunedAtMs = 0;
}

function resolveDefaultActionSubmissionRateLimitRedisClient(): RedisClientLike | null {
  if (defaultActionSubmissionRateLimitRedisClient !== undefined) {
    return defaultActionSubmissionRateLimitRedisClient;
  }

  const redisUrl = readRedisUrl();
  defaultActionSubmissionRateLimitRedisClient = redisUrl ? createRedisClient(redisUrl) : null;
  return defaultActionSubmissionRateLimitRedisClient;
}

function normalizeActionSubmissionRateLimitOptions(
  options: number | ActionSubmissionRateLimitOptions
): Required<Pick<ActionSubmissionRateLimitOptions, "nowMs">> & { redisClient: RedisClientLike | null } {
  if (typeof options === "number") {
    return {
      redisClient: resolveDefaultActionSubmissionRateLimitRedisClient(),
      nowMs: options
    };
  }

  return {
    redisClient:
      options.redisClient === undefined
        ? resolveDefaultActionSubmissionRateLimitRedisClient()
        : options.redisClient,
    nowMs: options.nowMs ?? Date.now()
  };
}

export async function consumeActionSubmissionRateLimit(
  key: string,
  options: number | ActionSubmissionRateLimitOptions = {}
): Promise<RateLimitResult> {
  const { redisClient, nowMs } = normalizeActionSubmissionRateLimitOptions(options);
  return consumeRedisBackedOrLocalRateLimit({
    redisClient,
    localState: actionSubmissionRateLimitState,
    key,
    redisKey: `${ACTION_SUBMISSION_RATE_LIMIT_CLUSTER_KEY_PREFIX}${key}`,
    config: { windowMs: ACTION_SUBMISSION_RATE_LIMIT_WINDOW_MS },
    max: ACTION_SUBMISSION_RATE_LIMIT_MAX,
    now: () => nowMs
  });
}

export function hasVerifiedDailyDungeonClaim(
  account: Pick<PlayerAccountSnapshot, "dailyDungeonState">,
  actionId: string,
  dungeonId: string
): boolean {
  const normalizedActionId = actionId.trim();
  const normalizedDungeonId = dungeonId.trim();
  if (!normalizedActionId || !normalizedDungeonId) {
    return false;
  }

  return (
    account.dailyDungeonState?.runs.some(
      (run) => run.runId === normalizedActionId && run.dungeonId === normalizedDungeonId && run.rewardClaimedAt != null
    ) ?? false
  );
}

function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

function toUtcDayIndex(dateKey: string): number {
  return Math.floor(Date.parse(`${dateKey}T00:00:00.000Z`) / 86_400_000);
}

function createSeededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }

  return () => {
    state += 0x6d2b79f5;
    let next = Math.imul(state ^ (state >>> 15), state | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeQuestIds(questIds: string[] | undefined): string[] {
  return Array.from(new Set((questIds ?? []).map((questId) => questId?.trim()).filter((questId): questId is string => Boolean(questId))));
}

function readHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0]?.trim() || null;
  }
  return value?.trim() || null;
}

function readAdminTokenFromRequest(request: Pick<IncomingMessage, "headers">): string | null {
  const authorization = readHeaderValue(request.headers.authorization);
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }
  return readHeaderValue(request.headers["x-veil-admin-token"]);
}

function isAdminAuthorized(request: Pick<IncomingMessage, "headers">): boolean {
  const adminToken = readRuntimeSecret("VEIL_ADMIN_TOKEN");
  return timingSafeCompareAdminToken(readAdminTokenFromRequest(request), adminToken);
}

function sendAdminUnauthorized(response: ServerResponse): void {
  sendJson(response, 403, {
    error: {
      code: "forbidden",
      message: "Invalid admin token"
    }
  });
}

function sendAdminTokenNotConfigured(response: ServerResponse): void {
  sendJson(response, 503, {
    error: {
      code: "admin_token_not_configured",
      message: "VEIL_ADMIN_TOKEN is not configured"
    }
  });
}

function sendStoreUnavailable(
  response: ServerResponse,
  code: string,
  message: string
): void {
  sendJson(response, 503, {
    error: {
      code,
      message
    }
  });
}

function createSeasonalEventOpsAuditEntry(entry: Omit<SeasonalEventOpsAuditEntry, "id">): SeasonalEventOpsAuditEntry {
  return {
    ...entry,
    id: `seasonal-event-ops:${entry.action}:${entry.eventId}:${entry.occurredAt}`
  };
}

function cloneSeasonalEventOpsAuditEntry(entry: SeasonalEventOpsAuditEntry): SeasonalEventOpsAuditEntry {
  return {
    ...entry,
    ...(entry.metadata ? { metadata: structuredClone(entry.metadata) } : {})
  };
}

function rememberLocalSeasonalEventOpsAuditEntry(auditEntry: SeasonalEventOpsAuditEntry): void {
  seasonalEventOpsAuditTrail.unshift(auditEntry);
  seasonalEventOpsAuditTrail.splice(SEASONAL_EVENT_OPS_AUDIT_MAX_ENTRIES);
}

export function listSeasonalEventOpsAuditTrail(): SeasonalEventOpsAuditEntry[] {
  return seasonalEventOpsAuditTrail.map(cloneSeasonalEventOpsAuditEntry);
}

function parseSeasonalEventOpsAuditEntry(value: string): SeasonalEventOpsAuditEntry | null {
  try {
    const parsed = JSON.parse(value) as Partial<SeasonalEventOpsAuditEntry>;
    if (
      typeof parsed.id !== "string" ||
      (parsed.action !== "patched" && parsed.action !== "force_ended" && parsed.action !== "player_progress_reset") ||
      typeof parsed.actor !== "string" ||
      typeof parsed.eventId !== "string" ||
      typeof parsed.occurredAt !== "string" ||
      typeof parsed.detail !== "string"
    ) {
      return null;
    }
    return {
      id: parsed.id,
      action: parsed.action,
      actor: parsed.actor,
      eventId: parsed.eventId,
      occurredAt: parsed.occurredAt,
      detail: parsed.detail,
      ...(parsed.metadata && typeof parsed.metadata === "object" && !Array.isArray(parsed.metadata)
        ? { metadata: structuredClone(parsed.metadata) as Record<string, unknown> }
        : {})
    };
  } catch {
    return null;
  }
}

function normalizeSeasonalEventOpsAuditLimit(limit: number | undefined): number {
  return Math.max(1, Math.floor(limit ?? SEASONAL_EVENT_OPS_AUDIT_MAX_ENTRIES));
}

function matchesSeasonalEventOpsAuditOptions(
  entry: SeasonalEventOpsAuditEntry,
  options: { since?: string; actor?: string; eventId?: string; limit?: number }
): boolean {
  if (options.since && entry.occurredAt < options.since) {
    return false;
  }
  if (options.actor && entry.actor !== options.actor) {
    return false;
  }
  if (options.eventId && entry.eventId !== options.eventId) {
    return false;
  }
  return true;
}

function orderSeasonalEventOpsAuditEntries(
  entries: SeasonalEventOpsAuditEntry[],
  options: { since?: string; actor?: string; eventId?: string; limit?: number } = {}
): SeasonalEventOpsAuditEntry[] {
  return entries
    .filter((entry) => matchesSeasonalEventOpsAuditOptions(entry, options))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.id.localeCompare(left.id))
    .slice(0, normalizeSeasonalEventOpsAuditLimit(options.limit));
}

function mergeSeasonalEventOpsAuditEntries(
  entries: SeasonalEventOpsAuditEntry[],
  archived: SeasonalEventOpsAuditEntry[],
  options: { since?: string; actor?: string; eventId?: string; limit?: number } = {}
): SeasonalEventOpsAuditEntry[] {
  const byId = new Map<string, SeasonalEventOpsAuditEntry>();
  for (const entry of [...entries, ...archived]) {
    byId.set(entry.id, cloneSeasonalEventOpsAuditEntry(entry));
  }
  return orderSeasonalEventOpsAuditEntries(Array.from(byId.values()), options);
}

async function appendSeasonalEventOpsAuditEntryWithSharedStore(
  entry: Omit<SeasonalEventOpsAuditEntry, "id">,
  redisClient: SeasonalEventOpsAuditRedisClient | null,
  archiveStore?: SeasonalEventOpsAuditArchiveStore | null
): Promise<SeasonalEventOpsAuditAppendResult> {
  const auditEntry = createSeasonalEventOpsAuditEntry(entry);
  if (archiveStore?.appendSeasonalEventOpsAuditLog) {
    void archiveStore.appendSeasonalEventOpsAuditLog(cloneSeasonalEventOpsAuditEntry(auditEntry)).catch((error: unknown) => {
      recordSeasonalEventOpsAuditMySqlPersistFailure();
      console.error("Seasonal event ops audit archive persistence failed", error);
    });
  }
  if (!redisClient) {
    rememberLocalSeasonalEventOpsAuditEntry(auditEntry);
    return { entry: auditEntry, degraded: false };
  }

  try {
    await redisClient.lpush(SEASONAL_EVENT_OPS_AUDIT_REDIS_LIST_KEY, JSON.stringify(auditEntry));
    await redisClient.ltrim(SEASONAL_EVENT_OPS_AUDIT_REDIS_LIST_KEY, 0, SEASONAL_EVENT_OPS_AUDIT_MAX_ENTRIES - 1);
    await redisClient.expire?.(SEASONAL_EVENT_OPS_AUDIT_REDIS_LIST_KEY, SEASONAL_EVENT_OPS_AUDIT_TTL_SECONDS);
    recordSeasonalEventOpsAuditPersistSuccess();
    rememberLocalSeasonalEventOpsAuditEntry(auditEntry);
    return { entry: auditEntry, degraded: false };
  } catch (error) {
    recordSeasonalEventOpsAuditPersistFailure();
    recordSeasonalEventOpsAuditLocalFallbackWrite();
    console.error("Seasonal event ops audit persistence failed; using local fallback", error);
    rememberLocalSeasonalEventOpsAuditEntry(auditEntry);
    return { entry: auditEntry, degraded: true };
  }
}

async function listSeasonalEventOpsAuditTrailWithSharedStore(
  redisClient: SeasonalEventOpsAuditRedisClient | null,
  archiveStore?: SeasonalEventOpsAuditArchiveStore | null,
  options: { since?: string; actor?: string; eventId?: string; limit?: number } = {}
): Promise<SeasonalEventOpsAuditListResult> {
  const listArchivedAuditLogs = archiveStore?.listSeasonalEventOpsAuditLogs;

  if (!redisClient) {
    if (listArchivedAuditLogs) {
      return {
        entries: orderSeasonalEventOpsAuditEntries(await listArchivedAuditLogs.call(archiveStore, options), options),
        degraded: false,
        source: "mysql-archived"
      };
    }
    return { entries: orderSeasonalEventOpsAuditEntries(listSeasonalEventOpsAuditTrail(), options), degraded: false, source: "local" };
  }

  try {
    const entries = (await redisClient.lrange(SEASONAL_EVENT_OPS_AUDIT_REDIS_LIST_KEY, 0, SEASONAL_EVENT_OPS_AUDIT_MAX_ENTRIES - 1))
        .map(parseSeasonalEventOpsAuditEntry)
        .filter((entry): entry is SeasonalEventOpsAuditEntry => Boolean(entry))
        .map(cloneSeasonalEventOpsAuditEntry);
    const filteredEntries = orderSeasonalEventOpsAuditEntries(entries, options);
    const shouldReadArchive =
      Boolean(options.since || options.actor || options.eventId) ||
      filteredEntries.length <
        Math.min(normalizeSeasonalEventOpsAuditLimit(options.limit), SEASONAL_EVENT_OPS_AUDIT_MAX_ENTRIES);
    if (listArchivedAuditLogs && shouldReadArchive) {
      const archived = await listArchivedAuditLogs.call(archiveStore, options);
      return {
        entries: mergeSeasonalEventOpsAuditEntries(filteredEntries, archived, options),
        degraded: false,
        source: "mysql-archived"
      };
    }
    return { entries: filteredEntries, degraded: false, source: "redis-recent" };
  } catch (error) {
    recordSeasonalEventOpsAuditReadFailure();
    console.error("Seasonal event ops audit read failed; using local fallback", error);
    if (listArchivedAuditLogs) {
      return {
        entries: orderSeasonalEventOpsAuditEntries(await listArchivedAuditLogs.call(archiveStore, options), options),
        degraded: true,
        source: "mysql-archived"
      };
    }
    return { entries: orderSeasonalEventOpsAuditEntries(listSeasonalEventOpsAuditTrail(), options), degraded: true, source: "local" };
  }
}

export async function resetSeasonalEventRuntimeState(
  redisClient?: (SeasonalEventOpsAuditRedisClient & Pick<RedisClientLike, "del">) | RedisClientLike | null
): Promise<void> {
  seasonalEventRuntimeOverrides.clear();
  seasonalEventOpsAuditTrail.length = 0;
  if (redisClient?.del) {
    await redisClient.del(SEASONAL_EVENT_OPS_AUDIT_REDIS_LIST_KEY);
    await redisClient.del(SEASONAL_EVENT_RUNTIME_OVERRIDE_REDIS_HASH_KEY);
  }
}

function cloneSeasonalEventRuntimeOverride(override: SeasonalEventRuntimeOverride): SeasonalEventRuntimeOverride {
  return structuredClone(override);
}

function mergeSeasonalEventRuntimeOverride(
  current: SeasonalEventRuntimeOverride,
  patch: SeasonalEventRuntimeOverride
): SeasonalEventRuntimeOverride {
  return cloneSeasonalEventRuntimeOverride({
    ...current,
    ...patch
  });
}

function parseSeasonalEventRuntimeOverride(value: string | null): SeasonalEventRuntimeOverride | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return cloneSeasonalEventRuntimeOverride(parsed as SeasonalEventRuntimeOverride);
  } catch {
    return null;
  }
}

function applySeasonalEventRuntimeOverride(
  event: SeasonalEventDefinition,
  override = seasonalEventRuntimeOverrides.get(event.id)
): RuntimeSeasonalEventDefinition {
  if (!override) {
    return event;
  }

  return {
    ...event,
    ...(override.startsAt ? { startsAt: override.startsAt } : {}),
    ...(override.endsAt ? { endsAt: override.endsAt } : {}),
    ...(override.isActive !== undefined ? { isActive: override.isActive } : {}),
    ...(override.rewards ? { rewards: override.rewards.map((reward) => ({ ...reward })) } : {}),
    ...(override.leaderboard
      ? {
          leaderboard: {
            size: override.leaderboard.size ?? event.leaderboard.size,
            rewardTiers: (override.leaderboard.rewardTiers ?? event.leaderboard.rewardTiers).map((tier) => ({ ...tier }))
          }
        }
      : {}),
    ...(override.rewardDistributionAt ? { rewardDistributionAt: override.rewardDistributionAt } : {})
  };
}

async function loadSeasonalEventRuntimeOverride(
  redisClient: RedisClientLike | null,
  eventId: string
): Promise<SeasonalEventRuntimeOverrideLoadResult> {
  if (!redisClient) {
    return { override: seasonalEventRuntimeOverrides.get(eventId) ?? null, degraded: false };
  }

  try {
    const encoded = await redisClient.hget(SEASONAL_EVENT_RUNTIME_OVERRIDE_REDIS_HASH_KEY, eventId);
    const override = parseSeasonalEventRuntimeOverride(encoded);
    if (override) {
      seasonalEventRuntimeOverrides.set(eventId, cloneSeasonalEventRuntimeOverride(override));
      return { override, degraded: false };
    }
  } catch (error) {
    recordSeasonalEventRuntimeOverrideReadFailure();
    console.error("Seasonal event runtime override read failed; using local fallback", error);
    return { override: seasonalEventRuntimeOverrides.get(eventId) ?? null, degraded: true };
  }

  return { override: seasonalEventRuntimeOverrides.get(eventId) ?? null, degraded: false };
}

export function resolveSeasonalEventStatus(
  event: SeasonalEventDefinition,
  now = new Date()
): "scheduled" | "active" | "ended" {
  const runtimeEvent = event as RuntimeSeasonalEventDefinition;
  if (runtimeEvent.isActive === false) {
    return "ended";
  }
  if (runtimeEvent.isActive === true) {
    return "active";
  }
  if (new Date(event.endsAt).getTime() <= now.getTime()) {
    return "ended";
  }
  if (new Date(event.startsAt).getTime() <= now.getTime()) {
    return "active";
  }
  return "scheduled";
}

function readEventState(account: PlayerAccountSnapshot, eventId: string): SeasonalEventState | undefined {
  return account.seasonalEventStates?.find((state) => state.eventId === eventId);
}

function buildSeasonalEventParticipationStats(
  event: SeasonalEventDefinition,
  accounts: PlayerAccountSnapshot[]
): {
  participants: number;
  leaderboardEntries: number;
  totalPoints: number;
  claimedRewardCount: number;
} {
  let participants = 0;
  let totalPoints = 0;
  let claimedRewardCount = 0;

  for (const account of accounts) {
    const state = readEventState(account, event.id);
    if (!state) {
      continue;
    }
    if (state.points > 0 || state.claimedRewardIds.length > 0 || state.appliedActionIds.length > 0) {
      participants += 1;
    }
    totalPoints += state.points;
    claimedRewardCount += state.claimedRewardIds.length;
  }

  return {
    participants,
    leaderboardEntries: buildEventLeaderboard(event, accounts, event.leaderboard.size).length,
    totalPoints,
    claimedRewardCount
  };
}

function normalizeAdminRewardPatch(
  rewards: unknown,
  leaderboard: unknown,
  eventId: string,
  current: SeasonalEventDefinition
): Pick<SeasonalEventRuntimeOverride, "rewards" | "leaderboard"> {
  const patch: Pick<SeasonalEventRuntimeOverride, "rewards" | "leaderboard"> = {};

  if (rewards !== undefined) {
    if (!Array.isArray(rewards)) {
      throw new Error('"rewards" must be an array');
    }
    patch.rewards = rewards.map((reward, index) =>
      normalizeEventReward((reward ?? {}) as Partial<SeasonalEventReward>, `seasonal event ${eventId} reward patch[${index}]`)
    );
  }

  if (leaderboard !== undefined) {
    if (typeof leaderboard !== "object" || leaderboard === null || Array.isArray(leaderboard)) {
      throw new Error('"leaderboard" must be an object');
    }
    const leaderboardPatch = leaderboard as {
      size?: unknown;
      rewardTiers?: unknown;
    };
    const nextLeaderboard: SeasonalEventRuntimeOverride["leaderboard"] = {};
    if (leaderboardPatch.size !== undefined) {
      if (typeof leaderboardPatch.size !== "number" || !Number.isFinite(leaderboardPatch.size) || leaderboardPatch.size < 1) {
        throw new Error('"leaderboard.size" must be a positive number');
      }
      nextLeaderboard.size = Math.floor(leaderboardPatch.size);
    }
    if (leaderboardPatch.rewardTiers !== undefined) {
      if (!Array.isArray(leaderboardPatch.rewardTiers)) {
        throw new Error('"leaderboard.rewardTiers" must be an array');
      }
      nextLeaderboard.rewardTiers = leaderboardPatch.rewardTiers.map((tier, index) =>
        normalizeLeaderboardRewardTier(
          (tier ?? {}) as Partial<SeasonalEventLeaderboardRewardTier>,
          `seasonal event ${eventId} leaderboard.rewardTiers patch[${index}]`
        )
      );
    }
    patch.leaderboard = {
      size: nextLeaderboard.size ?? current.leaderboard.size,
      rewardTiers: nextLeaderboard.rewardTiers ?? current.leaderboard.rewardTiers
    };
  }

  return patch;
}

function normalizeAdminEventPatch(
  eventId: string,
  body: Record<string, unknown>,
  current: SeasonalEventDefinition
): SeasonalEventRuntimeOverride {
  const patch: SeasonalEventRuntimeOverride = {
    ...normalizeAdminRewardPatch(body.rewards, body.leaderboard, eventId, current)
  };
  if (body.startsAt !== undefined) {
    if (typeof body.startsAt !== "string") {
      throw new Error('"startsAt" must be a valid ISO timestamp');
    }
    patch.startsAt = normalizeTimestamp(body.startsAt, `${eventId}.startsAt`);
  }
  if (body.endsAt !== undefined) {
    if (typeof body.endsAt !== "string") {
      throw new Error('"endsAt" must be a valid ISO timestamp');
    }
    patch.endsAt = normalizeTimestamp(body.endsAt, `${eventId}.endsAt`);
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") {
      throw new Error('"isActive" must be a boolean');
    }
    patch.isActive = body.isActive;
  }

  const nextStartsAt = patch.startsAt ?? current.startsAt;
  const nextEndsAt = patch.endsAt ?? current.endsAt;
  if (new Date(nextEndsAt).getTime() <= new Date(nextStartsAt).getTime()) {
    throw new Error('"endsAt" must be later than "startsAt"');
  }

  return patch;
}

export function applySeasonalEventAdminPatch(eventId: string, patch: SeasonalEventRuntimeOverride): void {
  const current = seasonalEventRuntimeOverrides.get(eventId) ?? {};
  seasonalEventRuntimeOverrides.set(eventId, mergeSeasonalEventRuntimeOverride(current, patch));
}

async function applySeasonalEventAdminPatchWithClusterState(
  eventId: string,
  patch: SeasonalEventRuntimeOverride,
  redisClient: RedisClientLike | null
): Promise<SeasonalEventRuntimeOverrideApplyResult> {
  if (!redisClient) {
    applySeasonalEventAdminPatch(eventId, patch);
    return { degraded: false };
  }

  try {
    const encoded = await redisClient.hget(SEASONAL_EVENT_RUNTIME_OVERRIDE_REDIS_HASH_KEY, eventId);
    const current = parseSeasonalEventRuntimeOverride(encoded) ?? seasonalEventRuntimeOverrides.get(eventId) ?? {};
    const next = mergeSeasonalEventRuntimeOverride(current, patch);
    await redisClient.hset(SEASONAL_EVENT_RUNTIME_OVERRIDE_REDIS_HASH_KEY, eventId, JSON.stringify(next));
    seasonalEventRuntimeOverrides.set(eventId, cloneSeasonalEventRuntimeOverride(next));
    return { degraded: false };
  } catch (error) {
    recordSeasonalEventRuntimeOverridePersistFailure();
    recordSeasonalEventRuntimeOverrideLocalFallbackWrite();
    console.error("Seasonal event runtime override persistence failed; using local fallback", error);
    applySeasonalEventAdminPatch(eventId, patch);
    return { degraded: true };
  }
}

function resetSeasonalEventProgressState(
  account: PlayerAccountSnapshot,
  eventId: string
): SeasonalEventState[] | null {
  const remainingStates = (account.seasonalEventStates ?? []).filter((state) => state.eventId !== eventId);
  return remainingStates.length > 0 ? remainingStates : null;
}

function resolveEventRewardGrant(reward: SeasonalEventReward): NonNullable<ReturnType<typeof normalizePlayerMailboxMessage>["grant"]> {
  return {
    ...(reward.gems ? { gems: reward.gems } : {}),
    ...(reward.resources ? { resources: reward.resources } : {}),
    ...(reward.badge ? { seasonBadges: [reward.badge] } : {})
  };
}

async function distributeSeasonalEventRewards(
  store: RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPlayerAccounts" | "deliverPlayerMailbox">>,
  event: SeasonalEventDefinition,
  distributedAt: Date
): Promise<{ deliveredThresholdRewards: number; deliveredLeaderboardRewards: number }> {
  const accounts = await store.listPlayerAccounts({ limit: 10_000, offset: 0 });
  let deliveredThresholdRewards = 0;
  let deliveredLeaderboardRewards = 0;
  const sentAt = distributedAt.toISOString();
  const expiresAt = new Date(distributedAt.getTime() + 1000 * 60 * 60 * 24 * 30).toISOString();

  for (const account of accounts) {
    const state = readEventState(account, event.id);
    if (!state) {
      continue;
    }

    for (const reward of event.rewards) {
      if (state.points < reward.pointsRequired || state.claimedRewardIds.includes(reward.id)) {
        continue;
      }
      const delivery = await store.deliverPlayerMailbox({
        playerIds: [account.playerId],
        message: normalizePlayerMailboxMessage({
          id: `seasonal-event:${event.id}:reward:${reward.id}`,
          kind: "system",
          title: `${event.name} 奖励补发`,
          body: `运营已结束 ${event.name}，你已达成 ${reward.name} 的条件，奖励已发送至邮箱附件。`,
          sentAt,
          expiresAt,
          grant: resolveEventRewardGrant(reward)
        })
      });
      if (delivery.deliveredPlayerIds.includes(account.playerId)) {
        deliveredThresholdRewards += 1;
      }
    }
  }

  const leaderboard = buildEventLeaderboard(event, accounts, event.leaderboard.size);
  for (const entry of leaderboard) {
    const rewardTier = event.leaderboard.rewardTiers.find((tier) => tier.rankStart <= entry.rank && entry.rank <= tier.rankEnd);
    if (!rewardTier) {
      continue;
    }
    const delivery = await store.deliverPlayerMailbox({
      playerIds: [entry.playerId],
      message: normalizePlayerMailboxMessage({
        id: `seasonal-event:${event.id}:leaderboard`,
        kind: "system",
        title: `${event.name} 结算奖励`,
        body: `你在 ${event.name} 中获得 ${rewardTier.title}（排名 #${entry.rank}），奖励已发放到邮箱附件。`,
        sentAt,
        expiresAt,
        grant: {
          ...(rewardTier.badge ? { seasonBadges: [rewardTier.badge] } : {}),
          ...(rewardTier.cosmeticId ? { cosmeticIds: [rewardTier.cosmeticId] } : {})
        }
      })
    });
    if (delivery.deliveredPlayerIds.includes(entry.playerId)) {
      deliveredLeaderboardRewards += 1;
    }
  }

  return {
    deliveredThresholdRewards,
    deliveredLeaderboardRewards
  };
}

function normalizeQuestRotationEntry(entry: PlayerQuestRotationHistoryEntry): PlayerQuestRotationHistoryEntry {
  return {
    dateKey: entry.dateKey,
    questIds: normalizeQuestIds(entry.questIds),
    completedQuestIds: normalizeQuestIds(entry.completedQuestIds),
    claimedQuestIds: normalizeQuestIds(entry.claimedQuestIds)
  };
}

function trimQuestRotations(rotations: PlayerQuestRotationHistoryEntry[], dateKey: string): PlayerQuestRotationHistoryEntry[] {
  const currentDayIndex = toUtcDayIndex(dateKey);
  return rotations
    .filter((entry) => isValidDateKey(entry.dateKey) && currentDayIndex - toUtcDayIndex(entry.dateKey) < DAILY_QUEST_NO_REPEAT_WINDOW_DAYS)
    .map(normalizeQuestRotationEntry)
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));
}

function pickWeightedQuest(
  available: DailyQuestConfigDefinition[],
  random: () => number
): DailyQuestConfigDefinition {
  const totalWeight = available.reduce((sum, quest) => sum + DAILY_QUEST_TIER_WEIGHTS[quest.tier], 0);
  let cursor = random() * totalWeight;
  for (const quest of available) {
    cursor -= DAILY_QUEST_TIER_WEIGHTS[quest.tier];
    if (cursor <= 0) {
      return quest;
    }
  }

  return available[available.length - 1]!;
}

function selectWeightedQuestSet(
  questPool: DailyQuestConfigDefinition[],
  random: () => number,
  excludedQuestIds: Set<string>
): DailyQuestConfigDefinition[] {
  const selected: DailyQuestConfigDefinition[] = [];
  let available = questPool.filter((quest) => !excludedQuestIds.has(quest.id)).sort((left, right) => left.id.localeCompare(right.id));
  if (available.length < DAILY_QUEST_SELECTION_SIZE) {
    available = questPool.slice().sort((left, right) => left.id.localeCompare(right.id));
  }

  while (selected.length < DAILY_QUEST_SELECTION_SIZE && available.length > 0) {
    const choice = pickWeightedQuest(available, random);
    selected.push(choice);
    available = available.filter((quest) => quest.id !== choice.id);
  }

  return selected;
}

export function rotateDailyQuests(input: RotateDailyQuestsInput): RotateDailyQuestsResult {
  if (!isValidDateKey(input.dateKey)) {
    throw new Error(`rotateDailyQuests received invalid dateKey "${input.dateKey}"`);
  }
  if (input.questPool.length < DAILY_QUEST_SELECTION_SIZE) {
    throw new Error("rotateDailyQuests requires at least three quest definitions");
  }

  const questPool = input.questPool.slice().sort((left, right) => left.id.localeCompare(right.id));
  const existingState = input.questState ?? null;
  const trimmedRotations = trimQuestRotations(existingState?.rotations ?? [], input.dateKey);
  const currentRotation = trimmedRotations.find((entry) => entry.dateKey === input.dateKey);

  if (currentRotation) {
    const questById = new Map(questPool.map((quest) => [quest.id, quest]));
    const quests = currentRotation.questIds
      .map((questId) => questById.get(questId))
      .filter((quest): quest is DailyQuestConfigDefinition => Boolean(quest));

    return {
      quests,
      rotated: false,
      state: {
        playerId: input.playerId,
        currentDateKey: input.dateKey,
        activeQuestIds: currentRotation.questIds,
        rotations: trimmedRotations,
        updatedAt: existingState?.updatedAt ?? new Date().toISOString()
      }
    };
  }

  const excludedQuestIds = new Set(
    trimmedRotations
      .filter((entry) => entry.dateKey !== input.dateKey)
      .flatMap((entry) => entry.questIds)
  );
  const selectedQuests = selectWeightedQuestSet(
    questPool,
    createSeededRandom(`${input.playerId}:${input.dateKey}`),
    excludedQuestIds
  );
  const nextEntry: PlayerQuestRotationHistoryEntry = {
    dateKey: input.dateKey,
    questIds: selectedQuests.map((quest) => quest.id),
    completedQuestIds: [],
    claimedQuestIds: []
  };
  const nextRotations = trimQuestRotations([...trimmedRotations.filter((entry) => entry.dateKey !== input.dateKey), nextEntry], input.dateKey);

  return {
    quests: selectedQuests,
    rotated: true,
    state: {
      playerId: input.playerId,
      currentDateKey: input.dateKey,
      activeQuestIds: nextEntry.questIds,
      rotations: nextRotations,
      updatedAt: new Date().toISOString()
    }
  };
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function toErrorPayload(error: unknown): { code: string; message: string } {
  return {
    code: error instanceof Error ? error.name || "error" : "error",
    message: error instanceof Error ? error.message : String(error)
  };
}

function sendUnauthorized(
  response: ServerResponse,
  errorCode: "unauthorized" | "token_expired" | "token_kind_invalid" | "session_revoked" = "unauthorized"
): void {
  sendJson(response, 401, {
    error: {
      code: errorCode,
      message:
        errorCode === "token_expired"
          ? "Auth token has expired"
          : errorCode === "session_revoked"
            ? "Auth session has been revoked"
            : "Guest auth session is missing or invalid"
    }
  });
}

function sendAccountBanned(response: ServerResponse, ban?: { banReason?: string; banExpiry?: string } | null): void {
  sendJson(response, 403, {
    error: {
      code: "account_banned",
      message: "Account is banned",
      reason: ban?.banReason ?? "No reason provided",
      ...(ban?.banExpiry ? { expiry: ban.banExpiry } : {})
    }
  });
}

async function requireAuthSession(request: IncomingMessage, response: ServerResponse, store: RoomSnapshotStore | null) {
  const result = await validateAuthSessionFromRequest(request, store);
  if (!result.session) {
    if (result.errorCode === "account_banned") {
      sendAccountBanned(response, result.ban);
      return null;
    }
    sendUnauthorized(response, result.errorCode ?? "unauthorized");
    return null;
  }

  return result.session;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeTimestamp(value: string | null | undefined, field: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${field} is required`);
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }

  return parsed.toISOString();
}

function normalizeNonNegativeInteger(value: number | null | undefined, field: string, minimum = 0): number {
  const normalized = Math.floor(value ?? Number.NaN);
  if (!Number.isFinite(normalized) || normalized < minimum) {
    throw new Error(`${field} must be an integer >= ${minimum}`);
  }
  return normalized;
}

function normalizeEventReward(rawReward: Partial<SeasonalEventReward> | null | undefined, field: string): SeasonalEventReward {
  const candidate = rawReward ?? {};
  const id = candidate.id?.trim();
  const name = candidate.name?.trim();
  if (!id || !name) {
    throw new Error(`${field} must define id and name`);
  }

  return {
    id,
    name,
    pointsRequired: normalizeNonNegativeInteger(candidate.pointsRequired, `${field}.pointsRequired`, 1),
    kind: candidate.kind ?? "gems",
    ...(candidate.gems != null ? { gems: normalizeNonNegativeInteger(candidate.gems, `${field}.gems`) } : {}),
    ...(candidate.resources
      ? {
          resources: {
            ...(candidate.resources.gold != null
              ? { gold: normalizeNonNegativeInteger(candidate.resources.gold, `${field}.resources.gold`) }
              : {}),
            ...(candidate.resources.wood != null
              ? { wood: normalizeNonNegativeInteger(candidate.resources.wood, `${field}.resources.wood`) }
              : {}),
            ...(candidate.resources.ore != null
              ? { ore: normalizeNonNegativeInteger(candidate.resources.ore, `${field}.resources.ore`) }
              : {})
          }
        }
      : {}),
    ...(candidate.badge?.trim() ? { badge: candidate.badge.trim() } : {}),
    ...(candidate.cosmeticId?.trim() ? { cosmeticId: candidate.cosmeticId.trim() } : {})
  };
}

function normalizeLeaderboardRewardTier(
  rawTier: Partial<SeasonalEventLeaderboardRewardTier> | null | undefined,
  field: string
): SeasonalEventLeaderboardRewardTier {
  const candidate = rawTier ?? {};
  const title = candidate.title?.trim();
  if (!title) {
    throw new Error(`${field}.title is required`);
  }

  return {
    rankStart: normalizeNonNegativeInteger(candidate.rankStart, `${field}.rankStart`, 1),
    rankEnd: normalizeNonNegativeInteger(candidate.rankEnd, `${field}.rankEnd`, 1),
    title,
    ...(candidate.badge?.trim() ? { badge: candidate.badge.trim() } : {}),
    ...(candidate.cosmeticId?.trim() ? { cosmeticId: candidate.cosmeticId.trim() } : {})
  };
}

function normalizeObjective(
  rawObjective: Partial<SeasonalEventObjective> | null | undefined,
  field: string
): SeasonalEventObjective {
  const candidate = rawObjective ?? {};
  const id = candidate.id?.trim();
  const description = candidate.description?.trim();
  if (!id || !description) {
    throw new Error(`${field} must define id and description`);
  }

  return {
    id,
    description,
    actionType: candidate.actionType ?? "daily_dungeon_reward_claimed",
    points: normalizeNonNegativeInteger(candidate.points, `${field}.points`, 1),
    ...(candidate.dungeonId?.trim() ? { dungeonId: candidate.dungeonId.trim() } : {})
  };
}

const DEFAULT_EVENT_DOCUMENTS: Record<string, SeasonalEventDefinitionDocument> = {
  "defend-the-bridge": defendTheBridgeDocument as SeasonalEventDefinitionDocument
};

export function resolveSeasonalEvents(
  eventIndexDocument: SeasonalEventsDocument = seasonalEventsDocument as SeasonalEventsDocument,
  eventDocuments: Record<string, SeasonalEventDefinitionDocument> = DEFAULT_EVENT_DOCUMENTS
): SeasonalEventDefinition[] {
  const summaries = eventIndexDocument.events ?? [];
  if (summaries.length === 0) {
    return [];
  }

  return summaries.map((summary, index) => {
    const id = summary.id?.trim();
    if (!id) {
      throw new Error(`seasonal event summary[${index}] id is required`);
    }

    const detail = eventDocuments[id];
    if (!detail) {
      throw new Error(`seasonal event ${id} is missing a detail document`);
    }

    const rewardTiers = (detail.leaderboard?.rewardTiers ?? []).map((tier, tierIndex) =>
      normalizeLeaderboardRewardTier(tier, `seasonal event ${id} leaderboard.rewardTiers[${tierIndex}]`)
    );

    return applySeasonalEventRuntimeOverride({
      id,
      name: detail.name?.trim() || summary.name?.trim() || id,
      description: detail.description?.trim() || summary.description?.trim() || "",
      startsAt: normalizeTimestamp(detail.startsAt ?? summary.startsAt, `seasonal event ${id}.startsAt`),
      endsAt: normalizeTimestamp(detail.endsAt ?? summary.endsAt, `seasonal event ${id}.endsAt`),
      durationDays: normalizeNonNegativeInteger(
        detail.durationDays ?? summary.durationDays,
        `seasonal event ${id}.durationDays`,
        1
      ),
      bannerText: detail.bannerText?.trim() || summary.bannerText?.trim() || "",
      objectives: (detail.objectives ?? []).map((objective, objectiveIndex) =>
        normalizeObjective(objective, `seasonal event ${id} objective[${objectiveIndex}]`)
      ),
      rewards: (detail.rewards ?? []).map((reward, rewardIndex) =>
        normalizeEventReward(reward, `seasonal event ${id} reward[${rewardIndex}]`)
      ),
      leaderboard: {
        size: normalizeNonNegativeInteger(
          detail.leaderboard?.size ?? summary.leaderboard?.size,
          `seasonal event ${id}.leaderboard.size`,
          1
        ),
        rewardTiers
      }
    });
  });
}

export function getActiveSeasonalEvents(events: SeasonalEventDefinition[], now = new Date()): SeasonalEventDefinition[] {
  return events.filter((event) => resolveSeasonalEventStatus(event, now) === "active");
}

async function resolveSeasonalEventsWithClusterStateDetails(
  redisClient: RedisClientLike | null,
  eventIndexDocument: SeasonalEventsDocument | undefined,
  eventDocuments: Record<string, SeasonalEventDefinitionDocument> | undefined
): Promise<SeasonalEventClusterStateResult> {
  const events = resolveSeasonalEvents(eventIndexDocument, eventDocuments);
  if (!redisClient) {
    return { events, degraded: false };
  }

  let degraded = false;
  const resolvedEvents = await Promise.all(
    events.map(async (event) => {
      const { override, degraded: eventDegraded } = await loadSeasonalEventRuntimeOverride(redisClient, event.id);
      degraded = degraded || eventDegraded;
      return override ? applySeasonalEventRuntimeOverride(event, override) : event;
    })
  );
  return { events: resolvedEvents, degraded };
}

async function resolveSeasonalEventsWithClusterState(
  redisClient: RedisClientLike | null,
  eventIndexDocument: SeasonalEventsDocument | undefined,
  eventDocuments: Record<string, SeasonalEventDefinitionDocument> | undefined
): Promise<SeasonalEventDefinition[]> {
  return (await resolveSeasonalEventsWithClusterStateDetails(redisClient, eventIndexDocument, eventDocuments)).events;
}

export function findSeasonalEventState(
  seasonalEventStates: SeasonalEventState[] | null | undefined,
  eventId: string
): SeasonalEventState | undefined {
  return seasonalEventStates?.find((state) => state.eventId === eventId);
}

function upsertSeasonalEventState(
  seasonalEventStates: SeasonalEventState[] | null | undefined,
  nextState: SeasonalEventState
): SeasonalEventState[] {
  const remainingStates = (seasonalEventStates ?? []).filter((state) => state.eventId !== nextState.eventId);
  return [...remainingStates, nextState].sort((left, right) => left.eventId.localeCompare(right.eventId));
}

export function applySeasonalEventProgress(
  event: SeasonalEventDefinition,
  currentState: SeasonalEventState | null | undefined,
  action: SeasonalEventActionInput,
  now = new Date()
): { state: SeasonalEventState; objective: SeasonalEventObjective; delta: number } | null {
  const objective = event.objectives.find(
    (entry) =>
      entry.actionType === action.actionType && (!entry.dungeonId || !action.dungeonId || entry.dungeonId === action.dungeonId)
  );
  if (!objective) {
    return null;
  }

  const actionId = action.actionId.trim();
  if (!actionId) {
    throw new Error("seasonal_event_action_id_required");
  }

  if (currentState?.appliedActionIds.includes(actionId)) {
    return null;
  }

  const appliedActionIds = Array.from(new Set([...(currentState?.appliedActionIds ?? []), actionId])).sort((left, right) =>
    left.localeCompare(right)
  );
  const lastUpdatedAt = action.occurredAt ? normalizeTimestamp(action.occurredAt, "seasonal event action occurredAt") : now.toISOString();

  return {
    objective,
    delta: objective.points,
    state: {
      eventId: event.id,
      points: Math.max(0, (currentState?.points ?? 0) + objective.points),
      claimedRewardIds: [...(currentState?.claimedRewardIds ?? [])],
      appliedActionIds,
      lastUpdatedAt
    }
  };
}

export function claimSeasonalEventReward(
  event: SeasonalEventDefinition,
  currentState: SeasonalEventState | null | undefined,
  rewardId: string,
  now = new Date()
): { state: SeasonalEventState; reward: SeasonalEventReward } {
  const reward = event.rewards.find((entry) => entry.id === rewardId.trim());
  if (!reward) {
    throw new Error("seasonal_event_reward_not_found");
  }

  const state = currentState;
  if (!state) {
    throw new Error("seasonal_event_reward_locked");
  }
  if (state.points < reward.pointsRequired) {
    throw new Error("seasonal_event_reward_locked");
  }
  if (state.claimedRewardIds.includes(reward.id)) {
    throw new Error("seasonal_event_reward_already_claimed");
  }

  return {
    reward,
    state: {
      ...state,
      claimedRewardIds: [...state.claimedRewardIds, reward.id].sort((left, right) => left.localeCompare(right)),
      lastUpdatedAt: now.toISOString()
    }
  };
}

function rewardPreviewForRank(
  leaderboardRewardTiers: SeasonalEventDefinition["leaderboard"]["rewardTiers"],
  rank: number
): string | undefined {
  return leaderboardRewardTiers.find((tier) => tier.rankStart <= rank && rank <= tier.rankEnd)?.title;
}

export function buildEventLeaderboard(
  event: SeasonalEventDefinition,
  accounts: PlayerAccountSnapshot[],
  limit = event.leaderboard.size
): EventLeaderboardEntry[] {
  return accounts
    .map((account) => {
      const state = findSeasonalEventState(account.seasonalEventStates, event.id);
      if (!state || state.points <= 0) {
        return null;
      }

      return {
        playerId: account.playerId,
        displayName: account.displayName,
        points: state.points,
        lastUpdatedAt: state.lastUpdatedAt
      };
    })
    .filter(
      (
        entry
      ): entry is {
        playerId: string;
        displayName: string;
        points: number;
        lastUpdatedAt: string;
      } => Boolean(entry)
    )
    .sort(
      (left, right) =>
        right.points - left.points ||
        left.lastUpdatedAt.localeCompare(right.lastUpdatedAt) ||
        left.playerId.localeCompare(right.playerId)
    )
    .slice(0, Math.max(1, limit))
    .map((entry, index) => {
      const rewardPreview = rewardPreviewForRank(event.leaderboard.rewardTiers, index + 1);
      return {
        rank: index + 1,
        ...entry,
        ...(rewardPreview ? { rewardPreview } : {})
      };
    });
}

function toEventResponse(event: SeasonalEventDefinition, account: PlayerAccountSnapshot, leaderboard: EventLeaderboardEntry[], now: Date) {
  const state = findSeasonalEventState(account.seasonalEventStates, event.id);
  return {
    ...event,
    remainingMs: Math.max(0, new Date(event.endsAt).getTime() - now.getTime()),
    player: {
      points: state?.points ?? 0,
      claimedRewardIds: state?.claimedRewardIds ?? [],
      claimableRewardIds: event.rewards
        .filter((reward) => (state?.points ?? 0) >= reward.pointsRequired && !(state?.claimedRewardIds ?? []).includes(reward.id))
        .map((reward) => reward.id)
    },
    leaderboard: {
      entries: leaderboard,
      topThree: leaderboard.slice(0, 3)
    }
  };
}

function resolveRateLimitRedisClient(options: RegisterEventRoutesOptions): RedisClientLike | null | undefined {
  if (options.rateLimitRedisClient !== undefined) {
    return options.rateLimitRedisClient;
  }
  if (options.rateLimitRedisUrl !== undefined) {
    return options.rateLimitRedisUrl
      ? (options.rateLimitCreateRedisClient ?? createRedisClient)(options.rateLimitRedisUrl)
      : null;
  }
  return undefined;
}

function resolveSeasonalEventRuntimeRedisClient(options: RegisterEventRoutesOptions): RedisClientLike | null {
  if (options.seasonalEventRuntimeRedisClient !== undefined) {
    return options.seasonalEventRuntimeRedisClient;
  }

  const redisUrl = options.seasonalEventRuntimeRedisUrl ?? readRedisUrl();
  return redisUrl ? (options.seasonalEventRuntimeCreateRedisClient ?? createRedisClient)(redisUrl) : null;
}

function isSeasonalEventOpsAuditRedisClient(
  redisClient: RedisClientLike | SeasonalEventOpsAuditRedisClient | null
): redisClient is SeasonalEventOpsAuditRedisClient {
  return (
    redisClient !== null &&
    typeof redisClient.lrange === "function" &&
    typeof (redisClient as Partial<SeasonalEventOpsAuditRedisClient>).lpush === "function" &&
    typeof (redisClient as Partial<SeasonalEventOpsAuditRedisClient>).ltrim === "function"
  );
}

function resolveSeasonalEventOpsAuditRedisClient(
  options: RegisterEventRoutesOptions,
  seasonalEventRuntimeRedisClient: RedisClientLike | null
): SeasonalEventOpsAuditRedisClient | null {
  if (options.seasonalEventOpsAuditRedisClient !== undefined) {
    return options.seasonalEventOpsAuditRedisClient;
  }
  if (options.seasonalEventOpsAuditRedisUrl !== undefined) {
    return options.seasonalEventOpsAuditRedisUrl
      ? ((options.seasonalEventOpsAuditCreateRedisClient ?? createRedisClient)(
          options.seasonalEventOpsAuditRedisUrl
        ) as unknown as SeasonalEventOpsAuditRedisClient)
      : null;
  }
  return isSeasonalEventOpsAuditRedisClient(seasonalEventRuntimeRedisClient)
    ? seasonalEventRuntimeRedisClient
    : null;
}

export function registerEventRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    patch?: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
    delete?: (path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null,
  options: RegisterEventRoutesOptions = {}
): void {
  const nowFactory = options.now ?? (() => new Date());
  const rateLimitRedisClient = resolveRateLimitRedisClient(options);
  const seasonalEventRuntimeRedisClient = resolveSeasonalEventRuntimeRedisClient(options);
  const seasonalEventOpsAuditRedisClient = resolveSeasonalEventOpsAuditRedisClient(
    options,
    seasonalEventRuntimeRedisClient
  );

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth, X-Veil-Admin-Token");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/events/active", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const now = nowFactory();
      const events = await resolveSeasonalEventsWithClusterState(
        seasonalEventRuntimeRedisClient,
        options.eventIndexDocument,
        options.eventDocuments
      );
      const activeEvents = getActiveSeasonalEvents(events, now);
      const account = store
        ? ((await store.loadPlayerAccount(authSession.playerId)) ??
          (await store.ensurePlayerAccount({
            playerId: authSession.playerId,
            displayName: authSession.displayName
          })))
        : {
            playerId: authSession.playerId,
            displayName: authSession.displayName,
            globalResources: { gold: 0, wood: 0, ore: 0 },
            achievements: [],
            recentEventLog: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          };
      const accounts = store ? await store.listPlayerAccounts() : [];

      sendJson(response, 200, {
        events: activeEvents.map((event) => toEventResponse(event, account, buildEventLeaderboard(event, accounts), now))
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/events/claim", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "seasonal_event_persistence_unavailable",
          message: "Seasonal event claims require configured room persistence storage"
        }
      });
      return;
    }

    try {
      const events = await resolveSeasonalEventsWithClusterState(
        seasonalEventRuntimeRedisClient,
        options.eventIndexDocument,
        options.eventDocuments
      );
      const body = (await readJsonBody(request)) as { eventId?: string | null; rewardId?: string | null };
      const eventId = body.eventId?.trim();
      const rewardId = body.rewardId?.trim();
      if (!eventId || !rewardId) {
        sendJson(response, 400, {
          error: {
            code: "seasonal_event_claim_invalid",
            message: "eventId and rewardId are required"
          }
        });
        return;
      }

      const now = nowFactory();
      const event = getActiveSeasonalEvents(events, now).find((entry) => entry.id === eventId);
      if (!event) {
        sendJson(response, 404, {
          error: {
            code: "seasonal_event_not_found",
            message: "Seasonal event was not found or is not active"
          }
        });
        return;
      }

      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      const claim = claimSeasonalEventReward(event, findSeasonalEventState(account.seasonalEventStates, event.id), rewardId, now);
      const nextResources = {
        gold: Math.max(0, (account.globalResources.gold ?? 0) + (claim.reward.resources?.gold ?? 0)),
        wood: Math.max(0, (account.globalResources.wood ?? 0) + (claim.reward.resources?.wood ?? 0)),
        ore: Math.max(0, (account.globalResources.ore ?? 0) + (claim.reward.resources?.ore ?? 0))
      };
      const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
        gems: Math.max(0, (account.gems ?? 0) + (claim.reward.gems ?? 0)),
        globalResources: nextResources,
        ...(claim.reward.badge
          ? {
              seasonBadges: Array.from(new Set([...(account.seasonBadges ?? []), claim.reward.badge])).sort((left, right) =>
                left.localeCompare(right)
              )
            }
          : {}),
        seasonalEventStates: upsertSeasonalEventState(account.seasonalEventStates, claim.state)
      });
      emitAnalyticsEvent("seasonal_event_reward_claimed", {
        playerId: account.playerId,
        roomId: account.lastRoomId ?? `seasonal-event:${event.id}`,
        payload: {
          eventId: event.id,
          rewardId: claim.reward.id,
          rewardKind: claim.reward.kind,
          pointsRequired: claim.reward.pointsRequired
        }
      });

      sendJson(response, 200, {
        claimed: true,
        reward: claim.reward,
        event: toEventResponse(event, nextAccount, buildEventLeaderboard(event, await store.listPlayerAccounts()), now)
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "seasonal_event_reward_not_found") {
        sendJson(response, 404, {
          error: {
            code: "seasonal_event_reward_not_found",
            message: "Seasonal event reward was not found"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "seasonal_event_reward_locked") {
        sendJson(response, 409, {
          error: {
            code: "seasonal_event_reward_locked",
            message: "Seasonal event reward is not claimable yet"
          }
        });
        return;
      }
      if (error instanceof Error && error.message === "seasonal_event_reward_already_claimed") {
        sendJson(response, 409, {
          error: {
            code: "seasonal_event_reward_already_claimed",
            message: "Seasonal event reward has already been claimed"
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/events/:eventId/progress", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    if (isActionSubmissionRateLimitEnabled()) {
      const rateLimitResult = await consumeActionSubmissionRateLimit(`seasonal-event-progress:${authSession.playerId}`, {
        ...(rateLimitRedisClient === undefined ? {} : { redisClient: rateLimitRedisClient })
      });
      if (!rateLimitResult.allowed) {
        if (rateLimitResult.retryAfterSeconds != null) {
          response.setHeader("Retry-After", String(rateLimitResult.retryAfterSeconds));
        }
        sendJson(response, 429, {
          error: {
            code: "rate_limited",
            message: "Too many requests, please retry later"
          }
        });
        return;
      }
    }

    if (!store) {
      sendJson(response, 503, {
        error: {
          code: "seasonal_event_persistence_unavailable",
          message: "Seasonal event progress requires configured room persistence storage"
        }
      });
      return;
    }

    try {
      const events = await resolveSeasonalEventsWithClusterState(
        seasonalEventRuntimeRedisClient,
        options.eventIndexDocument,
        options.eventDocuments
      );
      const routeRequest = request as IncomingMessage & { params?: Record<string, string | undefined> };
      const eventId = routeRequest.params?.eventId?.trim();
      if (!eventId) {
        sendJson(response, 400, {
          error: {
            code: "seasonal_event_progress_invalid",
            message: "eventId is required"
          }
        });
        return;
      }

      const body = (await readJsonBody(request)) as {
        actionId?: string | null;
        actionType?: SeasonalEventObjective["actionType"] | null;
        dungeonId?: string | null;
        occurredAt?: string | null;
      };
      const actionId = body.actionId?.trim();
      const actionType = body.actionType?.trim();
      if (!actionId || !actionType) {
        sendJson(response, 400, {
          error: {
            code: "seasonal_event_progress_invalid",
            message: "actionId and actionType are required"
          }
        });
        return;
      }

      const now = body.occurredAt ? new Date(normalizeTimestamp(body.occurredAt, "occurredAt")) : nowFactory();
      const event = getActiveSeasonalEvents(events, now).find((entry) => entry.id === eventId);
      if (!event) {
        sendJson(response, 404, {
          error: {
            code: "seasonal_event_not_found",
            message: "Seasonal event was not found or is not active"
          }
        });
        return;
      }
      if (!isServerVerifiableSeasonalEventActionType(actionType)) {
        sendJson(response, 400, {
          error: {
            code: "seasonal_event_action_unsupported",
            message: "Seasonal event progress action is not server-verifiable"
          }
        });
        return;
      }

      const account =
        (await store.loadPlayerAccount(authSession.playerId)) ??
        (await store.ensurePlayerAccount({
          playerId: authSession.playerId,
          displayName: authSession.displayName
        }));
      if (actionType === "daily_dungeon_reward_claimed") {
        const expectedDungeonId = event.objectives.find(
          (objective) => objective.actionType === actionType && objective.dungeonId
        )?.dungeonId;
        if (!expectedDungeonId || !hasVerifiedDailyDungeonClaim(account, actionId, expectedDungeonId)) {
          sendJson(response, 403, {
            error: {
              code: "seasonal_event_action_not_verified",
              message: "Seasonal event progress must reference a claimed daily dungeon run"
            }
          });
          return;
        }
      }
      const progress = applySeasonalEventProgress(
        event,
        findSeasonalEventState(account.seasonalEventStates, event.id),
        {
          actionId,
          actionType,
          ...(body.dungeonId?.trim() ? { dungeonId: body.dungeonId.trim() } : {}),
          occurredAt: now.toISOString()
        },
        now
      );

      const nextAccount = progress
        ? await store.savePlayerAccountProgress(account.playerId, {
            seasonalEventStates: upsertSeasonalEventState(account.seasonalEventStates, progress.state)
          })
        : account;
      sendJson(response, 200, {
        applied: Boolean(progress),
        ...(progress
          ? {
              eventProgress: {
                eventId: event.id,
                delta: progress.delta,
                points: progress.state.points,
                objectiveId: progress.objective.id
              }
            }
          : {}),
        event: toEventResponse(event, nextAccount, buildEventLeaderboard(event, await store.listPlayerAccounts()), now)
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, {
          error: {
            code: "invalid_json",
            message: "Request body must be valid JSON"
          }
        });
        return;
      }
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.get("/api/admin/seasonal-events", async (request, response) => {
    if (!readRuntimeSecret("VEIL_ADMIN_TOKEN")) {
      sendAdminTokenNotConfigured(response);
      return;
    }
    if (!isAdminAuthorized(request)) {
      sendAdminUnauthorized(response);
      return;
    }

    try {
      const now = nowFactory();
      const clusterState = await resolveSeasonalEventsWithClusterStateDetails(
        seasonalEventRuntimeRedisClient,
        options.eventIndexDocument,
        options.eventDocuments
      );
      const events = clusterState.events;
      const accounts = store?.listPlayerAccounts ? await store.listPlayerAccounts({ limit: 10_000, offset: 0 }) : [];
      const url = new URL(request.url ?? "/api/admin/seasonal-events", "http://events.local");
      const auditOptions: { since?: string; actor?: string; eventId?: string; limit?: number } = {};
      const since = url.searchParams.get("since")?.trim();
      const actor = url.searchParams.get("actor")?.trim();
      const eventId = url.searchParams.get("eventId")?.trim();
      const limit = url.searchParams.has("limit") ? Number(url.searchParams.get("limit")) : undefined;
      if (since) {
        auditOptions.since = since;
      }
      if (actor) {
        auditOptions.actor = actor;
      }
      if (eventId) {
        auditOptions.eventId = eventId;
      }
      if (limit !== undefined && Number.isFinite(limit)) {
        auditOptions.limit = limit;
      }
      const audit = await listSeasonalEventOpsAuditTrailWithSharedStore(
        seasonalEventOpsAuditRedisClient,
        store as SeasonalEventOpsAuditArchiveStore | null,
        auditOptions
      );
      sendJson(response, 200, {
        checkedAt: now.toISOString(),
        events: events.map((event) => ({
          ...event,
          status: resolveSeasonalEventStatus(event, now),
          ...(event as RuntimeSeasonalEventDefinition).isActive !== undefined
            ? { isActive: (event as RuntimeSeasonalEventDefinition).isActive }
            : {},
          ...(event as RuntimeSeasonalEventDefinition).rewardDistributionAt
            ? { rewardDistributionAt: (event as RuntimeSeasonalEventDefinition).rewardDistributionAt }
            : {},
          participation: buildSeasonalEventParticipationStats(event, accounts)
        })),
        audit: audit.entries,
        auditDegraded: audit.degraded,
        auditSource: audit.source,
        patchDegraded: clusterState.degraded
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.patch?.("/api/admin/seasonal-events/:id", async (request, response) => {
    if (!readRuntimeSecret("VEIL_ADMIN_TOKEN")) {
      sendAdminTokenNotConfigured(response);
      return;
    }
    if (!isAdminAuthorized(request)) {
      sendAdminUnauthorized(response);
      return;
    }

    try {
      const routeRequest = request as IncomingMessage & { params?: Record<string, string | undefined> };
      const eventId = routeRequest.params?.id?.trim();
      if (!eventId) {
        sendJson(response, 400, { error: { code: "seasonal_event_invalid", message: "event id is required" } });
        return;
      }
      const events = await resolveSeasonalEventsWithClusterState(
        seasonalEventRuntimeRedisClient,
        options.eventIndexDocument,
        options.eventDocuments
      );
      const event = events.find((entry) => entry.id === eventId);
      if (!event) {
        sendJson(response, 404, { error: { code: "seasonal_event_not_found", message: "Seasonal event was not found" } });
        return;
      }
      const body = await readJsonBody(request);
      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        sendJson(response, 400, { error: { code: "invalid_request", message: "Request body must be an object" } });
        return;
      }
      const occurredAt = nowFactory().toISOString();
      const patch = normalizeAdminEventPatch(eventId, body as Record<string, unknown>, event);
      const patchResult = await applySeasonalEventAdminPatchWithClusterState(eventId, patch, seasonalEventRuntimeRedisClient);
      const nextEvent = (
        await resolveSeasonalEventsWithClusterState(
          seasonalEventRuntimeRedisClient,
          options.eventIndexDocument,
          options.eventDocuments
        )
      ).find((entry) => entry.id === eventId)!;
      const audit = await appendSeasonalEventOpsAuditEntryWithSharedStore(
        {
          action: "patched",
          actor: "admin-runtime",
          eventId,
          occurredAt,
          detail: "Patched seasonal event runtime settings",
          metadata: patch as unknown as Record<string, unknown>
        },
        seasonalEventOpsAuditRedisClient,
        store as SeasonalEventOpsAuditArchiveStore | null
      );
      sendJson(response, 200, {
        event: nextEvent,
        audit: audit.entry,
        auditDegraded: audit.degraded,
        patchDegraded: patchResult.degraded
      });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: { code: "invalid_json", message: "Request body must be valid JSON" } });
        return;
      }
      sendJson(response, 400, { error: toErrorPayload(error) });
    }
  });

  app.post("/api/admin/seasonal-events/:id/end", async (request, response) => {
    if (!readRuntimeSecret("VEIL_ADMIN_TOKEN")) {
      sendAdminTokenNotConfigured(response);
      return;
    }
    if (!isAdminAuthorized(request)) {
      sendAdminUnauthorized(response);
      return;
    }
    if (!store?.listPlayerAccounts || !store.deliverPlayerMailbox) {
      sendStoreUnavailable(
        response,
        "seasonal_event_persistence_unavailable",
        "Seasonal event force-end requires configured room persistence storage"
      );
      return;
    }

    try {
      const routeRequest = request as IncomingMessage & { params?: Record<string, string | undefined> };
      const eventId = routeRequest.params?.id?.trim();
      if (!eventId) {
        sendJson(response, 400, { error: { code: "seasonal_event_invalid", message: "event id is required" } });
        return;
      }

      const now = nowFactory();
      const events = await resolveSeasonalEventsWithClusterState(
        seasonalEventRuntimeRedisClient,
        options.eventIndexDocument,
        options.eventDocuments
      );
      const event = events.find((entry) => entry.id === eventId);
      if (!event) {
        sendJson(response, 404, { error: { code: "seasonal_event_not_found", message: "Seasonal event was not found" } });
        return;
      }
      if (resolveSeasonalEventStatus(event, now) !== "active") {
        sendJson(response, 409, {
          error: {
            code: "seasonal_event_not_active",
            message: "Seasonal event is not currently active"
          }
        });
        return;
      }

      const patchResult = await applySeasonalEventAdminPatchWithClusterState(
        eventId,
        {
          endsAt: now.toISOString(),
          isActive: false,
          rewardDistributionAt: now.toISOString()
        },
        seasonalEventRuntimeRedisClient
      );
      const endedEvent = (
        await resolveSeasonalEventsWithClusterState(
          seasonalEventRuntimeRedisClient,
          options.eventIndexDocument,
          options.eventDocuments
        )
      ).find((entry) => entry.id === eventId)!;
      const distribution = await distributeSeasonalEventRewards(
        store as RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPlayerAccounts" | "deliverPlayerMailbox">>,
        endedEvent,
        now
      );
      const audit = await appendSeasonalEventOpsAuditEntryWithSharedStore(
        {
          action: "force_ended",
          actor: "admin-runtime",
          eventId,
          occurredAt: now.toISOString(),
          detail: "Force-ended seasonal event and distributed rewards",
          metadata: distribution as unknown as Record<string, unknown>
        },
        seasonalEventOpsAuditRedisClient,
        store as SeasonalEventOpsAuditArchiveStore | null
      );
      sendJson(response, 200, {
        event: endedEvent,
        distribution,
        audit: audit.entry,
        auditDegraded: audit.degraded,
        patchDegraded: patchResult.degraded
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });

  app.delete?.("/api/admin/seasonal-events/:eventId/players/:playerId", async (request, response) => {
    if (!readRuntimeSecret("VEIL_ADMIN_TOKEN")) {
      sendAdminTokenNotConfigured(response);
      return;
    }
    if (!isAdminAuthorized(request)) {
      sendAdminUnauthorized(response);
      return;
    }
    if (!store?.loadPlayerAccount || !store.savePlayerAccountProgress) {
      sendStoreUnavailable(
        response,
        "seasonal_event_persistence_unavailable",
        "Seasonal event progress resets require configured room persistence storage"
      );
      return;
    }

    try {
      const routeRequest = request as IncomingMessage & { params?: Record<string, string | undefined> };
      const eventId = routeRequest.params?.eventId?.trim();
      const playerId = routeRequest.params?.playerId?.trim();
      if (!eventId || !playerId) {
        sendJson(response, 400, {
          error: {
            code: "seasonal_event_invalid",
            message: "eventId and playerId are required"
          }
        });
        return;
      }
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, { error: { code: "player_not_found", message: "Player account was not found" } });
        return;
      }
      const existingState = readEventState(account, eventId);
      if (!existingState) {
        sendJson(response, 404, {
          error: {
            code: "seasonal_event_progress_not_found",
            message: "Player has no seasonal event progress for the requested event"
          }
        });
        return;
      }
      const nextAccount = await store.savePlayerAccountProgress(playerId, {
        seasonalEventStates: resetSeasonalEventProgressState(account, eventId)
      });
      const audit = await appendSeasonalEventOpsAuditEntryWithSharedStore(
        {
          action: "player_progress_reset",
          actor: "admin-runtime",
          eventId,
          occurredAt: nowFactory().toISOString(),
          detail: "Reset seasonal event progress for a single player",
          metadata: {
            playerId,
            previousPoints: existingState.points
          }
        },
        seasonalEventOpsAuditRedisClient,
        store as SeasonalEventOpsAuditArchiveStore | null
      );
      sendJson(response, 200, {
        reset: true,
        playerId,
        eventId,
        account: nextAccount,
        audit: audit.entry,
        auditDegraded: audit.degraded
      });
    } catch (error) {
      sendJson(response, 500, { error: toErrorPayload(error) });
    }
  });
}
