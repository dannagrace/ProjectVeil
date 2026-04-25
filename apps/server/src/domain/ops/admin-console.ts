import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appendEventLogEntries, type EventLogEntry } from "@veil/shared/event-log";
import type { ResourceLedger, WorldState } from "@veil/shared/models";
import type { ServerMessage } from "@veil/shared/protocol";
import { getCapturedAnalyticsEventsSnapshot } from "@server/domain/ops/analytics";
import {
  listAccountTokenDeliveryDeadLetters,
  requeueAccountTokenDeliveryDeadLetter
} from "@server/adapters/account-token-delivery";
import { GuildService } from "@server/domain/social/guilds";
import { loadFeatureFlagConfig, getRuntimeKillSwitchSnapshot } from "@server/domain/battle/feature-flags";
import { buildAdminExperimentSummaries } from "@server/domain/battle/experiment-assignment";
import type {
  AdminAuditAction,
  AdminAuditLogCreateInput,
  AdminAuditLogListOptions,
  AdminAuditLogRecord,
  PlayerCompensationCreateInput,
  PlayerCompensationRecord,
  PlayerPurchaseHistorySnapshot,
  PlayerReportResolveInput,
  PlayerReportStatus,
  RoomSnapshotStore,
  SupportTicketCategory,
  SupportTicketResolveInput,
  SupportTicketStatus
} from "@server/persistence";
import { listLobbyRooms, getActiveRoomInstances } from "@server/transport/colyseus-room/VeilColyseusRoom";
import {
  loadLaunchRuntimeState,
  resolveActiveLaunchAnnouncements,
  resolveLaunchMaintenanceAccess,
  saveLaunchRuntimeState,
  type LaunchAnnouncementRecord,
  type LaunchMaintenanceModeRecord
} from "@server/domain/ops/launch-runtime-state";
import { recordLeaderboardAbuseAlert } from "@server/domain/ops/observability";
import { readRuntimeSecret } from "@server/domain/ops/runtime-secrets";
import { timingSafeCompareAdminToken } from "@server/infra/admin-token";

class InvalidAdminJsonError extends Error {
  constructor() {
    super("Invalid JSON body");
    this.name = "InvalidAdminJsonError";
  }
}

class InvalidAdminPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAdminPayloadError";
  }
}

type AdminRequest = IncomingMessage & { params: Record<string, string> };
type AdminMiddleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
type AdminRouteHandler = (request: AdminRequest, response: ServerResponse) => void | Promise<void>;
type AdminApp = {
  use: (handler: AdminMiddleware) => void;
  get: (path: string, handler: AdminRouteHandler) => void;
  post: (path: string, handler: AdminRouteHandler) => void;
  delete: (path: string, handler: AdminRouteHandler) => void;
};
type AdminRole = "admin" | "support-moderator" | "support-supervisor";
type BanApproval = {
  approvedBy: string;
  approvalReference: string;
};

function readAdminSecret(): string | null {
  const secret = readRuntimeSecret("ADMIN_SECRET");
  return secret ? secret : null;
}

function readSupportModeratorSecret(): string | null {
  const secret = readRuntimeSecret("SUPPORT_MODERATOR_SECRET");
  return secret ? secret : null;
}

function readSupportSupervisorSecret(): string | null {
  const secret = readRuntimeSecret("SUPPORT_SUPERVISOR_SECRET");
  return secret ? secret : null;
}

function isAdminSecretConfigured(): boolean {
  return readAdminSecret() !== null;
}

function isSupportSecretConfigured(): boolean {
  return Boolean(readAdminSecret() || readSupportModeratorSecret() || readSupportSupervisorSecret());
}

function readHeaderSecret(request: IncomingMessage): string | null {
  const header = request.headers["x-veil-admin-secret"];
  if (typeof header === "string") {
    const trimmed = header.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function isAuthorized(request: IncomingMessage): boolean {
  return timingSafeCompareAdminToken(readHeaderSecret(request), readAdminSecret());
}

function readAdminRole(request: IncomingMessage): AdminRole | null {
  const requestSecret = readHeaderSecret(request);
  if (!requestSecret) {
    return null;
  }

  if (timingSafeCompareAdminToken(requestSecret, readAdminSecret())) {
    return "admin";
  }
  if (timingSafeCompareAdminToken(requestSecret, readSupportSupervisorSecret())) {
    return "support-supervisor";
  }
  if (timingSafeCompareAdminToken(requestSecret, readSupportModeratorSecret())) {
    return "support-moderator";
  }
  return null;
}

function hasRequiredRole(role: AdminRole | null, allowedRoles: AdminRole[]): boolean {
  return role !== null && allowedRoles.includes(role);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
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

function sendSupportSecretNotConfigured(response: ServerResponse): void {
  sendJson(response, 503, {
    error: "Player support secrets are not configured"
  });
}

function sendStoreUnavailable(response: ServerResponse): void {
  sendJson(response, 503, { error: "Player moderation requires configured room persistence storage" });
}

function sendForbiddenRole(response: ServerResponse, message: string): void {
  sendJson(response, 403, { error: message });
}

function hasBanModerationStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "loadPlayerBan" | "listPlayerBanHistory" | "savePlayerBan" | "clearPlayerBan">> {
  return Boolean(store?.loadPlayerBan && store.listPlayerBanHistory && store.savePlayerBan && store.clearPlayerBan);
}

function hasPlayerReportStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "createPlayerReport" | "listPlayerReports" | "resolvePlayerReport">> {
  return Boolean(store?.createPlayerReport && store.listPlayerReports && store.resolvePlayerReport);
}

function hasSupportTicketStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "createSupportTicket" | "listSupportTickets" | "resolveSupportTicket">> {
  return Boolean(store?.createSupportTicket && store.listSupportTickets && store.resolveSupportTicket);
}

function hasGuildModerationStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<
    Pick<
      RoomSnapshotStore,
      | "loadGuild"
      | "loadGuildByMemberPlayerId"
      | "listGuilds"
      | "saveGuild"
      | "deleteGuild"
      | "appendGuildAuditLog"
      | "listGuildAuditLogs"
    >
  > {
  return Boolean(
    store?.loadGuild &&
      store.loadGuildByMemberPlayerId &&
      store.listGuilds &&
      store.saveGuild &&
      store.deleteGuild &&
      store.appendGuildAuditLog &&
      store.listGuildAuditLogs
  );
}

function hasPlayerAccountStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "loadPlayerAccount" | "savePlayerAccountProgress">> {
  return Boolean(store?.loadPlayerAccount && store.savePlayerAccountProgress);
}

type PlayerCompensationCurrency = "gems" | keyof ResourceLedger;
type PlayerCompensationRequest = {
  type: PlayerCompensationCreateInput["type"];
  currency: PlayerCompensationCurrency;
  amount: number;
  reason: string;
};
type BatchCompensationSegment = {
  playerIds?: string[];
  minimumEloRating?: number;
  rankDivision?: string;
  seasonPassPremium?: boolean;
  minimumSeasonPassTier?: number;
};
type BatchCompensationRequest = PlayerCompensationRequest & {
  previewOnly: boolean;
  segment: BatchCompensationSegment;
  message: {
    title: string;
    body: string;
  };
};
type PlayerBalanceSnapshot = {
  gems: number;
  resources: ResourceLedger;
};

function hasPlayerCompensationStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<
    Pick<
      RoomSnapshotStore,
      | "loadPlayerAccount"
      | "ensurePlayerAccount"
      | "savePlayerAccountProgress"
      | "appendPlayerCompensationRecord"
      | "listPlayerCompensationHistory"
    >
  > {
  return Boolean(
    store &&
      store.appendPlayerCompensationRecord &&
      store.listPlayerCompensationHistory
  );
}

function hasPlayerPurchaseHistoryStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listPlayerPurchaseHistory">> {
  return Boolean(store?.listPlayerPurchaseHistory);
}

function hasBattleSnapshotHistoryStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore & Required<Pick<RoomSnapshotStore, "listBattleSnapshotsForPlayer">> {
  return Boolean(store?.listBattleSnapshotsForPlayer);
}

function hasAdminAuditStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "appendAdminAuditLog" | "listAdminAuditLogs">> {
  return Boolean(store?.appendAdminAuditLog && store.listAdminAuditLogs);
}

function sendInvalidJson(response: ServerResponse): void {
  sendJson(response, 400, { error: "Invalid JSON body" });
}

function sendInvalidPayload(response: ServerResponse, message: string): void {
  sendJson(response, 400, { error: message });
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredObjectBody(value: unknown): Record<string, unknown> {
  if (!isJsonObject(value)) {
    throw new InvalidAdminPayloadError("JSON body must be an object");
  }
  return value;
}

function readRequiredParam(request: AdminRequest, key: string): string {
  const value = request.params[key];
  if (!value) {
    throw new InvalidAdminPayloadError(`Missing route parameter "${key}"`);
  }
  return value;
}

function readOptionalIntegerField(payload: Record<string, unknown>, key: keyof ResourceLedger): number {
  const value = payload[key];
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new InvalidAdminPayloadError(`"${key}" must be a finite integer`);
  }
  return value;
}

function readOptionalTrimmedString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new InvalidAdminPayloadError(`"${key}" must be a string`);
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function parseIsoTimestamp(value: string, key: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidAdminPayloadError(`"${key}" must be a valid ISO timestamp`);
  }
  return parsed.toISOString();
}

function parseApproval(
  payload: Record<string, unknown>,
  key = "approval",
  required = false
): BanApproval | undefined {
  const value = payload[key];
  if (value === undefined || value === null) {
    if (required) {
      throw new InvalidAdminPayloadError(`"${key}" is required`);
    }
    return undefined;
  }

  const approval = readRequiredObjectBody(value);
  const approvedBy = readOptionalTrimmedString(approval, "approvedBy");
  const approvalReference = readOptionalTrimmedString(approval, "approvalReference");
  if (!approvedBy) {
    throw new InvalidAdminPayloadError(`"${key}.approvedBy" must be a non-empty string`);
  }
  if (!approvalReference) {
    throw new InvalidAdminPayloadError(`"${key}.approvalReference" must be a non-empty string`);
  }
  return { approvedBy, approvalReference };
}

function withApprovalSuffix(banReason: string, approval?: BanApproval): string {
  if (!approval) {
    return banReason;
  }
  return `${banReason} [approvedBy=${approval.approvedBy}; approvalReference=${approval.approvalReference}]`;
}

function parseBanBody(
  value: unknown
): { banStatus: "temporary" | "permanent"; banReason: string; banExpiry?: string; approval?: BanApproval } {
  const payload = readRequiredObjectBody(value);
  const banStatus = readOptionalTrimmedString(payload, "banStatus");
  const banReason = readOptionalTrimmedString(payload, "banReason");
  const banExpiry = readOptionalTrimmedString(payload, "banExpiry");

  if (banStatus !== "temporary" && banStatus !== "permanent") {
    throw new InvalidAdminPayloadError('"banStatus" must be "temporary" or "permanent"');
  }
  if (!banReason) {
    throw new InvalidAdminPayloadError('"banReason" must be a non-empty string');
  }
  if (banStatus === "temporary") {
    if (!banExpiry) {
      throw new InvalidAdminPayloadError('"banExpiry" is required for temporary bans');
    }
    const normalizedExpiry = parseIsoTimestamp(banExpiry, "banExpiry");
    if (new Date(normalizedExpiry).getTime() <= Date.now()) {
      throw new InvalidAdminPayloadError('"banExpiry" must be in the future');
    }
    return { banStatus, banReason, banExpiry: normalizedExpiry };
  }

  return {
    banStatus,
    banReason,
    ...(() => {
      const approval = parseApproval(payload, "approval", true);
      return approval ? { approval } : {};
    })()
  };
}

function parseUnbanBody(value: unknown): { reason?: string } {
  if (value === undefined || value === null || value === "") {
    return {};
  }
  const payload = readRequiredObjectBody(value);
  const reason = readOptionalTrimmedString(payload, "reason");
  return reason ? { reason } : {};
}

function parseGuildModerationBody(value: unknown): { reason?: string } {
  if (value === undefined || value === null || value === "") {
    return {};
  }
  const payload = readRequiredObjectBody(value);
  const reason = readOptionalTrimmedString(payload, "reason");
  return reason ? { reason } : {};
}

function readLimit(request: IncomingMessage, fallback = 20): number {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const parsed = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function readPage(request: IncomingMessage, fallback = 1): number {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const parsed = Number(url.searchParams.get("page"));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.floor(parsed));
}

function readOptionalQueryString(request: IncomingMessage, key: string): string | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

type LeaderboardQueueFlagType =
  | "daily_gain_cap_hit"
  | "repeated_opponent_gain_cap_hit"
  | "repeated_opponent_watch"
  | "watch"
  | "flagged"
  | "frozen";

const LEADERBOARD_QUEUE_FLAG_TYPES = new Set<LeaderboardQueueFlagType>([
  "daily_gain_cap_hit",
  "repeated_opponent_gain_cap_hit",
  "repeated_opponent_watch",
  "watch",
  "flagged",
  "frozen"
]);

function readLeaderboardQueueFlagType(request: IncomingMessage): LeaderboardQueueFlagType | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const raw = url.searchParams.get("flagType")?.trim();
  if (!raw) {
    return undefined;
  }
  if (!LEADERBOARD_QUEUE_FLAG_TYPES.has(raw as LeaderboardQueueFlagType)) {
    throw new InvalidAdminPayloadError(
      '"flagType" must be one of "daily_gain_cap_hit", "repeated_opponent_gain_cap_hit", "repeated_opponent_watch", "watch", "flagged", or "frozen"'
    );
  }
  return raw as LeaderboardQueueFlagType;
}

function getLeaderboardQueueFlagTypes(account: {
  leaderboardAbuseState?: {
    status?: "clear" | "watch" | "flagged";
    lastAlertReasons?: string[];
  };
  leaderboardModerationState?: {
    frozenAt?: string;
  };
}): LeaderboardQueueFlagType[] {
  const flags = new Set<LeaderboardQueueFlagType>();
  for (const reason of account.leaderboardAbuseState?.lastAlertReasons ?? []) {
    if (LEADERBOARD_QUEUE_FLAG_TYPES.has(reason as LeaderboardQueueFlagType)) {
      flags.add(reason as LeaderboardQueueFlagType);
    }
  }
  if (account.leaderboardAbuseState?.status === "watch" || account.leaderboardAbuseState?.status === "flagged") {
    flags.add(account.leaderboardAbuseState.status);
  }
  if (account.leaderboardModerationState?.frozenAt) {
    flags.add("frozen");
  }
  return Array.from(flags);
}

function getLeaderboardQueueLastFlagAt(account: {
  leaderboardAbuseState?: { lastAlertAt?: string };
  leaderboardModerationState?: { frozenAt?: string };
  updatedAt?: string;
}): string {
  return (
    [account.leaderboardAbuseState?.lastAlertAt, account.leaderboardModerationState?.frozenAt, account.updatedAt]
      .filter((value): value is string => Boolean(value))
      .sort((left, right) => right.localeCompare(left))[0] ?? new Date(0).toISOString()
  );
}

function mapAbuseReasonToAlertType(reason: string): string {
  switch (reason) {
    case "daily_gain_cap_hit":
      return "leaderboard_daily_gain_cap";
    case "repeated_opponent_gain_cap_hit":
      return "leaderboard_repeated_opponent_gain_cap";
    case "repeated_opponent_watch":
      return "leaderboard_repeated_opponent_watch";
    default:
      return reason;
  }
}

function describeLeaderboardAbuseReason(reason: string): string {
  switch (reason) {
    case "daily_gain_cap_hit":
      return "Player hit the leaderboard daily ELO gain cap.";
    case "repeated_opponent_gain_cap_hit":
      return "Player hit the repeated-opponent ELO gain cap.";
    case "repeated_opponent_watch":
      return "Player was flagged for repeated-opponent farming watch.";
    case "frozen_match_skipped":
      return "A leaderboard settlement was skipped because the player was frozen.";
    default:
      return reason;
  }
}

function buildLeaderboardModerationEventEntry(input: {
  playerId: string;
  action: "frozen" | "freeze_cleared";
  actorPlayerId: string;
  occurredAt: string;
  reason?: string | undefined;
}): EventLogEntry {
  const actionLabel = input.action === "frozen" ? "冻结排行榜结算" : "解除排行榜冻结";
  return {
    id: `leaderboard:${input.action}:${input.occurredAt}:${input.playerId}`,
    timestamp: input.occurredAt,
    roomId: "admin-console",
    playerId: input.playerId,
    category: "account",
    description: `${actionLabel}（操作人：${input.actorPlayerId}${input.reason ? `，原因：${input.reason}` : ""}）`,
    rewards: []
  };
}

function buildLeaderboardAlertHistory(account: {
  playerId: string;
  leaderboardAbuseState?: {
    lastAlertAt?: string;
    lastAlertReasons?: string[];
  };
  leaderboardModerationState?: {
    frozenAt?: string;
    frozenByPlayerId?: string;
    freezeReason?: string;
  };
  recentEventLog?: EventLogEntry[];
}): Array<{
  type: string;
  at: string;
  detail: string;
  source: "abuse-state" | "event-log" | "moderation-state";
}> {
  const history: Array<{
    type: string;
    at: string;
    detail: string;
    source: "abuse-state" | "event-log" | "moderation-state";
  }> = (account.recentEventLog ?? [])
    .filter((entry) => entry.id.startsWith("leaderboard:"))
    .map((entry) => {
      const action = entry.id.split(":")[1] ?? "event";
      return {
        type: action,
        at: entry.timestamp,
        detail: entry.description,
        source: "event-log" as const
      };
    });

  if (account.leaderboardModerationState?.frozenAt) {
    history.push({
      type: "frozen",
      at: account.leaderboardModerationState.frozenAt,
      detail: `Leaderboard frozen by ${account.leaderboardModerationState.frozenByPlayerId ?? "unknown"}${
        account.leaderboardModerationState.freezeReason ? ` (${account.leaderboardModerationState.freezeReason})` : ""
      }.`,
      source: "moderation-state"
    });
  }

  for (const reason of account.leaderboardAbuseState?.lastAlertReasons ?? []) {
    history.push({
      type: mapAbuseReasonToAlertType(reason),
      at: account.leaderboardAbuseState?.lastAlertAt ?? new Date(0).toISOString(),
      detail: describeLeaderboardAbuseReason(reason),
      source: "abuse-state"
    });
  }

  return history.sort((left, right) => right.at.localeCompare(left.at) || right.type.localeCompare(left.type));
}

function parseResourceDeltaBody(value: unknown): ResourceLedger {
  const payload = readRequiredObjectBody(value);
  return {
    gold: readOptionalIntegerField(payload, "gold"),
    wood: readOptionalIntegerField(payload, "wood"),
    ore: readOptionalIntegerField(payload, "ore")
  };
}

function parseCompensationBody(value: unknown): PlayerCompensationRequest {
  const payload = readRequiredObjectBody(value);
  const type = readOptionalTrimmedString(payload, "type");
  const currency = readOptionalTrimmedString(payload, "currency")?.toLowerCase();
  const reason = readOptionalTrimmedString(payload, "reason");
  const amount = payload.amount;

  if (type !== "add" && type !== "deduct") {
    throw new InvalidAdminPayloadError('"type" must be "add" or "deduct"');
  }
  if (currency !== "gems" && currency !== "gold" && currency !== "wood" && currency !== "ore") {
    throw new InvalidAdminPayloadError('"currency" must be one of "gems", "gold", "wood", or "ore"');
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    throw new InvalidAdminPayloadError('"amount" must be a positive integer');
  }
  if (!reason) {
    throw new InvalidAdminPayloadError('"reason" must be a non-empty string');
  }

  return {
    type,
    currency,
    amount,
    reason
  };
}

function parseBatchCompensationBody(value: unknown): BatchCompensationRequest {
  const payload = readRequiredObjectBody(value);
  const compensation = parseCompensationBody(payload);
  const segmentPayload = payload.segment === undefined ? {} : readRequiredObjectBody(payload.segment);
  const playerIds = Array.isArray(segmentPayload.playerIds)
    ? Array.from(
        new Set(
          segmentPayload.playerIds
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter((entry) => entry.length > 0)
        )
      )
    : undefined;
  const minimumEloRatingValue = segmentPayload.minimumEloRating;
  const minimumSeasonPassTierValue = segmentPayload.minimumSeasonPassTier;
  const rankDivision = readOptionalTrimmedString(segmentPayload, "rankDivision");
  const seasonPassPremium = segmentPayload.seasonPassPremium;
  if (
    minimumEloRatingValue !== undefined &&
    (typeof minimumEloRatingValue !== "number" || !Number.isFinite(minimumEloRatingValue))
  ) {
    throw new InvalidAdminPayloadError('"segment.minimumEloRating" must be a finite number');
  }
  if (
    minimumSeasonPassTierValue !== undefined &&
    (typeof minimumSeasonPassTierValue !== "number" ||
      !Number.isFinite(minimumSeasonPassTierValue) ||
      !Number.isInteger(minimumSeasonPassTierValue))
  ) {
    throw new InvalidAdminPayloadError('"segment.minimumSeasonPassTier" must be an integer');
  }
  if (seasonPassPremium !== undefined && typeof seasonPassPremium !== "boolean") {
    throw new InvalidAdminPayloadError('"segment.seasonPassPremium" must be a boolean');
  }

  const messagePayload = payload.message === undefined ? {} : readRequiredObjectBody(payload.message);
  const title = readOptionalTrimmedString(messagePayload, "title");
  const body = readOptionalTrimmedString(messagePayload, "body");
  if (!title || !body) {
    throw new InvalidAdminPayloadError('"message.title" and "message.body" must be non-empty strings');
  }

  return {
    ...compensation,
    previewOnly: payload.previewOnly === true,
    segment: {
      ...(playerIds && playerIds.length > 0 ? { playerIds } : {}),
      ...(minimumEloRatingValue !== undefined ? { minimumEloRating: minimumEloRatingValue } : {}),
      ...(rankDivision ? { rankDivision } : {}),
      ...(seasonPassPremium !== undefined ? { seasonPassPremium } : {}),
      ...(minimumSeasonPassTierValue !== undefined ? { minimumSeasonPassTier: minimumSeasonPassTierValue } : {})
    },
    message: {
      title,
      body
    }
  };
}

function matchesBatchSegment(account: {
  playerId: string;
  eloRating?: number;
  rankDivision?: string;
  seasonPassPremium?: boolean;
  seasonPassTier?: number;
}, segment: BatchCompensationSegment): boolean {
  if (segment.playerIds?.length && !segment.playerIds.includes(account.playerId)) {
    return false;
  }
  if (segment.minimumEloRating !== undefined && Math.floor(account.eloRating ?? 0) < Math.floor(segment.minimumEloRating)) {
    return false;
  }
  if (segment.rankDivision && (account.rankDivision ?? "").trim().toUpperCase() !== segment.rankDivision.trim().toUpperCase()) {
    return false;
  }
  if (segment.seasonPassPremium !== undefined && account.seasonPassPremium !== segment.seasonPassPremium) {
    return false;
  }
  if (segment.minimumSeasonPassTier !== undefined && Math.floor(account.seasonPassTier ?? 0) < segment.minimumSeasonPassTier) {
    return false;
  }
  return true;
}

function toBatchTargetPreview(account: {
  playerId: string;
  displayName?: string;
  eloRating?: number;
  rankDivision?: string;
  seasonPassPremium?: boolean;
  seasonPassTier?: number;
  gems?: number;
  globalResources?: Partial<ResourceLedger>;
}): Record<string, unknown> {
  return {
    playerId: account.playerId,
    displayName: account.displayName ?? account.playerId,
    eloRating: account.eloRating ?? 0,
    rankDivision: account.rankDivision ?? null,
    seasonPassPremium: account.seasonPassPremium === true,
    seasonPassTier: account.seasonPassTier ?? 0,
    gems: account.gems ?? 0,
    resources: {
      gold: account.globalResources?.gold ?? 0,
      wood: account.globalResources?.wood ?? 0,
      ore: account.globalResources?.ore ?? 0
    }
  };
}

function safeSerialize(value: unknown): string {
  return JSON.stringify(value);
}

function describeAuditActor(role: AdminRole): string {
  return `${role}:admin-console`;
}

async function appendAdminAuditLogIfAvailable(
  store: RoomSnapshotStore | null,
  input: AdminAuditLogCreateInput
): Promise<AdminAuditLogRecord | null> {
  if (!hasAdminAuditStore(store)) {
    return null;
  }
  return store.appendAdminAuditLog(input);
}

function parseBroadcastBody(value: unknown): { message: string; type: string } {
  const payload = readRequiredObjectBody(value);
  const message = payload.message;
  const announcementType = payload.type;

  if (typeof message !== "string" || message.trim().length === 0) {
    throw new InvalidAdminPayloadError('"message" must be a non-empty string');
  }
  if (announcementType !== undefined && (typeof announcementType !== "string" || announcementType.trim().length === 0)) {
    throw new InvalidAdminPayloadError('"type" must be a non-empty string');
  }

  return {
    message: message.trim(),
    type: typeof announcementType === "string" ? announcementType.trim() : "info"
  };
}

function parseAnnouncementRecord(value: unknown): LaunchAnnouncementRecord {
  const payload = readRequiredObjectBody(value);
  const id = String(payload.id ?? randomUUID()).trim();
  const title = typeof payload.title === "string" ? payload.title.trim() : "";
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  const startsAt = typeof payload.startsAt === "string" ? payload.startsAt.trim() : "";
  const tone = payload.tone;
  const endsAt = typeof payload.endsAt === "string" ? payload.endsAt.trim() : "";

  if (!id || !title || !message || !startsAt) {
    throw new InvalidAdminPayloadError('"announcement" requires id, title, message, and startsAt');
  }
  if (tone !== undefined && tone !== "info" && tone !== "warning" && tone !== "critical") {
    throw new InvalidAdminPayloadError('"announcement.tone" must be info, warning, or critical');
  }

  return {
    id,
    title,
    message,
    tone: tone === "warning" || tone === "critical" ? tone : "info",
    startsAt,
    ...(endsAt ? { endsAt } : {})
  };
}

function parseMaintenanceModeBody(value: unknown): LaunchMaintenanceModeRecord {
  const payload = readRequiredObjectBody(value);
  if (typeof payload.enabled !== "boolean") {
    throw new InvalidAdminPayloadError('"enabled" must be a boolean');
  }

  const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "停服维护中";
  const message =
    typeof payload.message === "string" && payload.message.trim()
      ? payload.message.trim()
      : "服务器正在维护，请稍后再试。";
  const nextOpenAt = typeof payload.nextOpenAt === "string" && payload.nextOpenAt.trim() ? payload.nextOpenAt.trim() : "";
  const whitelistPlayerIds = Array.isArray(payload.whitelistPlayerIds)
    ? payload.whitelistPlayerIds.map((entry) => String(entry).trim()).filter(Boolean)
    : [];
  const whitelistLoginIds = Array.isArray(payload.whitelistLoginIds)
    ? payload.whitelistLoginIds.map((entry) => String(entry).trim().toLowerCase()).filter(Boolean)
    : [];

  return {
    enabled: payload.enabled,
    title,
    message,
    ...(nextOpenAt ? { nextOpenAt } : {}),
    whitelistPlayerIds: Array.from(new Set(whitelistPlayerIds)).sort((left, right) => left.localeCompare(right)),
    whitelistLoginIds: Array.from(new Set(whitelistLoginIds)).sort((left, right) => left.localeCompare(right))
  };
}

function broadcastGlobalAnnouncement(message: string, type = "info"): void {
  for (const room of getActiveRoomInstances().values()) {
    room.broadcast("system.announcement", { text: message, type, timestamp: new Date().toISOString() });
  }
}

function parseReportStatus(value: string | null | undefined, fallback: PlayerReportStatus = "pending"): PlayerReportStatus {
  if (!value || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim();
  if (normalized === "pending" || normalized === "dismissed" || normalized === "warned" || normalized === "banned") {
    return normalized;
  }

  throw new InvalidAdminPayloadError('"status" must be "pending", "dismissed", "warned", or "banned"');
}

function parseResolveReportBody(value: unknown): PlayerReportResolveInput & { approval?: BanApproval } {
  const payload = readRequiredObjectBody(value);
  const status = parseReportStatus(readOptionalTrimmedString(payload, "status"), "pending");
  if (status === "pending") {
    throw new InvalidAdminPayloadError('"status" must be "dismissed", "warned", or "banned"');
  }

  return {
    status,
    ...(status === "banned"
      ? (() => {
          const approval = parseApproval(payload, "approval", true);
          return approval ? { approval } : {};
        })()
      : {})
  };
}

function readReportStatusFilter(request: IncomingMessage): PlayerReportStatus {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  return parseReportStatus(url.searchParams.get("status"), "pending");
}

function parseSupportTicketStatus(
  value: string | null | undefined,
  fallback: SupportTicketStatus = "open"
): SupportTicketStatus {
  if (!value || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim();
  if (normalized === "open" || normalized === "resolved" || normalized === "dismissed") {
    return normalized;
  }

  throw new InvalidAdminPayloadError('"status" must be "open", "resolved", or "dismissed"');
}

function parseSupportTicketCategory(value: string | null | undefined): SupportTicketCategory | undefined {
  if (!value || value.trim() === "") {
    return undefined;
  }

  const normalized = value.trim();
  if (normalized === "bug" || normalized === "payment" || normalized === "account" || normalized === "other") {
    return normalized;
  }

  throw new InvalidAdminPayloadError('"category" must be "bug", "payment", "account", or "other"');
}

function parseResolveSupportTicketBody(value: unknown): SupportTicketResolveInput {
  const payload = readRequiredObjectBody(value);
  const status = parseSupportTicketStatus(readOptionalTrimmedString(payload, "status"), "open");
  if (status === "open") {
    throw new InvalidAdminPayloadError('"status" must be "resolved" or "dismissed"');
  }

  const resolution = readOptionalTrimmedString(payload, "resolution");
  if (!resolution) {
    throw new InvalidAdminPayloadError('"resolution" must be a non-empty string');
  }

  return {
    status,
    handlerId: "support:pending",
    resolution
  };
}

function requireSupportRole(response: ServerResponse, request: IncomingMessage, allowedRoles: AdminRole[]): AdminRole | null {
  if (!isSupportSecretConfigured()) {
    sendSupportSecretNotConfigured(response);
    return null;
  }

  const role = readAdminRole(request);
  if (!role) {
    sendUnauthorized(response);
    return null;
  }
  if (!hasRequiredRole(role, allowedRoles)) {
    sendForbiddenRole(response, "Forbidden: support role does not allow this action");
    return null;
  }
  return role;
}

const MAX_JSON_BODY_BYTES = 32 * 1024;

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

async function drainRequest(request: IncomingMessage): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of request) {
    // drain remaining chunks so the connection is not reset
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    // Fail fast: reject immediately based on Content-Length alone.
    // Drain in the background so the connection is not reset, but do NOT
    // await it — that would keep the handler blocked (slow-loris risk).
    void drainRequest(request).catch(() => {});
    throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let tooLarge = false;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      // Mark as too large but continue draining so the connection is not reset
      tooLarge = true;
    } else {
      chunks.push(buffer);
    }
  }

  if (tooLarge) {
    throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new InvalidAdminJsonError();
  }
}

function snapshotPlayerBalances(account: {
  gems?: number;
  globalResources?: Partial<ResourceLedger>;
} | null): PlayerBalanceSnapshot {
  return {
    gems: Math.max(0, Math.floor(account?.gems ?? 0)),
    resources: {
      gold: Math.max(0, Math.floor(account?.globalResources?.gold ?? 0)),
      wood: Math.max(0, Math.floor(account?.globalResources?.wood ?? 0)),
      ore: Math.max(0, Math.floor(account?.globalResources?.ore ?? 0))
    }
  };
}

function applyCompensationToBalance(
  current: PlayerBalanceSnapshot,
  input: PlayerCompensationRequest
): {
  previousBalance: number;
  next: PlayerBalanceSnapshot;
} {
  const previousBalance = input.currency === "gems" ? current.gems : current.resources[input.currency];
  const delta = input.type === "add" ? input.amount : -input.amount;
  const balanceAfter = Math.max(0, previousBalance + delta);

  return {
    previousBalance,
    next: {
      gems: input.currency === "gems" ? balanceAfter : current.gems,
      resources:
        input.currency === "gems"
          ? { ...current.resources }
          : {
              ...current.resources,
              [input.currency]: balanceAfter
            }
    }
  };
}

function renderCompensationEvent(record: PlayerCompensationRecord): string {
  const actionLabel = record.type === "deduct" ? "扣减" : "发放";
  return `${actionLabel} ${record.currency} ${record.amount}（原因：${record.reason}，变更前 ${record.previousBalance}，变更后 ${record.balanceAfter}）`;
}

function buildCompensationEventEntry(
  playerId: string,
  record: PlayerCompensationRecord,
  balances: PlayerBalanceSnapshot
): {
  id: string;
  timestamp: string;
  roomId: string;
  playerId: string;
  category: "account";
  description: string;
  rewards: [];
} {
  return {
    id: `compensation:${record.auditId}`,
    timestamp: record.createdAt,
    roomId: "admin-console",
    playerId,
    category: "account",
    description: `${renderCompensationEvent(record)}。当前余额：gems=${balances.gems}, gold=${balances.resources.gold}, wood=${balances.resources.wood}, ore=${balances.resources.ore}`,
    rewards: []
  };
}

function syncPlayerBalancesToActiveRooms(playerId: string, nextResources: ResourceLedger): boolean {
  let syncedToRoom = false;
  const activeRooms = getActiveRoomInstances();

  for (const [roomId, vRoom] of activeRooms) {
    if (vRoom.worldRoom) {
      const roomInternals = vRoom as unknown as {
        getPlayerId(client: { sessionId?: string }, fallback?: string): string | undefined;
        buildStatePayload(
          playerId: string,
          extras?: {
            events?: Array<{ type: "system.announcement"; text: string; tone: "system" }>;
            movementPlan?: null;
            reason?: string;
          }
        ): ServerMessage extends { type: "session.state"; payload: infer T } ? T : never;
      };
      const internalState = vRoom.worldRoom.getInternalState() as WorldState & {
        playerResources?: Record<string, ResourceLedger>;
      };

      if (internalState.resources && internalState.resources[playerId]) {
        internalState.resources[playerId] = { ...nextResources };
      }

      if (internalState.playerResources && internalState.playerResources[playerId]) {
        internalState.playerResources[playerId] = { ...nextResources };
      }

      console.log(`[Admin] Patched room ${roomId} for ${playerId}:`, nextResources);

      const snapshot = vRoom.worldRoom.getSnapshot(playerId);
      snapshot.state.resources = { ...nextResources };

      for (const client of vRoom.clients) {
        const clientPlayerId = roomInternals.getPlayerId(client, playerId) ?? playerId;
        client.send("session.state", {
          requestId: "push",
          delivery: "push",
          payload: roomInternals.buildStatePayload(clientPlayerId, {
            events: [{ type: "system.announcement", text: "资源已更新", tone: "system" }],
            movementPlan: null
          })
        });
      }

      syncedToRoom = true;
    }
  }

  return syncedToRoom;
}

function hasLeaderboardModerationQueueStore(
  store: RoomSnapshotStore | null
): store is RoomSnapshotStore &
  Required<Pick<RoomSnapshotStore, "listPlayerAccounts">> {
  return Boolean(store?.listPlayerAccounts);
}

export function registerAdminRoutes(
  app: AdminApp,
  store: RoomSnapshotStore | null,
  _gameServer?: unknown
): void {
  const guildService = new GuildService(store);
  app.use((request, response, next) => {
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      response.setHeader("Access-Control-Allow-Headers", "Content-Type, x-veil-admin-secret");
      response.statusCode = 204;
      response.end();
      return;
    }
    next();
  });

  app.get("/admin", async (request, response) => {
    try {
      const html = await readFile(join(process.cwd(), "apps/client/admin.html"), "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    } catch (error) {
      response.statusCode = 500;
      response.end("Failed to load admin.html");
    }
  });

  app.get("/admin/kill-switches", async (_request, response) => {
    try {
      const html = await readFile(join(process.cwd(), "apps/client/admin-kill-switches.html"), "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    } catch (error) {
      response.statusCode = 500;
      response.end("Failed to load admin-kill-switches.html");
    }
  });

  app.get("/api/admin/overview", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    const lobbyRooms = listLobbyRooms();
    sendJson(response, 200, {
      serverTime: new Date().toISOString(),
      activeRooms: lobbyRooms.length,
      activePlayers: lobbyRooms.reduce((sum, r) => sum + r.connectedPlayers, 0),
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage()
    });
  });

  app.get("/api/admin/experiments", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    const config = loadFeatureFlagConfig();
    const experiments = buildAdminExperimentSummaries(config, getCapturedAnalyticsEventsSnapshot(), new Date().toISOString());
    sendJson(response, 200, {
      serverTime: new Date().toISOString(),
      experiments
    });
  });

  app.get("/api/admin/auth-token-delivery/dead-letters", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-supervisor"])) return;
    sendJson(response, 200, {
      serverTime: new Date().toISOString(),
      deadLetters: listAccountTokenDeliveryDeadLetters()
    });
  });

  app.post("/api/admin/auth-token-delivery/dead-letters/:key/requeue", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-supervisor"])) return;
    const key = decodeURIComponent(request.params.key ?? "").trim();
    if (!key) {
      sendJson(response, 400, { error: "Missing account-token delivery dead-letter key" });
      return;
    }

    const queuedEntry = await requeueAccountTokenDeliveryDeadLetter(key);
    if (!queuedEntry) {
      sendJson(response, 404, { error: "Account-token delivery dead-letter not found" });
      return;
    }

    sendJson(response, 202, {
      serverTime: new Date().toISOString(),
      queuedEntry
    });
  });

  app.get("/api/admin/runtime/kill-switches", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    const snapshot = getRuntimeKillSwitchSnapshot();
    sendJson(response, 200, {
      serverTime: new Date().toISOString(),
      clientMinVersion: snapshot.clientMinVersion,
      killSwitches: snapshot.killSwitches
    });
  });

  app.post("/api/admin/players/:id/resources", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const playerId = readRequiredParam(request, "id");
      const { gold, wood, ore } = parseResourceDeltaBody(await readJsonBody(request));
      let currentResources: ResourceLedger = { gold: 0, wood: 0, ore: 0 };
      if (store) {
        let account = await store.loadPlayerAccount(playerId);
        if (!account) {
          account = await store.ensurePlayerAccount({ playerId, displayName: playerId });
        }
        if (account?.globalResources) {
          currentResources = { ...account.globalResources };
        }
      }

      const nextResources: ResourceLedger = {
        gold: Math.max(0, currentResources.gold + gold),
        wood: Math.max(0, currentResources.wood + wood),
        ore: Math.max(0, currentResources.ore + ore)
      };

      if (store) await store.savePlayerAccountProgress(playerId, { globalResources: nextResources });
      const syncedToRoom = syncPlayerBalancesToActiveRooms(playerId, nextResources);
      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: describeAuditActor("admin"),
        actorRole: "admin",
        action: "resources_modified",
        targetPlayerId: playerId,
        summary: `Modified resources for ${playerId}`,
        beforeJson: safeSerialize(currentResources),
        afterJson: safeSerialize(nextResources),
        metadataJson: safeSerialize({ syncedToRoom })
      });

      sendJson(response, 200, { ok: true, resources: nextResources, syncedToRoom });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      console.error("[Admin] Sync error:", error);
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/players/:id/compensation", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    if (!hasPlayerCompensationStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const input = parseCompensationBody(await readJsonBody(request));
      const account = (await store.loadPlayerAccount(playerId)) ?? (await store.ensurePlayerAccount({ playerId, displayName: playerId }));
      const currentBalances = snapshotPlayerBalances(account);
      const { previousBalance, next } = applyCompensationToBalance(currentBalances, input);

      const record = await store.appendPlayerCompensationRecord(playerId, {
        type: input.type,
        currency: input.currency,
        amount: input.amount,
        reason: input.reason,
        previousBalance,
        balanceAfter: input.currency === "gems" ? next.gems : next.resources[input.currency]
      });
      const updatedAccount = await store.savePlayerAccountProgress(playerId, {
        gems: next.gems,
        globalResources: next.resources,
        recentEventLog: appendEventLogEntries(account.recentEventLog, [buildCompensationEventEntry(playerId, record, next)])
      });
      const balances = snapshotPlayerBalances(updatedAccount);
      const syncedToRoom = syncPlayerBalancesToActiveRooms(playerId, balances.resources);
      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: describeAuditActor("admin"),
        actorRole: "admin",
        action: "compensation_granted",
        targetPlayerId: playerId,
        summary: `Granted ${record.type} ${record.currency} compensation to ${playerId}`,
        beforeJson: safeSerialize(currentBalances),
        afterJson: safeSerialize(balances),
        metadataJson: safeSerialize({ compensation: record, syncedToRoom })
      });

      sendJson(response, 200, {
        ok: true,
        compensation: record,
        balances,
        syncedToRoom
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      console.error("[Admin] Compensation error:", error);
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.get("/api/admin/players/:id/compensation/history", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    if (!hasPlayerCompensationStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request as AdminRequest, "id");
      const items = await store.listPlayerCompensationHistory(playerId, { limit: readLimit(request) });
      sendJson(response, 200, { items });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/players/:id/purchase-history", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    if (!hasPlayerPurchaseHistoryStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request as AdminRequest, "id");
      const limit = readLimit(request, 20);
      const page = readPage(request, 1);
      const offset = (page - 1) * limit;
      const from = readOptionalQueryString(request, "from");
      const to = readOptionalQueryString(request, "to");
      const itemId = readOptionalQueryString(request, "itemId");
      const history: PlayerPurchaseHistorySnapshot = await store.listPlayerPurchaseHistory(playerId, {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(itemId ? { itemId } : {}),
        limit,
        offset
      });
      sendJson(response, 200, {
        items: history.items,
        page,
        limit: history.limit,
        total: history.total,
        totalPages: Math.max(1, Math.ceil(history.total / history.limit)),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(itemId ? { itemId } : {})
      });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/players/:id/overview", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!store?.loadPlayerAccount) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, { error: "Player account not found" });
        return;
      }

      const [currentBan, banHistory, reportsAgainstPlayer, reportsByPlayer, supportTickets, compensationHistory, purchaseHistory, battleHistory, audit] =
        await Promise.all([
          hasBanModerationStore(store) ? store.loadPlayerBan(playerId) : Promise.resolve(null),
          hasBanModerationStore(store) ? store.listPlayerBanHistory(playerId, { limit: 20 }) : Promise.resolve([]),
          hasPlayerReportStore(store) ? store.listPlayerReports({ targetId: playerId, limit: 20 }) : Promise.resolve([]),
          hasPlayerReportStore(store) ? store.listPlayerReports({ reporterId: playerId, limit: 20 }) : Promise.resolve([]),
          hasSupportTicketStore(store) ? store.listSupportTickets({ playerId, limit: 20 }) : Promise.resolve([]),
          hasPlayerCompensationStore(store) ? store.listPlayerCompensationHistory(playerId, { limit: 20 }) : Promise.resolve([]),
          hasPlayerPurchaseHistoryStore(store)
            ? store.listPlayerPurchaseHistory(playerId, {
                from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
                limit: 20,
                offset: 0
              })
            : Promise.resolve({ items: [], total: 0, limit: 20, offset: 0 }),
          hasBattleSnapshotHistoryStore(store) ? store.listBattleSnapshotsForPlayer(playerId, { limit: 20 }) : Promise.resolve([]),
          hasAdminAuditStore(store) ? store.listAdminAuditLogs({ targetPlayerId: playerId, limit: 30 }) : Promise.resolve([])
        ]);

      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: describeAuditActor(role),
        actorRole: role,
        action: "player_overview_viewed",
        targetPlayerId: playerId,
        summary: `Viewed GM overview for ${playerId}`,
        afterJson: safeSerialize({
          reportsAgainstCount: reportsAgainstPlayer.length,
          supportTicketCount: supportTickets.length,
          mailboxCount: account.mailbox?.length ?? 0
        })
      });

      sendJson(response, 200, {
        playerId,
        generatedAt: new Date().toISOString(),
        account,
        moderation: {
          currentBan,
          banHistory
        },
        reports: {
          againstPlayer: reportsAgainstPlayer,
          filedByPlayer: reportsByPlayer
        },
        supportTickets,
        compensationHistory,
        purchaseHistory,
        mailbox: (account.mailbox ?? []).slice(0, 20),
        battleHistory,
        audit
      });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/compensation/batch", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-supervisor"]);
    if (!role) return;
    if (!store?.listPlayerAccounts || !store.deliverPlayerMailbox) return sendStoreUnavailable(response);

    try {
      const input = parseBatchCompensationBody(await readJsonBody(request));
      if (input.type !== "add") {
        throw new InvalidAdminPayloadError('batch compensation only supports "add" grants');
      }

      const accounts = await store.listPlayerAccounts({ limit: 10_000, offset: 0 });
      const targets = accounts.filter((account) => matchesBatchSegment(account, input.segment));
      const targetPreview = targets.map((account) => toBatchTargetPreview(account));

      const auditBase: AdminAuditLogCreateInput = {
        actorPlayerId: describeAuditActor(role),
        actorRole: role,
        action: input.previewOnly ? "compensation_batch_previewed" : "compensation_batch_granted",
        targetScope: "player-segment",
        summary: `${input.previewOnly ? "Previewed" : "Granted"} batch compensation to ${targets.length} players`,
        metadataJson: safeSerialize({
          segment: input.segment,
          compensation: {
            type: input.type,
            currency: input.currency,
            amount: input.amount,
            reason: input.reason
          },
          matchedPlayerIds: targets.map((account) => account.playerId)
        })
      };

      if (input.previewOnly) {
        const audit = await appendAdminAuditLogIfAvailable(store, auditBase);
        sendJson(response, 200, {
          previewOnly: true,
          matchedCount: targets.length,
          targets: targetPreview,
          audit
        });
        return;
      }

      const grant =
        input.currency === "gems"
          ? { gems: input.amount }
          : {
              resources: {
                gold: input.currency === "gold" ? input.amount : 0,
                wood: input.currency === "wood" ? input.amount : 0,
                ore: input.currency === "ore" ? input.amount : 0
              }
            };
      const delivery = await store.deliverPlayerMailbox({
        playerIds: targets.map((account) => account.playerId),
        message: {
          id: `batch-compensation:${Date.now()}`,
          kind: "compensation",
          title: input.message.title,
          body: input.message.body,
          grant
        }
      });
      const audit = await appendAdminAuditLogIfAvailable(store, {
        ...auditBase,
        afterJson: safeSerialize({
          deliveredPlayerIds: delivery.deliveredPlayerIds,
          skippedPlayerIds: delivery.skippedPlayerIds
        })
      });

      sendJson(response, 200, {
        previewOnly: false,
        matchedCount: targets.length,
        targets: targetPreview,
        delivery,
        audit
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/audit-log", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasAdminAuditStore(store)) return sendStoreUnavailable(response);

    try {
      const actorPlayerId = readOptionalQueryString(request, "actorPlayerId");
      const targetPlayerId = readOptionalQueryString(request, "targetPlayerId");
      const targetScope = readOptionalQueryString(request, "targetScope");
      const since = readOptionalQueryString(request, "since");
      const items = await store.listAdminAuditLogs({
        limit: readLimit(request, 50),
        ...(actorPlayerId ? { actorPlayerId } : {}),
        ...(targetPlayerId ? { targetPlayerId } : {}),
        ...(targetScope ? { targetScope } : {}),
        ...(since ? { since } : {})
      } satisfies AdminAuditLogListOptions);
      sendJson(response, 200, { items });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/broadcast", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);
    try {
      const { message, type } = parseBroadcastBody(await readJsonBody(request));
      broadcastGlobalAnnouncement(message, type);
      sendJson(response, 200, { ok: true });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/players/:id/ban", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasBanModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const input = parseBanBody(await readJsonBody(request));
      if (input.banStatus === "permanent" && !hasRequiredRole(role, ["admin", "support-supervisor"])) {
        sendForbiddenRole(response, "Forbidden: permanent bans require support-supervisor or admin credentials");
        return;
      }
      const account = await store.savePlayerBan(playerId, {
        ...input,
        banReason: withApprovalSuffix(input.banReason, input.approval)
      });
      let disconnectedClients = 0;
      for (const room of getActiveRoomInstances().values()) {
        disconnectedClients += room.disconnectPlayer(playerId, "account_banned");
      }
      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: describeAuditActor(role),
        actorRole: role,
        action: "player_banned",
        targetPlayerId: playerId,
        summary: `Banned ${playerId}`,
        afterJson: safeSerialize({
          banStatus: account.banStatus,
          banExpiry: account.banExpiry,
          banReason: account.banReason,
          disconnectedClients
        })
      });
      sendJson(response, 200, { ok: true, account, disconnectedClients });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/players/:id/unban", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasBanModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const currentBan = await store.loadPlayerBan(playerId);
      if (currentBan?.banStatus === "permanent" && !hasRequiredRole(role, ["admin", "support-supervisor"])) {
        sendForbiddenRole(response, "Forbidden: permanent-ban reversals require support-supervisor or admin credentials");
        return;
      }
      const input = parseUnbanBody(await readJsonBody(request));
      const account = await store.clearPlayerBan(playerId, input);
      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: describeAuditActor(role),
        actorRole: role,
        action: "player_unbanned",
        targetPlayerId: playerId,
        summary: `Unbanned ${playerId}`,
        metadataJson: safeSerialize({ reason: input.reason ?? null })
      });
      sendJson(response, 200, { ok: true, account });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/players/:id/ban-history", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"])) return;
    if (!hasBanModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request as AdminRequest, "id");
      const items = await store.listPlayerBanHistory(playerId, { limit: readLimit(request) });
      const currentBan = await store.loadPlayerBan(playerId);
      sendJson(response, 200, { items, currentBan });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/reports", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"])) return;
    if (!hasPlayerReportStore(store)) return sendStoreUnavailable(response);

    try {
      const status = readReportStatusFilter(request);
      const items = await store.listPlayerReports({ status, limit: readLimit(request, 50) });
      sendJson(response, 200, { items, status });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/announcements", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);

    try {
      const state = await loadLaunchRuntimeState();
      sendJson(response, 200, {
        announcements: state.announcements,
        active: resolveActiveLaunchAnnouncements(state),
        maintenanceMode: resolveLaunchMaintenanceAccess(state),
        updatedAt: state.updatedAt
      });
    } catch (error) {
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/announcements", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);

    try {
      const body = readRequiredObjectBody(await readJsonBody(request));
      const announcement = parseAnnouncementRecord(body.announcement ?? body);
      const state = await loadLaunchRuntimeState();
      const nextState = await saveLaunchRuntimeState({
        ...state,
        announcements: [
          ...state.announcements.filter((entry) => entry.id !== announcement.id),
          announcement
        ],
        updatedAt: new Date().toISOString()
      });
      broadcastGlobalAnnouncement(`${announcement.title}：${announcement.message}`, announcement.tone);
      sendJson(response, 200, {
        ok: true,
        announcement,
        active: resolveActiveLaunchAnnouncements(nextState),
        updatedAt: nextState.updatedAt
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.delete("/api/admin/announcements/:id", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);

    try {
      const id = readRequiredParam(request, "id");
      const state = await loadLaunchRuntimeState();
      const existing = state.announcements.find((entry) => entry.id === id) ?? null;
      const nextState = await saveLaunchRuntimeState({
        ...state,
        announcements: state.announcements.filter((entry) => entry.id !== id),
        updatedAt: new Date().toISOString()
      });
      sendJson(response, 200, {
        ok: true,
        removed: Boolean(existing),
        ...(existing ? { announcement: existing } : {}),
        active: resolveActiveLaunchAnnouncements(nextState),
        updatedAt: nextState.updatedAt
      });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/maintenance-mode", async (request, response) => {
    if (!isAdminSecretConfigured()) return sendAdminSecretNotConfigured(response);
    if (!isAuthorized(request)) return sendUnauthorized(response);

    try {
      const maintenanceMode = parseMaintenanceModeBody(await readJsonBody(request));
      const state = await loadLaunchRuntimeState();
      const nextState = await saveLaunchRuntimeState({
        ...state,
        maintenanceMode,
        updatedAt: new Date().toISOString()
      });

      if (maintenanceMode.enabled) {
        broadcastGlobalAnnouncement(
          `${maintenanceMode.title}：${maintenanceMode.message}${maintenanceMode.nextOpenAt ? ` · 预计恢复 ${maintenanceMode.nextOpenAt}` : ""}`,
          "critical"
        );
      }

      sendJson(response, 200, {
        ok: true,
        maintenanceMode: resolveLaunchMaintenanceAccess(nextState),
        updatedAt: nextState.updatedAt
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 500, { error: String(error) });
    }
  });

  app.post("/api/admin/reports/:id/resolve", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasPlayerReportStore(store)) return sendStoreUnavailable(response);

    try {
      const reportId = readRequiredParam(request, "id");
      const input = parseResolveReportBody(await readJsonBody(request));
      if (input.status === "banned" && !hasRequiredRole(role, ["admin", "support-supervisor"])) {
        sendForbiddenRole(response, "Forbidden: permanent bans require support-supervisor or admin credentials");
        return;
      }
      const report = await store.resolvePlayerReport(reportId, input);
      if (!report) {
        sendJson(response, 404, { error: "Report not found" });
        return;
      }

      let disconnectedClients = 0;
      if (input.status === "banned" && hasBanModerationStore(store)) {
        await store.savePlayerBan(report.targetId, {
          banStatus: "permanent",
          banReason: withApprovalSuffix(`Resolved from player report ${report.reportId}`, input.approval)
        });
        for (const room of getActiveRoomInstances().values()) {
          disconnectedClients += room.disconnectPlayer(report.targetId, "account_banned");
        }
      }

      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: describeAuditActor(role),
        actorRole: role,
        action: "report_resolved",
        targetPlayerId: report.targetId,
        summary: `Resolved report ${report.reportId} as ${report.status}`,
        metadataJson: safeSerialize({
          reportId: report.reportId,
          reporterId: report.reporterId,
          status: report.status,
          disconnectedClients
        })
      });

      sendJson(response, 200, { ok: true, report, disconnectedClients });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/support-tickets", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"])) return;
    if (!hasSupportTicketStore(store)) return sendStoreUnavailable(response);

    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      const status = parseSupportTicketStatus(url.searchParams.get("status"), "open");
      const playerId = url.searchParams.get("playerId")?.trim() || undefined;
      const category = parseSupportTicketCategory(url.searchParams.get("category"));
      const items = await store.listSupportTickets({
        status,
        ...(playerId ? { playerId } : {}),
        ...(category ? { category } : {}),
        limit: readLimit(request, 50)
      });
      sendJson(response, 200, { items, status });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/support-tickets/:id/resolve", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasSupportTicketStore(store)) return sendStoreUnavailable(response);

    try {
      const ticketId = readRequiredParam(request, "id");
      const input = parseResolveSupportTicketBody(await readJsonBody(request));
      const ticket = await store.resolveSupportTicket(ticketId, {
        ...input,
        handlerId: `${role}:admin-console`
      });
      if (!ticket) {
        sendJson(response, 404, { error: "Support ticket not found" });
        return;
      }

      let mailboxDelivered = false;
      if (store.deliverPlayerMailbox) {
        const delivery = await store.deliverPlayerMailbox({
          playerIds: [ticket.playerId],
          message: {
            id: `support-ticket:${ticket.ticketId}:${ticket.status}`,
            kind: "system",
            title: ticket.status === "resolved" ? "客服工单已处理" : "客服工单已关闭",
            body: `${ticket.category} 工单处理结果：${ticket.resolution ?? "已更新，请稍后查看。"}`,
            sentAt: new Date().toISOString()
          }
        });
        mailboxDelivered = delivery.deliveredPlayerIds.includes(ticket.playerId);
      }

      await appendAdminAuditLogIfAvailable(store, {
        actorPlayerId: describeAuditActor(role),
        actorRole: role,
        action: "support_ticket_resolved",
        targetPlayerId: ticket.playerId,
        summary: `Resolved support ticket ${ticket.ticketId} as ${ticket.status}`,
        metadataJson: safeSerialize({
          ticketId: ticket.ticketId,
          category: ticket.category,
          mailboxDelivered
        })
      });

      sendJson(response, 200, { ok: true, ticket, mailboxDelivered });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/players/:id/export", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"])) return;
    if (!store?.loadPlayerAccount) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, { error: "Player account not found" });
        return;
      }

      const currentBan = hasBanModerationStore(store) ? await store.loadPlayerBan(playerId) : null;
      const banHistory = hasBanModerationStore(store)
        ? await store.listPlayerBanHistory(playerId, { limit: readLimit(request, 100) })
        : [];
      const battleHistory = hasBattleSnapshotHistoryStore(store)
        ? await store.listBattleSnapshotsForPlayer(playerId, { limit: readLimit(request, 50) })
        : [];

      sendJson(response, 200, {
        playerId,
        exportedAt: new Date().toISOString(),
        account,
        moderation: {
          currentBan,
          banHistory
        },
        battleHistory
      });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/players/:id/leaderboard/freeze", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasPlayerAccountStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const input = parseGuildModerationBody(await readJsonBody(request));
      const account = (await store.loadPlayerAccount(playerId)) ?? (await store.ensurePlayerAccount({ playerId }));
      const frozenAt = new Date().toISOString();
      const actorPlayerId = `${role}:admin-console`;
      const leaderboardModerationState = {
        ...(account.leaderboardModerationState ?? {}),
        frozenAt,
        frozenByPlayerId: actorPlayerId,
        ...(input.reason ? { freezeReason: input.reason } : {})
      };
      const updatedAccount = await store.savePlayerAccountProgress(playerId, {
        leaderboardModerationState,
        recentEventLog: appendEventLogEntries(account.recentEventLog, [
          buildLeaderboardModerationEventEntry({
            playerId,
            action: "frozen",
            actorPlayerId,
            occurredAt: frozenAt,
            reason: input.reason
          })
        ])
      });
      recordLeaderboardAbuseAlert({
        type: "leaderboard_frozen_player_match",
        playerId,
        at: leaderboardModerationState.frozenAt,
        detail: `Leaderboard frozen by ${actorPlayerId}${input.reason ? ` (${input.reason})` : ""}.`
      });
      sendJson(response, 200, { ok: true, account: updatedAccount });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/players/:id/leaderboard/abuse-state", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"])) return;
    if (!hasPlayerAccountStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, { error: "Player account not found" });
        return;
      }

      sendJson(response, 200, {
        playerId,
        abuseState: account.leaderboardAbuseState ?? { status: "clear" },
        moderationState: account.leaderboardModerationState ?? {},
        alertHistory: buildLeaderboardAlertHistory(account)
      });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.delete("/api/admin/players/:id/leaderboard/freeze", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasPlayerAccountStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const account = await store.loadPlayerAccount(playerId);
      if (!account) {
        sendJson(response, 404, { error: "Player account not found" });
        return;
      }

      const input = parseGuildModerationBody(await readJsonBody(request));
      const clearedAt = new Date().toISOString();
      const actorPlayerId = `${role}:admin-console`;
      const previousModerationState = account.leaderboardModerationState ?? {};
      const leaderboardModerationState = {
        ...(previousModerationState.hiddenAt ? { hiddenAt: previousModerationState.hiddenAt } : {}),
        ...(previousModerationState.hiddenByPlayerId ? { hiddenByPlayerId: previousModerationState.hiddenByPlayerId } : {}),
        ...(previousModerationState.hiddenReason ? { hiddenReason: previousModerationState.hiddenReason } : {})
      };
      const updatedAccount = await store.savePlayerAccountProgress(playerId, {
        leaderboardModerationState,
        recentEventLog: appendEventLogEntries(account.recentEventLog, [
          buildLeaderboardModerationEventEntry({
            playerId,
            action: "freeze_cleared",
            actorPlayerId,
            occurredAt: clearedAt,
            reason: input.reason
          })
        ])
      });

      sendJson(response, 200, {
        ok: true,
        account: updatedAccount,
        audit: {
          action: "freeze_cleared",
          actorPlayerId,
          occurredAt: clearedAt,
          ...(input.reason ? { reason: input.reason } : {})
        }
      });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/leaderboard/moderation-queue", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"])) return;
    if (!hasLeaderboardModerationQueueStore(store)) return sendStoreUnavailable(response);

    try {
      const limit = readLimit(request, 20);
      const page = readPage(request, 1);
      const flagType = readLeaderboardQueueFlagType(request);
      const accounts = await store.listPlayerAccounts({ limit: 10_000, offset: 0 });
      const queue = accounts
        .map((account) => ({
          playerId: account.playerId,
          displayName: account.displayName,
          eloRating: account.eloRating ?? 1000,
          abuseState: account.leaderboardAbuseState ?? { status: "clear" as const },
          moderationState: account.leaderboardModerationState ?? {},
          flagTypes: getLeaderboardQueueFlagTypes(account),
          lastFlagAt: getLeaderboardQueueLastFlagAt(account)
        }))
        .filter((item) => item.flagTypes.length > 0)
        .filter((item) => !flagType || item.flagTypes.includes(flagType))
        .sort((left, right) => right.lastFlagAt.localeCompare(left.lastFlagAt) || left.playerId.localeCompare(right.playerId));

      const total = queue.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const offset = (page - 1) * limit;
      sendJson(response, 200, {
        items: queue.slice(offset, offset + limit),
        page,
        limit,
        total,
        totalPages,
        ...(flagType ? { flagType } : {})
      });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/players/:id/leaderboard/remove", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasPlayerAccountStore(store)) return sendStoreUnavailable(response);

    try {
      const playerId = readRequiredParam(request, "id");
      const input = parseGuildModerationBody(await readJsonBody(request));
      const account = (await store.loadPlayerAccount(playerId)) ?? (await store.ensurePlayerAccount({ playerId }));
      const leaderboardModerationState = {
        ...(account.leaderboardModerationState ?? {}),
        hiddenAt: new Date().toISOString(),
        hiddenByPlayerId: `${role}:admin-console`,
        ...(input.reason ? { hiddenReason: input.reason } : {})
      };
      const updatedAccount = await store.savePlayerAccountProgress(playerId, {
        leaderboardModerationState
      });
      sendJson(response, 200, { ok: true, account: updatedAccount });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.get("/api/admin/guilds/:id", async (request, response) => {
    if (!requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"])) return;
    if (!hasGuildModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const guildId = readRequiredParam(request, "id");
      const guild = await guildService.getGuildForAdmin(guildId);
      const audit = await guildService.listGuildAuditLogs(guildId, readLimit(request, 50));
      sendJson(response, 200, { guild, audit });
    } catch (error) {
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/guilds/:id/hide", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasGuildModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const guildId = readRequiredParam(request, "id");
      const input = parseGuildModerationBody(await readJsonBody(request));
      const guild = await guildService.hideGuild(guildId, `${role}:admin-console`, input.reason);
      sendJson(response, 200, { ok: true, guild });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/guilds/:id/unhide", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasGuildModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const guildId = readRequiredParam(request, "id");
      const input = parseGuildModerationBody(await readJsonBody(request));
      const guild = await guildService.unhideGuild(guildId, `${role}:admin-console`, input.reason);
      sendJson(response, 200, { ok: true, guild });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });

  app.post("/api/admin/guilds/:id/delete", async (request, response) => {
    const role = requireSupportRole(response, request, ["admin", "support-moderator", "support-supervisor"]);
    if (!role) return;
    if (!hasGuildModerationStore(store)) return sendStoreUnavailable(response);

    try {
      const guildId = readRequiredParam(request, "id");
      const input = parseGuildModerationBody(await readJsonBody(request));
      await guildService.deleteGuildAsAdmin(guildId, `${role}:admin-console`, input.reason);
      sendJson(response, 200, { ok: true, guildId });
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        sendJson(response, 413, { error: (error as Error).message });
        return;
      }
      if (error instanceof InvalidAdminJsonError) {
        sendInvalidJson(response);
        return;
      }
      if (error instanceof InvalidAdminPayloadError) {
        sendInvalidPayload(response, error.message);
        return;
      }
      sendJson(response, 400, { error: String(error) });
    }
  });
}
