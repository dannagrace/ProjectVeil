import { randomUUID } from "node:crypto";
import {
  appendEventLogEntries,
  DEFAULT_TUTORIAL_STEP,
  getEquipmentDefinition,
  getTierForDivision,
  getTierForRating,
  normalizeGuildState,
  normalizeCosmeticInventory,
  normalizeTextForModeration,
  normalizeEloRating,
  normalizeEventLogEntries,
  normalizeEventLogQuery,
  resolveCosmeticCatalog,
  tryAddEquipmentToInventory,
  type EventLogEntry,
  type CosmeticId,
  type GuildState
} from "../../../packages/shared/src/index";
import {
  createPlayerAccountsFromWorldState,
  type GuildAuditLogCreateInput,
  type GuildChatMessageCreateInput,
  type GuildChatMessageListOptions,
  type GuildChatMessageRecord,
  type GuildAuditLogListOptions,
  type GuildAuditLogRecord,
  type GuildListOptions,
  MAX_PLAYER_AVATAR_URL_LENGTH,
  MAX_PLAYER_DISPLAY_NAME_LENGTH,
  type PaymentOrderCompleteInput,
  type PaymentOrderCreateInput,
  type PaymentOrderGrantRetryInput,
  type PaymentOrderListOptions,
  type PaymentReceiptSnapshot,
  type PaymentOrderSettlement,
  type PaymentOrderSnapshot,
  type RoomSnapshotStore,
  type BattleSnapshotCompensation,
  type BattleSnapshotInterruptedSettlementInput,
  type BattleSnapshotListOptions,
  type BattleSnapshotRecord,
  type BattleSnapshotResolutionInput,
  type BattleSnapshotStartInput,
  type PlayerAccountBanHistoryListOptions,
  type PlayerAccountBanInput,
  type PlayerAccountBanSnapshot,
  type PlayerAccountAuthSnapshot,
  type PlayerAccountAuthRevokeInput,
  type PlayerAccountAuthSessionInput,
  type PlayerAccountDeviceSessionSnapshot,
  type PlayerAccountCredentialInput,
  type PlayerAccountEnsureInput,
  type GuestAccountMigrationInput,
  type GuestAccountMigrationResult,
  type PlayerAccountListOptions,
  type PlayerAccountUnbanInput,
  type PlayerBanHistoryRecord,
  type PlayerCompensationCreateInput,
  type AdminAuditLogCreateInput,
  type AdminAuditLogListOptions,
  type AdminAuditLogRecord,
  type PlayerCompensationListOptions,
  type PlayerCompensationRecord,
  type PlayerPurchaseHistoryQuery,
  type PlayerPurchaseHistoryRecord,
  type PlayerPurchaseHistorySnapshot,
  type PlayerAccountWechatMiniGameIdentityInput,
  type PlayerAccountProfilePatch,
  type PlayerAccountProgressPatch,
  type PlayerAccountSnapshot,
  type PlayerQuestState,
  type PlayerReportCreateInput,
  type PlayerReportListOptions,
  type PlayerReportRecord,
  type PlayerReportResolveInput,
  type SupportTicketCreateInput,
  type SupportTicketListOptions,
  type SupportTicketRecord,
  type SupportTicketResolveInput,
  type PlayerHeroArchiveSnapshot,
  type PlayerEventHistoryQuery,
  type PlayerEventHistorySnapshot,
  type LeaderboardSeasonArchiveEntry,
  type SeasonCloseSummary,
  type SeasonListOptions,
  type SeasonSnapshot,
  type ShopPurchaseMutationInput,
  type ShopPurchaseResult
} from "./persistence";
import { normalizeMobilePushTokenRegistrations } from "./mobile-push-tokens";
import {
  assertDisplayNameAvailableOrThrow,
  buildBannedAccountNameReservationExpiry
} from "./display-name-rules";
import type { RoomPersistenceSnapshot } from "./index";
import {
  applyBattlePassXp,
  resolveBattlePassConfig,
  resolveBattlePassTier,
  toBattlePassRewardGrant
} from "./battle-pass";
import { applySeasonSoftDecay, decayDivisionToRating, getCurrentAndPreviousWeeklyEntries, resolveCompetitiveProgression } from "./competitive-season";
import { computeSeasonReward, resolveSeasonRewardConfig } from "./season-rewards";
import {
  claimAllPlayerMailboxMessages,
  claimPlayerMailboxMessage,
  createMailboxClaimEventLogEntry,
  deliverPlayerMailboxMessage,
  normalizePlayerMailboxMessage,
  pruneExpiredPlayerMailboxMessages
} from "./player-mailbox";

function cloneAccount(account: PlayerAccountSnapshot): PlayerAccountSnapshot {
  return structuredClone(account);
}

function cloneArchive(archive: PlayerHeroArchiveSnapshot): PlayerHeroArchiveSnapshot {
  return structuredClone(archive);
}

function normalizePaymentRetryPolicy(input?: PaymentOrderCompleteInput["retryPolicy"] | PaymentOrderGrantRetryInput["retryPolicy"]) {
  return {
    maxAttempts: Math.max(1, Math.floor(input?.maxAttempts ?? 5)),
    baseDelayMs: Math.max(1_000, Math.floor(input?.baseDelayMs ?? 60_000))
  };
}

function computePaymentRetryDelayMs(attemptCount: number, baseDelayMs: number): number {
  const exponent = Math.max(0, Math.min(6, Math.floor(attemptCount) - 1));
  return Math.max(1_000, baseDelayMs * 2 ** exponent);
}

function normalizePaymentGrantError(value: unknown): string {
  const normalized = (value instanceof Error ? value.message : String(value)).trim();
  return (normalized || "grant_failed").slice(0, 512);
}

function normalizePlayerId(playerId: string): string {
  const normalized = playerId.trim();
  if (!normalized) {
    throw new Error("playerId must not be empty");
  }

  return normalized;
}

function normalizeDisplayName(playerId: string, displayName?: string | null): string {
  const normalized = displayName?.trim() || playerId;
  return normalized.slice(0, MAX_PLAYER_DISPLAY_NAME_LENGTH);
}

function normalizeDisplayNameLookup(displayName: string): string {
  const normalized = normalizeTextForModeration(displayName);
  if (!normalized) {
    throw new Error("displayName must not be empty");
  }

  return normalized.slice(0, 191);
}

function parseGuildChatCursor(cursor?: string): { createdAt: string; messageId: string } | null {
  const normalized = cursor?.trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf("|");
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    throw new Error("beforeCursor must be formatted as createdAt|messageId");
  }

  const createdAt = normalized.slice(0, separatorIndex);
  const messageId = normalized.slice(separatorIndex + 1).trim();
  const createdAtDate = new Date(createdAt);
  if (Number.isNaN(createdAtDate.getTime()) || !messageId) {
    throw new Error("beforeCursor is invalid");
  }

  return {
    createdAt: createdAtDate.toISOString(),
    messageId
  };
}

function normalizeAvatarUrl(avatarUrl?: string | null): string | undefined {
  const normalized = avatarUrl?.trim();
  return normalized ? normalized.slice(0, MAX_PLAYER_AVATAR_URL_LENGTH) : undefined;
}

function normalizeLoginId(loginId: string): string {
  const normalized = loginId.trim().toLowerCase();
  if (!normalized) {
    throw new Error("loginId must not be empty");
  }

  return normalized;
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error("sessionId must not be empty");
  }

  return normalized;
}

function normalizeResourceLedger(resources?: PlayerAccountSnapshot["globalResources"] | Partial<PlayerAccountSnapshot["globalResources"]>): PlayerAccountSnapshot["globalResources"] {
  return {
    gold: Math.max(0, Math.floor(resources?.gold ?? 0)),
    wood: Math.max(0, Math.floor(resources?.wood ?? 0)),
    ore: Math.max(0, Math.floor(resources?.ore ?? 0))
  };
}

function normalizePurchaseHistoryDate(value: string, field: "from" | "to"): number {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${field} must be a valid ISO timestamp`);
  }
  return timestamp;
}

export class MemoryRoomSnapshotStore implements RoomSnapshotStore {
  private readonly snapshots = new Map<string, RoomPersistenceSnapshot>();
  private readonly battleSnapshots = new Map<string, BattleSnapshotRecord>();
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly guilds = new Map<string, GuildState>();
  private readonly guildIdByPlayerId = new Map<string, string>();
  private readonly guildAuditLogs: GuildAuditLogRecord[] = [];
  private readonly guildMessages = new Map<string, GuildChatMessageRecord[]>();
  private readonly nameHistoryByPlayerId = new Map<string, Array<{
    id: number;
    playerId: string;
    displayName: string;
    normalizedName: string;
    changedAt: string;
  }>>();
  private readonly activeNameReservations = new Map<string, {
    id: number;
    playerId: string;
    displayName: string;
    normalizedName: string;
    reservedUntil: string;
    reason: string;
    createdAt: string;
  }>();
  private readonly paymentOrders = new Map<string, PaymentOrderSnapshot>();
  private readonly paymentReceiptsByOrderId = new Map<string, PaymentReceiptSnapshot>();
  private readonly paymentReceiptOrderIdByTransactionId = new Map<string, string>();
  private readonly banHistoryByPlayerId = new Map<string, PlayerBanHistoryRecord[]>();
  private readonly compensationHistoryByPlayerId = new Map<string, PlayerCompensationRecord[]>();
  private readonly adminAuditLogs: AdminAuditLogRecord[] = [];
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();
  private readonly authSessionsByPlayerId = new Map<string, Map<string, PlayerAccountDeviceSessionSnapshot>>();
  private readonly playerIdByWechatOpenId = new Map<string, string>();
  private readonly heroArchives = new Map<string, PlayerHeroArchiveSnapshot>();
  private readonly playerQuestStates = new Map<string, PlayerQuestState>();
  private readonly shopPurchases = new Map<string, ShopPurchaseResult>();
  private readonly reports = new Map<string, PlayerReportRecord>();
  private readonly supportTickets = new Map<string, SupportTicketRecord>();
  private readonly seasons = new Map<string, SeasonSnapshot>();
  private readonly leaderboardSeasonArchives = new Map<string, LeaderboardSeasonArchiveEntry[]>();
  private readonly seasonRewardLog = new Map<string, { gems: number; badge: string; distributedAt: string }>();
  private readonly referrals = new Set<string>();
  private nextReportId = 1;
  private nextPlayerNameHistoryId = 1;
  private nextPlayerNameReservationId = 1;

  private appendPlayerNameHistory(playerId: string, displayName: string, changedAt = new Date().toISOString()): void {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const history = this.nameHistoryByPlayerId.get(normalizedPlayerId) ?? [];
    history.unshift({
      id: this.nextPlayerNameHistoryId++,
      playerId: normalizedPlayerId,
      displayName: displayName.trim(),
      normalizedName: normalizeDisplayNameLookup(displayName),
      changedAt
    });
    this.nameHistoryByPlayerId.set(normalizedPlayerId, history);
  }

  private reserveBannedPlayerNames(playerId: string, displayNames: string[]): void {
    const reservedUntil = buildBannedAccountNameReservationExpiry();
    for (const displayName of Array.from(new Set(displayNames.map((entry) => entry.trim()).filter(Boolean)))) {
      const normalizedName = normalizeDisplayNameLookup(displayName);
      const existing = this.activeNameReservations.get(normalizedName);
      this.activeNameReservations.set(normalizedName, {
        id: existing?.id ?? this.nextPlayerNameReservationId++,
        playerId: normalizePlayerId(playerId),
        displayName,
        normalizedName,
        reservedUntil:
          existing && new Date(existing.reservedUntil).getTime() > new Date(reservedUntil).getTime()
            ? existing.reservedUntil
            : reservedUntil,
        reason: "banned_account",
        createdAt: existing?.createdAt ?? new Date().toISOString()
      });
    }
  }

  async load(roomId: string): Promise<RoomPersistenceSnapshot | null> {
    const snapshot = this.snapshots.get(roomId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    const account = this.accounts.get(normalizePlayerId(playerId));
    return account ? cloneAccount(account) : null;
  }

  async loadGuild(guildId: string): Promise<GuildState | null> {
    const guild = this.guilds.get(guildId.trim());
    return guild ? normalizeGuildState(structuredClone(guild)) : null;
  }

  async loadGuildByMemberPlayerId(playerId: string): Promise<GuildState | null> {
    const guildId = this.guildIdByPlayerId.get(normalizePlayerId(playerId));
    if (!guildId) {
      return null;
    }

    return this.loadGuild(guildId);
  }

  async listGuildAuditLogs(options: GuildAuditLogListOptions = {}): Promise<GuildAuditLogRecord[]> {
    const sinceMs =
      options.since && !Number.isNaN(new Date(options.since).getTime()) ? new Date(options.since).getTime() : null;
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 50));
    return this.guildAuditLogs
      .filter((entry) => !options.guildId || entry.guildId === options.guildId.trim())
      .filter((entry) => !options.actorPlayerId || entry.actorPlayerId === normalizePlayerId(options.actorPlayerId))
      .filter((entry) => sinceMs === null || new Date(entry.occurredAt).getTime() >= sinceMs)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.auditId.localeCompare(left.auditId))
      .slice(0, safeLimit)
      .map((entry) => structuredClone(entry));
  }

  async appendGuildAuditLog(input: GuildAuditLogCreateInput): Promise<GuildAuditLogRecord> {
    const entry: GuildAuditLogRecord = {
      auditId: randomUUID(),
      guildId: input.guildId.trim(),
      action: input.action,
      actorPlayerId: normalizePlayerId(input.actorPlayerId),
      occurredAt: new Date(input.occurredAt ?? Date.now()).toISOString(),
      name: input.name.trim().slice(0, 40),
      tag: input.tag.trim().toUpperCase().slice(0, 4),
      ...(input.reason?.trim() ? { reason: input.reason.trim().slice(0, 200) } : {})
    };
    this.guildAuditLogs.push(entry);
    return structuredClone(entry);
  }

  async listGuildChatMessages(options: GuildChatMessageListOptions): Promise<GuildChatMessageRecord[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 50)));
    const cursor = parseGuildChatCursor(options.beforeCursor);
    const items = (this.guildMessages.get(options.guildId.trim()) ?? [])
      .filter((message) => new Date(message.expiresAt).getTime() > Date.now())
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.messageId.localeCompare(left.messageId))
      .filter((message) => {
        if (!cursor) {
          return true;
        }

        return (
          message.createdAt < cursor.createdAt ||
          (message.createdAt === cursor.createdAt && message.messageId < cursor.messageId)
        );
      })
      .slice(0, safeLimit);

    return items.map((message) => structuredClone(message));
  }

  async loadGuildChatMessage(guildId: string, messageId: string): Promise<GuildChatMessageRecord | null> {
    const item = (this.guildMessages.get(guildId.trim()) ?? []).find((message) => message.messageId === messageId.trim());
    if (!item || new Date(item.expiresAt).getTime() <= Date.now()) {
      return null;
    }

    return structuredClone(item);
  }

  async createGuildChatMessage(input: GuildChatMessageCreateInput): Promise<GuildChatMessageRecord> {
    const record: GuildChatMessageRecord = {
      messageId: randomUUID(),
      guildId: input.guildId.trim(),
      authorPlayerId: normalizePlayerId(input.authorPlayerId),
      authorDisplayName: normalizeDisplayName(input.authorPlayerId, input.authorDisplayName),
      content: input.content.trim().slice(0, 500),
      createdAt: new Date(input.createdAt ?? Date.now()).toISOString(),
      expiresAt: new Date(input.expiresAt).toISOString()
    };
    const existing = this.guildMessages.get(record.guildId) ?? [];
    existing.push(structuredClone(record));
    this.guildMessages.set(record.guildId, existing);
    return structuredClone(record);
  }

  async deleteGuildChatMessage(guildId: string, messageId: string): Promise<boolean> {
    const normalizedGuildId = guildId.trim();
    const existing = this.guildMessages.get(normalizedGuildId) ?? [];
    const next = existing.filter((message) => message.messageId !== messageId.trim());
    if (next.length === existing.length) {
      return false;
    }

    if (next.length === 0) {
      this.guildMessages.delete(normalizedGuildId);
    } else {
      this.guildMessages.set(normalizedGuildId, next);
    }
    return true;
  }

  async loadPaymentOrder(orderId: string): Promise<PaymentOrderSnapshot | null> {
    const normalizedOrderId = orderId.trim();
    if (!normalizedOrderId) {
      throw new Error("orderId must not be empty");
    }

    const order = this.paymentOrders.get(normalizedOrderId);
    return order ? structuredClone(order) : null;
  }

  async listPaymentOrders(options: PaymentOrderListOptions = {}): Promise<PaymentOrderSnapshot[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
    const statusSet = options.statuses?.length ? new Set(options.statuses) : null;
    const dueBeforeMs =
      options.dueBefore && !Number.isNaN(new Date(options.dueBefore).getTime()) ? new Date(options.dueBefore).getTime() : null;

    return Array.from(this.paymentOrders.values())
      .filter((order) => (statusSet ? statusSet.has(order.status) : true))
      .filter((order) =>
        dueBeforeMs == null ? true : order.nextGrantRetryAt != null && new Date(order.nextGrantRetryAt).getTime() <= dueBeforeMs
      )
      .sort((left, right) => {
        const leftRetryAt = left.nextGrantRetryAt ? new Date(left.nextGrantRetryAt).getTime() : Number.POSITIVE_INFINITY;
        const rightRetryAt = right.nextGrantRetryAt ? new Date(right.nextGrantRetryAt).getTime() : Number.POSITIVE_INFINITY;
        return leftRetryAt - rightRetryAt || right.updatedAt.localeCompare(left.updatedAt) || left.orderId.localeCompare(right.orderId);
      })
      .slice(0, safeLimit)
      .map((order) => structuredClone(order));
  }

  async loadPaymentReceiptByOrderId(orderId: string): Promise<PaymentReceiptSnapshot | null> {
    const normalizedOrderId = orderId.trim();
    if (!normalizedOrderId) {
      throw new Error("orderId must not be empty");
    }

    const receipt = this.paymentReceiptsByOrderId.get(normalizedOrderId);
    return receipt ? structuredClone(receipt) : null;
  }

  async countVerifiedPaymentReceiptsSince(playerId: string, since: string): Promise<number> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw new Error("since must be a valid ISO timestamp");
    }

    return Array.from(this.paymentReceiptsByOrderId.values()).filter(
      (receipt) => receipt.playerId === normalizedPlayerId && new Date(receipt.verifiedAt).getTime() >= sinceDate.getTime()
    ).length;
  }

  async loadPlayerBan(playerId: string): Promise<PlayerAccountBanSnapshot | null> {
    const account = await this.loadPlayerAccount(playerId);
    if (!account) {
      return null;
    }

    return {
      playerId: account.playerId,
      banStatus: account.banStatus ?? "none",
      ...(account.banExpiry ? { banExpiry: account.banExpiry } : {}),
      ...(account.banReason ? { banReason: account.banReason } : {})
    };
  }

  async listPlayerNameHistory(playerId: string, options: { limit?: number } = {}) {
    return (this.nameHistoryByPlayerId.get(normalizePlayerId(playerId)) ?? [])
      .slice(0, Math.max(1, Math.floor(options.limit ?? 20)))
      .map((entry) => structuredClone(entry));
  }

  async findPlayerNameHistoryByDisplayName(displayName: string, options: { limit?: number } = {}) {
    const normalizedName = normalizeDisplayNameLookup(displayName);
    const matches = Array.from(this.nameHistoryByPlayerId.values())
      .flat()
      .filter((entry) => entry.normalizedName === normalizedName)
      .sort((left, right) => right.changedAt.localeCompare(left.changedAt) || right.id - left.id)
      .slice(0, Math.max(1, Math.floor(options.limit ?? 20)));
    return matches.map((entry) => structuredClone(entry));
  }

  async findActivePlayerNameReservation(displayName: string) {
    const normalizedName = normalizeDisplayNameLookup(displayName);
    const reservation = this.activeNameReservations.get(normalizedName);
    if (!reservation) {
      return null;
    }

    if (new Date(reservation.reservedUntil).getTime() <= Date.now()) {
      this.activeNameReservations.delete(normalizedName);
      return null;
    }

    return structuredClone(reservation);
  }

  async loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedLoginId = normalizeLoginId(loginId);
    const account = Array.from(this.accounts.values()).find((item) => item.loginId === normalizedLoginId);
    return account ? cloneAccount(account) : null;
  }

  async loadPlayerAccountByWechatMiniGameOpenId(openId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedOpenId = openId.trim();
    if (!normalizedOpenId) {
      throw new Error("wechatMiniGameOpenId must not be empty");
    }

    const playerId = this.playerIdByWechatOpenId.get(normalizedOpenId);
    if (!playerId) {
      return null;
    }

    const account = this.accounts.get(playerId);
    return account ? cloneAccount(account) : null;
  }

  async createPlayerReport(input: PlayerReportCreateInput): Promise<PlayerReportRecord> {
    const reporterId = normalizePlayerId(input.reporterId);
    const targetId = normalizePlayerId(input.targetId);
    const roomId = input.roomId.trim();
    if (!roomId) {
      throw new Error("roomId must not be empty");
    }
    if (reporterId === targetId) {
      throw new Error("reporterId must not match targetId");
    }

    const duplicate = Array.from(this.reports.values()).find(
      (report) => report.roomId === roomId && report.reporterId === reporterId && report.targetId === targetId
    );
    if (duplicate) {
      throw new Error("duplicate_player_report");
    }

    const report: PlayerReportRecord = {
      reportId: String(this.nextReportId++),
      reporterId,
      targetId,
      reason: input.reason,
      ...(input.description?.trim() ? { description: input.description.trim().slice(0, 512) } : {}),
      roomId,
      status: "pending",
      createdAt: new Date().toISOString()
    };
    this.reports.set(report.reportId, structuredClone(report));
    return structuredClone(report);
  }

  async loadPlayerEventHistory(
    playerId: string,
    query: PlayerEventHistoryQuery = {}
  ): Promise<PlayerEventHistorySnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedQuery = normalizeEventLogQuery(query);
    const items = normalizeEventLogEntries(this.accounts.get(normalizedPlayerId)?.recentEventLog)
      .filter(
        (entry) =>
          (!normalizedQuery.category || entry.category === normalizedQuery.category) &&
          (!normalizedQuery.heroId || entry.heroId === normalizedQuery.heroId) &&
          (!normalizedQuery.achievementId || entry.achievementId === normalizedQuery.achievementId) &&
          (!normalizedQuery.worldEventType || entry.worldEventType === normalizedQuery.worldEventType) &&
          (!normalizedQuery.since || entry.timestamp >= normalizedQuery.since) &&
          (!normalizedQuery.until || entry.timestamp <= normalizedQuery.until)
      )
      .sort(
        (left: EventLogEntry, right: EventLogEntry) =>
          right.timestamp.localeCompare(left.timestamp) || left.id.localeCompare(right.id)
      );
    const total = items.length;
    const sliced = items.slice(
      normalizedQuery.offset,
      normalizedQuery.limit != null ? normalizedQuery.offset + normalizedQuery.limit : undefined
    );

    return {
      total,
      items: structuredClone(sliced)
    };
  }

  async loadPlayerQuestState(playerId: string): Promise<PlayerQuestState | null> {
    return structuredClone(this.playerQuestStates.get(normalizePlayerId(playerId)) ?? null);
  }

  async saveBattleSnapshotStart(input: BattleSnapshotStartInput): Promise<BattleSnapshotRecord> {
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    if (Number.isNaN(startedAt.getTime())) {
      throw new Error("startedAt must be a valid ISO timestamp");
    }

    const key = `${input.roomId}:${input.battleId}`;
    const existing = this.battleSnapshots.get(key);
    const next: BattleSnapshotRecord = {
      roomId: input.roomId,
      battleId: input.battleId,
      heroId: input.heroId,
      attackerPlayerId: normalizePlayerId(input.attackerPlayerId),
      ...(input.defenderPlayerId ? { defenderPlayerId: normalizePlayerId(input.defenderPlayerId) } : {}),
      ...(input.defenderHeroId ? { defenderHeroId: input.defenderHeroId } : {}),
      ...(input.neutralArmyId ? { neutralArmyId: input.neutralArmyId } : {}),
      encounterKind: input.encounterKind,
      ...(input.initiator ? { initiator: input.initiator } : {}),
      path: structuredClone(input.path),
      moveCost: Math.max(0, Math.floor(input.moveCost)),
      playerIds: Array.from(new Set(input.playerIds.map((playerId) => normalizePlayerId(playerId)))),
      initialState: structuredClone(input.initialState),
      ...(input.estimatedCompensationGrant
        ? { estimatedCompensationGrant: structuredClone(input.estimatedCompensationGrant) }
        : {}),
      status: "active",
      startedAt: startedAt.toISOString(),
      createdAt: existing?.createdAt ?? startedAt.toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.battleSnapshots.set(key, next);
    return structuredClone(next);
  }

  async saveBattleSnapshotResolution(input: BattleSnapshotResolutionInput): Promise<BattleSnapshotRecord | null> {
    const key = `${input.roomId}:${input.battleId}`;
    const existing = this.battleSnapshots.get(key);
    if (!existing) {
      return null;
    }

    const resolvedAt = input.resolvedAt ? new Date(input.resolvedAt) : new Date();
    if (Number.isNaN(resolvedAt.getTime())) {
      throw new Error("resolvedAt must be a valid ISO timestamp");
    }

    const next: BattleSnapshotRecord = {
      ...existing,
      status: "resolved",
      result: input.result,
      resolutionReason: input.resolutionReason ?? "battle_resolved",
      resolvedAt: resolvedAt.toISOString(),
      updatedAt: new Date().toISOString()
    };
    delete next.compensation;
    this.battleSnapshots.set(key, next);
    return structuredClone(next);
  }

  async settleInterruptedBattleSnapshot(
    input: BattleSnapshotInterruptedSettlementInput
  ): Promise<BattleSnapshotRecord | null> {
    const key = `${input.roomId}:${input.battleId}`;
    const existing = this.battleSnapshots.get(key);
    if (!existing) {
      return null;
    }

    if (existing.status !== "active") {
      return structuredClone(existing);
    }

    const resolvedAt = input.resolvedAt ? new Date(input.resolvedAt) : new Date();
    if (Number.isNaN(resolvedAt.getTime())) {
      throw new Error("resolvedAt must be a valid ISO timestamp");
    }

    if (input.compensation) {
      await this.deliverPlayerMailbox({
        playerIds: input.compensation.playerIds,
        message: normalizePlayerMailboxMessage(
          {
            id: input.compensation.mailboxMessageId,
            kind: input.compensation.kind,
            title: input.compensation.title,
            body: input.compensation.body,
            ...(input.compensation.grant ? { grant: input.compensation.grant } : {})
          },
          resolvedAt
        )
      });
    }

    const next: BattleSnapshotRecord = {
      ...existing,
      status: input.status,
      resolutionReason: input.resolutionReason,
      ...(input.compensation ? { compensation: structuredClone(input.compensation) } : {}),
      resolvedAt: resolvedAt.toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.battleSnapshots.set(key, next);
    return structuredClone(next);
  }

  async listBattleSnapshotsForPlayer(
    playerId: string,
    options: BattleSnapshotListOptions = {}
  ): Promise<BattleSnapshotRecord[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const statuses = options.statuses ? new Set(options.statuses) : null;
    const limit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));

    return Array.from(this.battleSnapshots.values())
      .filter((record) => record.playerIds.includes(normalizedPlayerId) && (!statuses || statuses.has(record.status)))
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.battleId.localeCompare(right.battleId))
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(normalizePlayerId(playerId)))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account))
      .map((account) => cloneAccount(account));
  }

  async listGuilds(options: GuildListOptions = {}): Promise<GuildState[]> {
    const safeLimit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
    return Array.from(this.guilds.values())
      .filter((guild) => !options.playerId || guild.members.some((member) => member.playerId === options.playerId))
      .sort(
        (left, right) =>
          right.members.length - left.members.length ||
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id)
      )
      .slice(0, safeLimit)
      .map((guild) => normalizeGuildState(structuredClone(guild)));
  }

  async listPlayerReports(options: PlayerReportListOptions = {}): Promise<PlayerReportRecord[]> {
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 50));
    return Array.from(this.reports.values())
      .filter((report) => !options.status || report.status === options.status)
      .filter((report) => !options.roomId || report.roomId === options.roomId)
      .filter((report) => !options.reporterId || report.reporterId === options.reporterId)
      .filter((report) => !options.targetId || report.targetId === options.targetId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.reportId.localeCompare(right.reportId))
      .slice(0, safeLimit)
      .map((report) => structuredClone(report));
  }

  async loadSupportTicket(ticketId: string): Promise<SupportTicketRecord | null> {
    const normalizedTicketId = ticketId.trim();
    if (!normalizedTicketId) {
      throw new Error("ticketId must not be empty");
    }

    return structuredClone(this.supportTickets.get(normalizedTicketId) ?? null);
  }

  async createSupportTicket(input: SupportTicketCreateInput): Promise<SupportTicketRecord> {
    const playerId = normalizePlayerId(input.playerId);
    const message = input.message.trim();
    if (!message) {
      throw new Error("support ticket message must not be empty");
    }

    const normalizedCategory = input.category;
    if (normalizedCategory !== "bug" && normalizedCategory !== "payment" && normalizedCategory !== "account" && normalizedCategory !== "other") {
      throw new Error("support ticket category must be bug, payment, account, or other");
    }

    const normalizedPriority = input.priority ?? "normal";
    if (normalizedPriority !== "normal" && normalizedPriority !== "high" && normalizedPriority !== "urgent") {
      throw new Error("support ticket priority must be normal, high, or urgent");
    }

    const createdAt = new Date().toISOString();
    const ticket: SupportTicketRecord = {
      ticketId: randomUUID(),
      playerId,
      category: normalizedCategory,
      message: message.slice(0, 4_000),
      ...(input.attachmentsRef?.trim() ? { attachmentsRef: input.attachmentsRef.trim().slice(0, 512) } : {}),
      priority: normalizedPriority,
      status: "open",
      createdAt,
      updatedAt: createdAt
    };
    this.supportTickets.set(ticket.ticketId, structuredClone(ticket));
    return structuredClone(ticket);
  }

  async listSupportTickets(options: SupportTicketListOptions = {}): Promise<SupportTicketRecord[]> {
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 50));
    return Array.from(this.supportTickets.values())
      .filter((ticket) => !options.status || ticket.status === options.status)
      .filter((ticket) => !options.playerId || ticket.playerId === options.playerId)
      .filter((ticket) => !options.category || ticket.category === options.category)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.ticketId.localeCompare(right.ticketId))
      .slice(0, safeLimit)
      .map((ticket) => structuredClone(ticket));
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    const auth = this.authByLoginId.get(normalizeLoginId(loginId));
    return auth ? structuredClone(auth) : null;
  }

  async loadPlayerAccountAuthByPlayerId(playerId: string): Promise<PlayerAccountAuthSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const auth = Array.from(this.authByLoginId.values()).find((item) => item.playerId === normalizedPlayerId);
    return auth ? structuredClone(auth) : null;
  }

  async loadPlayerHeroArchives(playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]> {
    const playerIdSet = new Set(playerIds.map((playerId) => normalizePlayerId(playerId)));
    return Array.from(this.heroArchives.values())
      .filter((archive) => playerIdSet.has(archive.playerId))
      .map((archive) => cloneArchive(archive));
  }

  async ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    const playerId = normalizePlayerId(input.playerId);
    const existing = this.accounts.get(playerId);
    const existingPushTokens = existing?.pushTokens ? normalizeMobilePushTokenRegistrations(existing.pushTokens) : undefined;
    const nextDisplayName = normalizeDisplayName(playerId, input.displayName ?? existing?.displayName);
    if (!existing || nextDisplayName !== existing.displayName) {
      await assertDisplayNameAvailableOrThrow(this, nextDisplayName, playerId);
    }
    const nextAccount: PlayerAccountSnapshot = {
      playerId,
      displayName: nextDisplayName,
      ...(existing?.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      eloRating: normalizeEloRating(existing?.eloRating),
      gems: existing?.gems ?? 0,
      seasonXp: Math.max(0, Math.floor(existing?.seasonXp ?? 0)),
      seasonPassTier: Math.max(1, Math.floor(existing?.seasonPassTier ?? 1)),
      ...(existing?.seasonPassPremium ? { seasonPassPremium: true } : {}),
      ...(existing?.seasonPassClaimedTiers?.length ? { seasonPassClaimedTiers: [...existing.seasonPassClaimedTiers] } : {}),
      ...(existing?.seasonBadges?.length ? { seasonBadges: [...existing.seasonBadges] } : {}),
      ...(existing?.campaignProgress ? { campaignProgress: structuredClone(existing.campaignProgress) } : {}),
      ...(existing?.seasonalEventStates ? { seasonalEventStates: structuredClone(existing.seasonalEventStates) } : {}),
      ...(existing?.mailbox ? { mailbox: structuredClone(existing.mailbox) } : {}),
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: existing?.achievements ?? [],
      recentEventLog: existing?.recentEventLog ?? [],
      recentBattleReplays: existing?.recentBattleReplays ?? [],
      ...(existing?.dailyDungeonState ? { dailyDungeonState: structuredClone(existing.dailyDungeonState) } : {}),
      ...(existing?.leaderboardAbuseState ? { leaderboardAbuseState: structuredClone(existing.leaderboardAbuseState) } : {}),
      ...(existing?.leaderboardModerationState
        ? { leaderboardModerationState: structuredClone(existing.leaderboardModerationState) }
        : {}),
      ...(existing?.tutorialStep !== undefined ? { tutorialStep: existing.tutorialStep } : { tutorialStep: DEFAULT_TUTORIAL_STEP }),
      ...(input.lastRoomId?.trim()
        ? { lastRoomId: input.lastRoomId.trim() }
        : existing?.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.ageVerified ? { ageVerified: existing.ageVerified } : {}),
      ...(existing?.isMinor ? { isMinor: existing.isMinor } : {}),
      ...(existing?.dailyPlayMinutes ? { dailyPlayMinutes: existing.dailyPlayMinutes } : {}),
      ...(existing?.lastPlayDate ? { lastPlayDate: existing.lastPlayDate } : {}),
      ...(existing?.banStatus ? { banStatus: existing.banStatus } : {}),
      ...(existing?.banExpiry ? { banExpiry: existing.banExpiry } : {}),
      ...(existing?.banReason ? { banReason: existing.banReason } : {}),
      ...(existing?.accountSessionVersion != null ? { accountSessionVersion: existing.accountSessionVersion } : {}),
      ...(existing?.refreshSessionId ? { refreshSessionId: existing.refreshSessionId } : {}),
      ...(existing?.refreshTokenExpiresAt ? { refreshTokenExpiresAt: existing.refreshTokenExpiresAt } : {}),
      ...(existing?.wechatMiniGameOpenId ? { wechatMiniGameOpenId: existing.wechatMiniGameOpenId } : {}),
      ...(existing?.wechatMiniGameUnionId ? { wechatMiniGameUnionId: existing.wechatMiniGameUnionId } : {}),
      ...(existing?.wechatMiniGameBoundAt ? { wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt } : {}),
      ...(existing?.guestMigratedToPlayerId ? { guestMigratedToPlayerId: existing.guestMigratedToPlayerId } : {}),
      ...(existing?.credentialBoundAt ? { credentialBoundAt: existing.credentialBoundAt } : {}),
      ...(existing?.privacyConsentAt ? { privacyConsentAt: existing.privacyConsentAt } : {}),
      ...(existing?.notificationPreferences
        ? { notificationPreferences: structuredClone(existing.notificationPreferences) }
        : {}),
      ...(existingPushTokens ? { pushTokens: existingPushTokens } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const storedAccount = cloneAccount(nextAccount);
    this.accounts.set(playerId, storedAccount);
    if (!existing || existing.displayName !== nextDisplayName) {
      this.appendPlayerNameHistory(playerId, nextDisplayName, storedAccount.updatedAt);
    }
    return cloneAccount(storedAccount);
  }

  async creditGems(playerId: string, amount: number, reason: "purchase" | "reward", _refId: string): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedAmount = Math.floor(amount);
    if (!Number.isFinite(amount) || normalizedAmount <= 0) {
      throw new Error("gem amount must be a positive integer");
    }
    if (reason !== "purchase" && reason !== "reward") {
      throw new Error("credit reason must be purchase or reward");
    }

    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      gems: (existing.gems ?? 0) + normalizedAmount,
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    return cloneAccount(nextAccount);
  }

  async debitGems(playerId: string, amount: number, reason: "spend", _refId: string): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedAmount = Math.floor(amount);
    if (!Number.isFinite(amount) || normalizedAmount <= 0) {
      throw new Error("gem amount must be a positive integer");
    }
    if (reason !== "spend") {
      throw new Error("debit reason must be spend");
    }

    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    if ((existing.gems ?? 0) < normalizedAmount) {
      throw new Error("insufficient gems");
    }

    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      gems: (existing.gems ?? 0) - normalizedAmount,
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    return cloneAccount(nextAccount);
  }

  async claimPlayerReferral(referrerId: string, newPlayerId: string, rewardGems: number) {
    const normalizedReferrerId = normalizePlayerId(referrerId);
    const normalizedNewPlayerId = normalizePlayerId(newPlayerId);
    const normalizedRewardGems = Math.floor(rewardGems);
    if (!Number.isFinite(rewardGems) || normalizedRewardGems <= 0) {
      throw new Error("rewardGems must be a positive integer");
    }
    if (normalizedReferrerId === normalizedNewPlayerId) {
      throw new Error("self_referral_forbidden");
    }

    const referralKey = `${normalizedReferrerId}:${normalizedNewPlayerId}`;
    if (this.referrals.has(referralKey)) {
      throw new Error("duplicate_referral");
    }

    const referrer = await this.ensurePlayerAccount({ playerId: normalizedReferrerId });
    const newPlayer = await this.ensurePlayerAccount({ playerId: normalizedNewPlayerId });
    this.referrals.add(referralKey);

    this.accounts.set(normalizedReferrerId, {
      ...referrer,
      gems: (referrer.gems ?? 0) + normalizedRewardGems,
      updatedAt: new Date().toISOString()
    });
    this.accounts.set(normalizedNewPlayerId, {
      ...newPlayer,
      gems: (newPlayer.gems ?? 0) + normalizedRewardGems,
      updatedAt: new Date().toISOString()
    });

    return {
      claimed: true,
      rewardGems: normalizedRewardGems,
      referrerId: normalizedReferrerId,
      newPlayerId: normalizedNewPlayerId
    };
  }

  async deliverPlayerMailbox(input: import("./player-mailbox").PlayerMailboxDeliveryInput) {
    const message = normalizePlayerMailboxMessage(input.message);
    const deliveredPlayerIds: string[] = [];
    const skippedPlayerIds: string[] = [];

    for (const playerId of Array.from(new Set(input.playerIds.map((entry) => normalizePlayerId(entry))))) {
      const account = await this.ensurePlayerAccount({ playerId });
      const result = deliverPlayerMailboxMessage(account.mailbox, message);
      if (!result.delivered) {
        skippedPlayerIds.push(playerId);
        continue;
      }

      this.accounts.set(
        playerId,
        cloneAccount({
          ...account,
          mailbox: structuredClone(result.mailbox),
          updatedAt: new Date().toISOString()
        })
      );
      deliveredPlayerIds.push(playerId);
    }

    return { deliveredPlayerIds, skippedPlayerIds, message };
  }

  async claimPlayerMailboxMessage(playerId: string, messageId: string, claimedAt?: string) {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const account = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const now = claimedAt ? new Date(claimedAt) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new Error("claimedAt must be a valid ISO timestamp");
    }

    const result = claimPlayerMailboxMessage(account.mailbox, messageId, now);
    if (!result.claimed || !result.message || !result.granted) {
      return result;
    }

    const eventEntry = createMailboxClaimEventLogEntry(normalizedPlayerId, result.message, result.granted, result.message.claimedAt ?? now.toISOString());
    this.accounts.set(
      normalizedPlayerId,
      cloneAccount({
        ...account,
        gems: (account.gems ?? 0) + result.granted.gems,
        seasonPassPremium: account.seasonPassPremium === true || result.granted.seasonPassPremium,
        mailbox: structuredClone(result.mailbox),
        globalResources: {
          gold: (account.globalResources.gold ?? 0) + result.granted.resources.gold,
          wood: (account.globalResources.wood ?? 0) + result.granted.resources.wood,
          ore: (account.globalResources.ore ?? 0) + result.granted.resources.ore
        },
        recentEventLog: appendEventLogEntries(account.recentEventLog, [eventEntry]),
        updatedAt: now.toISOString()
      })
    );
    return result;
  }

  async claimAllPlayerMailboxMessages(playerId: string, claimedAt?: string) {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const account = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const now = claimedAt ? new Date(claimedAt) : new Date();
    if (Number.isNaN(now.getTime())) {
      throw new Error("claimedAt must be a valid ISO timestamp");
    }

    const result = claimAllPlayerMailboxMessages(account.mailbox, now);
    if (!result.claimed) {
      return result;
    }

    const eventEntries = result.claimedMessageIds
      .map((messageId, index) => {
        const message = result.mailbox.find((entry) => entry.id === messageId);
        const granted = result.granted[index];
        return message && granted
          ? createMailboxClaimEventLogEntry(normalizedPlayerId, message, granted, message.claimedAt ?? now.toISOString())
          : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const totalGrant = result.granted.reduce(
      (accumulator, grant) => ({
        gems: accumulator.gems + grant.gems,
        gold: accumulator.gold + grant.resources.gold,
        wood: accumulator.wood + grant.resources.wood,
        ore: accumulator.ore + grant.resources.ore,
        seasonPassPremium: accumulator.seasonPassPremium || grant.seasonPassPremium
      }),
      { gems: 0, gold: 0, wood: 0, ore: 0, seasonPassPremium: false }
    );

    this.accounts.set(
      normalizedPlayerId,
      cloneAccount({
        ...account,
        gems: (account.gems ?? 0) + totalGrant.gems,
        seasonPassPremium: account.seasonPassPremium === true || totalGrant.seasonPassPremium,
        mailbox: structuredClone(result.mailbox),
        globalResources: {
          gold: (account.globalResources.gold ?? 0) + totalGrant.gold,
          wood: (account.globalResources.wood ?? 0) + totalGrant.wood,
          ore: (account.globalResources.ore ?? 0) + totalGrant.ore
        },
        recentEventLog: appendEventLogEntries(account.recentEventLog, eventEntries),
        updatedAt: now.toISOString()
      })
    );
    return result;
  }

  private applyVerifiedPaymentGrant(
    account: PlayerAccountSnapshot,
    order: PaymentOrderSnapshot,
    input: {
      productName: string;
      grant: PaymentOrderCompleteInput["grant"];
      processedAt: string;
    }
  ): PlayerAccountSnapshot {
    const normalizedGrant = {
      gems: Math.max(0, Math.floor(input.grant.gems ?? order.gemAmount ?? 0)),
      resources: {
        gold: Math.max(0, Math.floor(input.grant.resources?.gold ?? 0)),
        wood: Math.max(0, Math.floor(input.grant.resources?.wood ?? 0)),
        ore: Math.max(0, Math.floor(input.grant.resources?.ore ?? 0))
      },
      seasonPassPremium: input.grant.seasonPassPremium === true,
      cosmeticIds: (input.grant.cosmeticIds ?? []).map((cosmeticId) => {
        const normalizedCosmeticId = cosmeticId.trim();
        if (!normalizedCosmeticId || !resolveCosmeticCatalog().some((entry) => entry.id === normalizedCosmeticId)) {
          throw new Error(`unknown cosmetic grant: ${cosmeticId}`);
        }
        return normalizedCosmeticId;
      }),
      equipmentIds: (input.grant.equipmentIds ?? []).map((equipmentId) => {
        const normalizedEquipmentId = equipmentId.trim();
        if (!normalizedEquipmentId || !getEquipmentDefinition(normalizedEquipmentId)) {
          throw new Error(`unknown equipment grant: ${equipmentId}`);
        }
        return normalizedEquipmentId;
      })
    };

    if (normalizedGrant.equipmentIds.length > 0) {
      const currentArchive = Array.from(this.heroArchives.values())
        .filter((archive) => archive.playerId === order.playerId)
        .sort((left, right) => left.heroId.localeCompare(right.heroId))[0];
      if (!currentArchive) {
        throw new Error("player hero archive not found");
      }

      let nextInventory = [...currentArchive.hero.loadout.inventory];
      for (const equipmentId of normalizedGrant.equipmentIds) {
        const inventoryUpdate = tryAddEquipmentToInventory(nextInventory, equipmentId);
        if (!inventoryUpdate.stored) {
          throw new Error("equipment inventory full");
        }
        nextInventory = inventoryUpdate.inventory;
      }

      this.heroArchives.set(`${currentArchive.playerId}:${currentArchive.heroId}`, {
        ...cloneArchive(currentArchive),
        hero: {
          ...cloneArchive(currentArchive).hero,
          loadout: {
            ...cloneArchive(currentArchive).hero.loadout,
            inventory: nextInventory
          }
        }
      });
    }

    return {
      ...account,
      gems: (account.gems ?? 0) + normalizedGrant.gems,
      seasonPassPremium: account.seasonPassPremium === true || normalizedGrant.seasonPassPremium,
      cosmeticInventory: normalizeCosmeticInventory({
        ownedIds: [...(account.cosmeticInventory?.ownedIds ?? []), ...normalizedGrant.cosmeticIds]
      }),
      globalResources: normalizeResourceLedger({
        gold: (account.globalResources.gold ?? 0) + normalizedGrant.resources.gold,
        wood: (account.globalResources.wood ?? 0) + normalizedGrant.resources.wood,
        ore: (account.globalResources.ore ?? 0) + normalizedGrant.resources.ore
      }),
      recentEventLog: appendEventLogEntries(account.recentEventLog, [
        {
          id: `${order.playerId}:${input.processedAt}:shop:${order.productId}:1`,
          timestamp: input.processedAt,
          roomId: "shop",
          playerId: order.playerId,
          category: "account",
          description: `Purchased ${input.productName} x1.`,
          rewards: []
        }
      ]),
      updatedAt: input.processedAt
    };
  }

  async createPaymentOrder(input: PaymentOrderCreateInput): Promise<PaymentOrderSnapshot> {
    const orderId = input.orderId.trim();
    const playerId = normalizePlayerId(input.playerId);
    const productId = input.productId.trim();
    const amount = Math.floor(input.amount);
    const gemAmount = Math.floor(input.gemAmount);
    if (!orderId) {
      throw new Error("orderId must not be empty");
    }
    if (!productId) {
      throw new Error("productId must not be empty");
    }
    if (!Number.isFinite(input.amount) || amount <= 0) {
      throw new Error("amount must be a positive integer");
    }
    if (!Number.isFinite(input.gemAmount) || gemAmount < 0) {
      throw new Error("gemAmount must be a non-negative integer");
    }

    await this.ensurePlayerAccount({ playerId });
    const now = new Date().toISOString();
    const order: PaymentOrderSnapshot = {
      orderId,
      playerId,
      productId,
      status: "created",
      amount,
      gemAmount,
      createdAt: now,
      updatedAt: now,
      grantAttemptCount: 0
    };
    this.paymentOrders.set(orderId, structuredClone(order));
    return structuredClone(order);
  }

  async completePaymentOrder(orderId: string, input: PaymentOrderCompleteInput): Promise<PaymentOrderSettlement> {
    const normalizedOrderId = orderId.trim();
    const normalizedWechatOrderId = input.wechatOrderId.trim();
    const normalizedProductName = input.productName.trim();
    if (!normalizedOrderId) {
      throw new Error("orderId must not be empty");
    }
    if (!normalizedWechatOrderId) {
      throw new Error("wechatOrderId must not be empty");
    }
    if (!normalizedProductName) {
      throw new Error("productName must not be empty");
    }

    const existingOrder = this.paymentOrders.get(normalizedOrderId);
    if (!existingOrder) {
      throw new Error("payment_order_not_found");
    }

    const account = await this.ensurePlayerAccount({ playerId: existingOrder.playerId });
    const existingReceipt = this.paymentReceiptsByOrderId.get(normalizedOrderId);
    if (existingOrder.status !== "created" || existingReceipt) {
      return {
        order: structuredClone(existingOrder),
        account,
        credited: false,
        ...(existingReceipt ? { receipt: structuredClone(existingReceipt) } : {})
      };
    }
    const duplicateOrderId = this.paymentReceiptOrderIdByTransactionId.get(normalizedWechatOrderId);
    if (duplicateOrderId && duplicateOrderId !== normalizedOrderId) {
      return {
        order: structuredClone(existingOrder),
        account,
        credited: false,
        ...(this.paymentReceiptsByOrderId.get(duplicateOrderId)
          ? { receipt: structuredClone(this.paymentReceiptsByOrderId.get(duplicateOrderId)!) }
          : {})
      };
    }

    const paidAt = new Date(input.paidAt ?? Date.now()).toISOString();
    const verifiedAt = new Date(input.verifiedAt ?? paidAt).toISOString();
    const retryPolicy = normalizePaymentRetryPolicy(input.retryPolicy);
    const receipt: PaymentReceiptSnapshot = {
      transactionId: normalizedWechatOrderId,
      orderId: normalizedOrderId,
      playerId: existingOrder.playerId,
      productId: existingOrder.productId,
      amount: existingOrder.amount,
      verifiedAt
    };
    this.paymentReceiptsByOrderId.set(normalizedOrderId, structuredClone(receipt));
    this.paymentReceiptOrderIdByTransactionId.set(normalizedWechatOrderId, normalizedOrderId);
    const processingOrder: PaymentOrderSnapshot = {
      ...structuredClone(existingOrder),
      status: "paid",
      wechatOrderId: normalizedWechatOrderId,
      paidAt,
      lastGrantAttemptAt: paidAt,
      grantAttemptCount: 1,
      updatedAt: paidAt
    };
    this.paymentOrders.set(normalizedOrderId, structuredClone(processingOrder));

    try {
      const nextAccount = this.applyVerifiedPaymentGrant(account, processingOrder, {
        productName: normalizedProductName,
        grant: input.grant,
        processedAt: paidAt
      });
      const settledOrder: PaymentOrderSnapshot = {
        ...processingOrder,
        status: "settled",
        settledAt: paidAt,
        updatedAt: paidAt
      };
      this.paymentOrders.set(normalizedOrderId, structuredClone(settledOrder));
      this.accounts.set(existingOrder.playerId, cloneAccount(nextAccount));

      return {
        order: structuredClone(settledOrder),
        account: cloneAccount(nextAccount),
        credited: true,
        receipt: structuredClone(receipt)
      };
    } catch (error) {
      const grantError = normalizePaymentGrantError(error);
      const deadLetter = 1 >= retryPolicy.maxAttempts;
      const nextRetryAt = new Date(new Date(paidAt).getTime() + computePaymentRetryDelayMs(1, retryPolicy.baseDelayMs)).toISOString();
      const nextOrder: PaymentOrderSnapshot = {
        ...processingOrder,
        status: deadLetter ? "dead_letter" : "grant_pending",
        lastGrantError: grantError,
        ...(deadLetter ? { deadLetteredAt: paidAt } : { nextGrantRetryAt: nextRetryAt }),
        updatedAt: paidAt
      };
      this.paymentOrders.set(normalizedOrderId, structuredClone(nextOrder));

      return {
        order: structuredClone(nextOrder),
        account,
        credited: false,
        receipt: structuredClone(receipt)
      };
    }
  }

  async retryPaymentOrderGrant(orderId: string, input: PaymentOrderGrantRetryInput): Promise<PaymentOrderSettlement> {
    const normalizedOrderId = orderId.trim();
    const normalizedProductName = input.productName.trim();
    if (!normalizedOrderId) {
      throw new Error("orderId must not be empty");
    }
    if (!normalizedProductName) {
      throw new Error("productName must not be empty");
    }

    const existingOrder = this.paymentOrders.get(normalizedOrderId);
    if (!existingOrder) {
      throw new Error("payment_order_not_found");
    }
    if (existingOrder.status === "settled") {
      return {
        order: structuredClone(existingOrder),
        account: await this.ensurePlayerAccount({ playerId: existingOrder.playerId }),
        credited: false,
        ...(this.paymentReceiptsByOrderId.get(normalizedOrderId)
          ? { receipt: structuredClone(this.paymentReceiptsByOrderId.get(normalizedOrderId)!) }
          : {})
      };
    }
    if (existingOrder.status !== "grant_pending" && existingOrder.status !== "dead_letter" && existingOrder.status !== "paid") {
      throw new Error("payment_order_not_retryable");
    }
    if (existingOrder.status === "dead_letter" && input.allowDeadLetter !== true) {
      throw new Error("payment_order_retry_requires_override");
    }

    const account = await this.ensurePlayerAccount({ playerId: existingOrder.playerId });
    const receipt = this.paymentReceiptsByOrderId.get(normalizedOrderId);
    if (!receipt) {
      throw new Error("payment_receipt_not_found");
    }

    const retriedAt = new Date(input.retriedAt ?? Date.now()).toISOString();
    const retryPolicy = normalizePaymentRetryPolicy(input.retryPolicy);
    const attemptCount = existingOrder.grantAttemptCount + 1;
    const processingOrder: PaymentOrderSnapshot = {
      ...structuredClone(existingOrder),
      lastGrantAttemptAt: retriedAt,
      grantAttemptCount: attemptCount,
      updatedAt: retriedAt
    };

    try {
      const nextAccount = this.applyVerifiedPaymentGrant(account, processingOrder, {
        productName: normalizedProductName,
        grant: input.grant,
        processedAt: retriedAt
      });
      const settledOrder: PaymentOrderSnapshot = {
        ...processingOrder,
        status: "settled",
        settledAt: retriedAt,
        updatedAt: retriedAt
      };
      delete settledOrder.nextGrantRetryAt;
      delete settledOrder.lastGrantError;
      delete settledOrder.deadLetteredAt;
      this.paymentOrders.set(normalizedOrderId, structuredClone(settledOrder));
      this.accounts.set(existingOrder.playerId, cloneAccount(nextAccount));

      return {
        order: structuredClone(settledOrder),
        account: cloneAccount(nextAccount),
        credited: true,
        receipt: structuredClone(receipt)
      };
    } catch (error) {
      const grantError = normalizePaymentGrantError(error);
      const deadLetter = attemptCount >= retryPolicy.maxAttempts;
      const nextRetryAt = new Date(new Date(retriedAt).getTime() + computePaymentRetryDelayMs(attemptCount, retryPolicy.baseDelayMs))
        .toISOString();
      const nextOrder: PaymentOrderSnapshot = {
        ...processingOrder,
        status: deadLetter ? "dead_letter" : "grant_pending",
        lastGrantError: grantError,
        ...(deadLetter ? { deadLetteredAt: retriedAt } : { nextGrantRetryAt: nextRetryAt }),
        updatedAt: retriedAt
      };
      if (deadLetter) {
        delete nextOrder.nextGrantRetryAt;
      }
      this.paymentOrders.set(normalizedOrderId, structuredClone(nextOrder));

      return {
        order: structuredClone(nextOrder),
        account,
        credited: false,
        receipt: structuredClone(receipt)
      };
    }
  }

  async purchaseShopProduct(playerId: string, input: ShopPurchaseMutationInput): Promise<ShopPurchaseResult> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const purchaseId = input.purchaseId.trim();
    const productId = input.productId.trim();
    const productName = input.productName.trim();
    const quantity = Math.max(1, Math.floor(input.quantity));
    const unitPrice = Math.max(0, Math.floor(input.unitPrice));
    if (!purchaseId) {
      throw new Error("purchaseId must not be empty");
    }
    if (!productId) {
      throw new Error("productId must not be empty");
    }
    if (!productName) {
      throw new Error("productName must not be empty");
    }
    if (!Number.isFinite(input.quantity) || quantity <= 0) {
      throw new Error("quantity must be a positive integer");
    }

    const purchaseKey = `${normalizedPlayerId}:${purchaseId}`;
    const existingPurchase = this.shopPurchases.get(purchaseKey);
    if (existingPurchase) {
      return structuredClone(existingPurchase);
    }

    const existingAccount = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const normalizedGrant = {
      gems: Math.max(0, Math.floor(input.grant.gems ?? 0)) * quantity,
      resources: {
        gold: Math.max(0, Math.floor(input.grant.resources?.gold ?? 0)) * quantity,
        wood: Math.max(0, Math.floor(input.grant.resources?.wood ?? 0)) * quantity,
        ore: Math.max(0, Math.floor(input.grant.resources?.ore ?? 0)) * quantity
      },
      seasonPassPremium: input.grant.seasonPassPremium === true,
      cosmeticIds: Array.from({ length: quantity }, () => input.grant.cosmeticIds ?? []).flat().map((cosmeticId) => {
        const normalizedCosmeticId = cosmeticId.trim();
        if (!normalizedCosmeticId || !resolveCosmeticCatalog().some((entry) => entry.id === normalizedCosmeticId)) {
          throw new Error(`unknown cosmetic grant: ${cosmeticId}`);
        }
        return normalizedCosmeticId;
      }),
      equipmentIds: Array.from({ length: quantity }, () => input.grant.equipmentIds ?? []).flat().map((equipmentId) => {
        const normalizedEquipmentId = equipmentId.trim();
        if (!normalizedEquipmentId || !getEquipmentDefinition(normalizedEquipmentId)) {
          throw new Error(`unknown equipment grant: ${equipmentId}`);
        }
        return normalizedEquipmentId;
      })
    };
    const totalPrice = unitPrice * quantity;
    if ((existingAccount.gems ?? 0) < totalPrice) {
      throw new Error("insufficient gems");
    }

    let heroId: string | undefined;
    let updatedArchive: PlayerHeroArchiveSnapshot | undefined;
    if (normalizedGrant.equipmentIds.length > 0) {
      const currentArchive = Array.from(this.heroArchives.values())
        .filter((archive) => archive.playerId === normalizedPlayerId)
        .sort((left, right) => left.heroId.localeCompare(right.heroId))[0];
      if (!currentArchive) {
        throw new Error("player hero archive not found");
      }

      let nextInventory = [...currentArchive.hero.loadout.inventory];
      for (const equipmentId of normalizedGrant.equipmentIds) {
        const inventoryUpdate = tryAddEquipmentToInventory(nextInventory, equipmentId);
        if (!inventoryUpdate.stored) {
          throw new Error("equipment inventory full");
        }
        nextInventory = inventoryUpdate.inventory;
      }

      heroId = currentArchive.heroId;
      updatedArchive = {
        ...cloneArchive(currentArchive),
        hero: {
          ...cloneArchive(currentArchive).hero,
          loadout: {
            ...cloneArchive(currentArchive).hero.loadout,
            inventory: nextInventory
          }
        }
      };
    }

    const processedAt = new Date().toISOString();
    const nextAccount: PlayerAccountSnapshot = {
      ...existingAccount,
      gems: (existingAccount.gems ?? 0) - totalPrice + normalizedGrant.gems,
      seasonPassPremium: existingAccount.seasonPassPremium === true || normalizedGrant.seasonPassPremium,
      cosmeticInventory: normalizeCosmeticInventory({
        ownedIds: [...(existingAccount.cosmeticInventory?.ownedIds ?? []), ...normalizedGrant.cosmeticIds]
      }),
      globalResources: normalizeResourceLedger({
        gold: (existingAccount.globalResources.gold ?? 0) + normalizedGrant.resources.gold,
        wood: (existingAccount.globalResources.wood ?? 0) + normalizedGrant.resources.wood,
        ore: (existingAccount.globalResources.ore ?? 0) + normalizedGrant.resources.ore
      }),
      recentEventLog: appendEventLogEntries(existingAccount.recentEventLog, [
        {
          id: `${normalizedPlayerId}:${processedAt}:shop:${productId}:${quantity}`,
          timestamp: processedAt,
          roomId: "shop",
          playerId: normalizedPlayerId,
          category: "account",
          description: `Purchased ${productName} x${quantity}.`,
          rewards: []
        }
      ]),
      updatedAt: processedAt
    };

    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    if (updatedArchive) {
      this.heroArchives.set(`${updatedArchive.playerId}:${updatedArchive.heroId}`, cloneArchive(updatedArchive));
    }

    const result: ShopPurchaseResult = {
      purchaseId,
      productId,
      quantity,
      unitPrice,
      totalPrice,
        granted: {
          gems: normalizedGrant.gems,
          resources: normalizedGrant.resources,
          equipmentIds: normalizedGrant.equipmentIds,
          cosmeticIds: normalizedGrant.cosmeticIds,
          ...(heroId ? { heroId } : {}),
          ...(normalizedGrant.seasonPassPremium ? { seasonPassPremium: true } : {})
        },
      gemsBalance: nextAccount.gems ?? 0,
      processedAt
    };
    this.shopPurchases.set(purchaseKey, structuredClone(result));
    return result;
  }

  async listPlayerBanHistory(
    playerId: string,
    options: PlayerAccountBanHistoryListOptions = {}
  ): Promise<PlayerBanHistoryRecord[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    return structuredClone((this.banHistoryByPlayerId.get(normalizedPlayerId) ?? []).slice(0, safeLimit));
  }

  async listPlayerPurchaseHistory(
    playerId: string,
    query: PlayerPurchaseHistoryQuery = {}
  ): Promise<PlayerPurchaseHistorySnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.floor(query.limit ?? 20));
    const safeOffset = Math.max(0, Math.floor(query.offset ?? 0));
    const normalizedItemId = query.itemId?.trim();
    const fromTimestamp = query.from ? normalizePurchaseHistoryDate(query.from, "from") : Number.NEGATIVE_INFINITY;
    const toTimestamp = query.to ? normalizePurchaseHistoryDate(query.to, "to") : Number.POSITIVE_INFINITY;
    if (fromTimestamp > toTimestamp) {
      throw new Error("from must be earlier than or equal to to");
    }

    const items: PlayerPurchaseHistoryRecord[] = [];
    for (const [key, purchase] of this.shopPurchases.entries()) {
      const [entryPlayerId] = key.split(":", 1);
      if (entryPlayerId !== normalizedPlayerId) {
        continue;
      }
      if (normalizedItemId && purchase.productId !== normalizedItemId) {
        continue;
      }
      const grantedAtTimestamp = new Date(purchase.processedAt).getTime();
      if (grantedAtTimestamp < fromTimestamp || grantedAtTimestamp > toTimestamp) {
        continue;
      }
      items.push({
        purchaseId: purchase.purchaseId,
        itemId: purchase.productId,
        quantity: purchase.quantity,
        currency: "gems",
        amount: purchase.totalPrice,
        paymentMethod: "gems",
        grantedAt: purchase.processedAt,
        status: "completed"
      });
    }

    items.sort(
      (left, right) =>
        right.grantedAt.localeCompare(left.grantedAt) || right.purchaseId.localeCompare(left.purchaseId)
    );
    return {
      items: structuredClone(items.slice(safeOffset, safeOffset + safeLimit)),
      total: items.length,
      limit: safeLimit,
      offset: safeOffset
    };
  }

  async appendPlayerCompensationRecord(
    playerId: string,
    input: PlayerCompensationCreateInput
  ): Promise<PlayerCompensationRecord> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const record: PlayerCompensationRecord = {
      auditId: randomUUID(),
      playerId: normalizedPlayerId,
      type: input.type,
      currency: input.currency,
      amount: Math.max(1, Math.floor(input.amount)),
      reason: input.reason.trim().slice(0, 512),
      previousBalance: Math.max(0, Math.floor(input.previousBalance)),
      balanceAfter: Math.max(0, Math.floor(input.balanceAfter)),
      createdAt: new Date(input.createdAt ?? Date.now()).toISOString()
    };
    const history = this.compensationHistoryByPlayerId.get(normalizedPlayerId) ?? [];
    history.unshift(record);
    this.compensationHistoryByPlayerId.set(normalizedPlayerId, history);
    return structuredClone(record);
  }

  async listPlayerCompensationHistory(
    playerId: string,
    options: PlayerCompensationListOptions = {}
  ): Promise<PlayerCompensationRecord[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    return structuredClone((this.compensationHistoryByPlayerId.get(normalizedPlayerId) ?? []).slice(0, safeLimit));
  }

  async appendAdminAuditLog(input: AdminAuditLogCreateInput): Promise<AdminAuditLogRecord> {
    const record: AdminAuditLogRecord = {
      auditId: randomUUID(),
      actorPlayerId: normalizePlayerId(input.actorPlayerId),
      actorRole: input.actorRole,
      action: input.action,
      ...(input.targetPlayerId?.trim() ? { targetPlayerId: normalizePlayerId(input.targetPlayerId) } : {}),
      ...(input.targetScope?.trim() ? { targetScope: input.targetScope.trim().slice(0, 191) } : {}),
      summary: input.summary.trim().slice(0, 255),
      ...(input.beforeJson?.trim() ? { beforeJson: input.beforeJson.trim() } : {}),
      ...(input.afterJson?.trim() ? { afterJson: input.afterJson.trim() } : {}),
      ...(input.metadataJson?.trim() ? { metadataJson: input.metadataJson.trim() } : {}),
      occurredAt: new Date(input.occurredAt ?? Date.now()).toISOString()
    };
    this.adminAuditLogs.push(record);
    return structuredClone(record);
  }

  async listAdminAuditLogs(options: AdminAuditLogListOptions = {}): Promise<AdminAuditLogRecord[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
    const sinceMs =
      options.since && !Number.isNaN(new Date(options.since).getTime()) ? new Date(options.since).getTime() : null;
    return this.adminAuditLogs
      .filter((entry) => !options.actorPlayerId || entry.actorPlayerId === normalizePlayerId(options.actorPlayerId))
      .filter((entry) => !options.actorRole || entry.actorRole === options.actorRole)
      .filter((entry) => !options.action || entry.action === options.action)
      .filter((entry) => !options.targetPlayerId || entry.targetPlayerId === normalizePlayerId(options.targetPlayerId))
      .filter((entry) => !options.targetScope || entry.targetScope === options.targetScope.trim())
      .filter((entry) => sinceMs === null || new Date(entry.occurredAt).getTime() >= sinceMs)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || right.auditId.localeCompare(left.auditId))
      .slice(0, safeLimit)
      .map((entry) => structuredClone(entry));
  }

  async savePlayerBan(playerId: string, input: PlayerAccountBanInput): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const banReason = input.banReason.trim();
    if (!banReason) {
      throw new Error("banReason must not be empty");
    }
    if (input.banStatus === "temporary") {
      if (!input.banExpiry) {
        throw new Error("temporary bans require banExpiry");
      }
      if (new Date(input.banExpiry).getTime() <= Date.now()) {
        throw new Error("banExpiry must be in the future");
      }
    }

    const account: PlayerAccountSnapshot = {
      ...existing,
      banStatus: input.banStatus,
      ...(input.banStatus === "temporary" && input.banExpiry ? { banExpiry: new Date(input.banExpiry).toISOString() } : {}),
      banReason,
      updatedAt: new Date().toISOString()
    };
    if (input.banStatus === "permanent") {
      delete account.banExpiry;
    }
    this.accounts.set(normalizedPlayerId, cloneAccount(account));
    const history = this.banHistoryByPlayerId.get(normalizedPlayerId) ?? [];
    history.unshift({
      id: (history[0]?.id ?? 0) + 1,
      playerId: normalizedPlayerId,
      action: "ban",
      banStatus: input.banStatus,
      ...(input.banStatus === "temporary" && input.banExpiry ? { banExpiry: new Date(input.banExpiry).toISOString() } : {}),
      banReason,
      createdAt: new Date().toISOString()
    });
    this.banHistoryByPlayerId.set(normalizedPlayerId, history);
    this.reserveBannedPlayerNames(
      normalizedPlayerId,
      Array.from(new Set([account.displayName, ...(await this.listPlayerNameHistory(normalizedPlayerId, { limit: 100 })).map((entry) => entry.displayName)]))
    );
    return cloneAccount(account);
  }

  async clearPlayerBan(playerId: string, input: PlayerAccountUnbanInput = {}): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      banStatus: "none",
      updatedAt: new Date().toISOString()
    };
    delete account.banExpiry;
    delete account.banReason;
    this.accounts.set(normalizedPlayerId, cloneAccount(account));
    const history = this.banHistoryByPlayerId.get(normalizedPlayerId) ?? [];
    history.unshift({
      id: (history[0]?.id ?? 0) + 1,
      playerId: normalizedPlayerId,
      action: "unban",
      banStatus: "none",
      ...(input.reason?.trim() ? { banReason: input.reason.trim() } : {}),
      createdAt: new Date().toISOString()
    });
    this.banHistoryByPlayerId.set(normalizedPlayerId, history);
    return cloneAccount(account);
  }

  async bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const normalizedLoginId = normalizeLoginId(input.loginId);
    const owner = await this.loadPlayerAccountByLoginId(normalizedLoginId);
    if (owner && owner.playerId !== normalizedPlayerId) {
      throw new Error("loginId is already taken");
    }

    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      loginId: normalizedLoginId,
      credentialBoundAt: existing.credentialBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    this.authByLoginId.set(normalizedLoginId, {
      playerId: normalizedPlayerId,
      displayName: nextAccount.displayName,
      loginId: normalizedLoginId,
      passwordHash: input.passwordHash,
      accountSessionVersion: existing.accountSessionVersion ?? 0,
      ...(nextAccount.credentialBoundAt ? { credentialBoundAt: nextAccount.credentialBoundAt } : {})
    });
    return cloneAccount(nextAccount);
  }

  async savePlayerAccountPrivacyConsent(
    playerId: string,
    input: { privacyConsentAt?: string } = {}
  ): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const privacyConsentAt = existing.privacyConsentAt ?? new Date(input.privacyConsentAt ?? Date.now()).toISOString();
    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      privacyConsentAt,
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    return cloneAccount(nextAccount);
  }

  async savePlayerAccountAuthSession(
    playerId: string,
    input: PlayerAccountAuthSessionInput
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.loadPlayerAccountAuthByPlayerId(normalizedPlayerId);
    if (!existing) {
      return null;
    }

    const nextAuth: PlayerAccountAuthSnapshot = {
      ...existing,
      refreshSessionId: normalizeSessionId(input.refreshSessionId),
      refreshTokenHash: input.refreshTokenHash.trim(),
      refreshTokenExpiresAt: new Date(input.refreshTokenExpiresAt).toISOString()
    };
    this.authByLoginId.set(existing.loginId, structuredClone(nextAuth));

    const existingSessions = this.authSessionsByPlayerId.get(normalizedPlayerId) ?? new Map<string, PlayerAccountDeviceSessionSnapshot>();
    existingSessions.set(nextAuth.refreshSessionId!, {
      playerId: normalizedPlayerId,
      sessionId: nextAuth.refreshSessionId!,
      provider: input.provider?.trim() || "account-password",
      deviceLabel: input.deviceLabel?.trim() || "Unknown device",
      refreshTokenHash: nextAuth.refreshTokenHash!,
      refreshTokenExpiresAt: nextAuth.refreshTokenExpiresAt!,
      createdAt: existingSessions.get(nextAuth.refreshSessionId!)?.createdAt ?? new Date().toISOString(),
      lastUsedAt: input.lastUsedAt ? new Date(input.lastUsedAt).toISOString() : new Date().toISOString()
    });
    this.authSessionsByPlayerId.set(normalizedPlayerId, existingSessions);

    const account = this.accounts.get(normalizedPlayerId);
    if (account) {
      this.accounts.set(normalizedPlayerId, {
        ...cloneAccount(account),
        accountSessionVersion: nextAuth.accountSessionVersion,
        ...(nextAuth.refreshSessionId ? { refreshSessionId: nextAuth.refreshSessionId } : {}),
        ...(nextAuth.refreshTokenExpiresAt ? { refreshTokenExpiresAt: nextAuth.refreshTokenExpiresAt } : {}),
        updatedAt: new Date().toISOString()
      });
    }

    return structuredClone(nextAuth);
  }

  async loadPlayerAccountAuthSession(
    playerId: string,
    sessionId: string
  ): Promise<PlayerAccountDeviceSessionSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedSessionId = normalizeSessionId(sessionId);
    const session = this.authSessionsByPlayerId.get(normalizedPlayerId)?.get(normalizedSessionId) ?? null;
    return session ? structuredClone(session) : null;
  }

  async listPlayerAccountAuthSessions(playerId: string): Promise<PlayerAccountDeviceSessionSnapshot[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    return Array.from(this.authSessionsByPlayerId.get(normalizedPlayerId)?.values() ?? [])
      .sort((left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt) || right.createdAt.localeCompare(left.createdAt))
      .map((session) => structuredClone(session));
  }

  async touchPlayerAccountAuthSession(playerId: string, sessionId: string, lastUsedAt?: string): Promise<void> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedSessionId = normalizeSessionId(sessionId);
    const sessions = this.authSessionsByPlayerId.get(normalizedPlayerId);
    const existing = sessions?.get(normalizedSessionId);
    if (!existing || !sessions) {
      return;
    }

    sessions.set(normalizedSessionId, {
      ...structuredClone(existing),
      lastUsedAt: lastUsedAt ? new Date(lastUsedAt).toISOString() : new Date().toISOString()
    });
  }

  async revokePlayerAccountAuthSession(playerId: string, sessionId: string): Promise<boolean> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedSessionId = normalizeSessionId(sessionId);
    return this.authSessionsByPlayerId.get(normalizedPlayerId)?.delete(normalizedSessionId) ?? false;
  }

  async revokePlayerAccountAuthSessions(
    playerId: string,
    input: PlayerAccountAuthRevokeInput = {}
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.loadPlayerAccountAuthByPlayerId(normalizedPlayerId);
    if (!existing) {
      return null;
    }

    const nextCredentialBoundAt =
      input.credentialBoundAt !== undefined ? new Date(input.credentialBoundAt).toISOString() : existing.credentialBoundAt;
    const nextAuth: PlayerAccountAuthSnapshot = {
      ...existing,
      ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
      ...(nextCredentialBoundAt ? { credentialBoundAt: nextCredentialBoundAt } : {}),
      accountSessionVersion: existing.accountSessionVersion + 1
    };
    delete nextAuth.refreshSessionId;
    delete nextAuth.refreshTokenHash;
    delete nextAuth.refreshTokenExpiresAt;
    this.authByLoginId.set(existing.loginId, structuredClone(nextAuth));
    this.authSessionsByPlayerId.delete(normalizedPlayerId);

    const account = this.accounts.get(normalizedPlayerId);
    if (account) {
      const nextAccount: PlayerAccountSnapshot = {
        ...cloneAccount(account),
        ...(nextCredentialBoundAt ? { credentialBoundAt: nextCredentialBoundAt } : {}),
        accountSessionVersion: nextAuth.accountSessionVersion,
        updatedAt: new Date().toISOString()
      };
      delete nextAccount.refreshSessionId;
      delete nextAccount.refreshTokenExpiresAt;
      this.accounts.set(normalizedPlayerId, nextAccount);
    }

    return structuredClone(nextAuth);
  }

  async bindPlayerAccountWechatMiniGameIdentity(
    playerId: string,
    input: PlayerAccountWechatMiniGameIdentityInput
  ): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedOpenId = input.openId.trim();
    if (!normalizedOpenId) {
      throw new Error("wechatMiniGameOpenId must not be empty");
    }

    const existing = await this.ensurePlayerAccount({
      playerId: normalizedPlayerId,
      ...(input.displayName?.trim() ? { displayName: input.displayName } : {})
    });
    if (existing.wechatMiniGameOpenId && existing.wechatMiniGameOpenId !== normalizedOpenId) {
      throw new Error("wechatMiniGameOpenId is already bound to another identity");
    }

    const owner = await this.loadPlayerAccountByWechatMiniGameOpenId(normalizedOpenId);
    if (owner && owner.playerId !== normalizedPlayerId) {
      throw new Error("wechatMiniGameOpenId is already taken");
    }

    const nextDisplayName = input.displayName?.trim()
      ? normalizeDisplayName(normalizedPlayerId, input.displayName)
      : existing.displayName;
    if (nextDisplayName !== existing.displayName) {
      await assertDisplayNameAvailableOrThrow(this, nextDisplayName, normalizedPlayerId);
    }
    const normalizedAvatarUrl = normalizeAvatarUrl(input.avatarUrl);
    const normalizedUnionId = input.unionId?.trim() || existing.wechatMiniGameUnionId;

    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      displayName: nextDisplayName,
      ...(normalizedAvatarUrl ? { avatarUrl: normalizedAvatarUrl } : existing.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      wechatMiniGameOpenId: normalizedOpenId,
      ...(normalizedUnionId ? { wechatMiniGameUnionId: normalizedUnionId } : {}),
      ...(input.ageVerified !== undefined ? { ageVerified: input.ageVerified } : existing.ageVerified ? { ageVerified: existing.ageVerified } : {}),
      ...(input.isMinor !== undefined ? { isMinor: input.isMinor } : existing.isMinor ? { isMinor: existing.isMinor } : {}),
      wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    delete nextAccount.guestMigratedToPlayerId;
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    if (nextDisplayName !== existing.displayName) {
      this.appendPlayerNameHistory(normalizedPlayerId, nextDisplayName, nextAccount.updatedAt);
    }
    this.playerIdByWechatOpenId.set(normalizedOpenId, normalizedPlayerId);
    if (nextAccount.loginId) {
      const auth = this.authByLoginId.get(nextAccount.loginId);
      if (auth) {
        this.authByLoginId.set(nextAccount.loginId, {
          ...auth,
          displayName: nextAccount.displayName
        });
      }
    }
    return cloneAccount(nextAccount);
  }

  async migrateGuestToRegistered(input: GuestAccountMigrationInput): Promise<GuestAccountMigrationResult> {
    const guestPlayerId = normalizePlayerId(input.guestPlayerId);
    const targetPlayerId = normalizePlayerId(input.targetPlayerId);
    const guestAccount = await this.ensurePlayerAccount({ playerId: guestPlayerId });
    const targetAccount = await this.ensurePlayerAccount({ playerId: targetPlayerId });
    const progressSource = input.progressSource === "target" ? targetAccount : guestAccount;
    const nextTarget: PlayerAccountSnapshot = {
      ...cloneAccount(targetAccount),
      ...cloneAccount(progressSource),
      playerId: targetPlayerId,
      displayName: input.wechatIdentity.displayName?.trim() || progressSource.displayName,
      ...(input.wechatIdentity.avatarUrl?.trim()
        ? { avatarUrl: input.wechatIdentity.avatarUrl.trim() }
        : progressSource.avatarUrl
          ? { avatarUrl: progressSource.avatarUrl }
          : targetAccount.avatarUrl
            ? { avatarUrl: targetAccount.avatarUrl }
            : {}),
      ...(targetAccount.loginId ? { loginId: targetAccount.loginId } : {}),
      ...(targetAccount.credentialBoundAt ? { credentialBoundAt: targetAccount.credentialBoundAt } : {}),
      ...(targetAccount.phoneNumber ? { phoneNumber: targetAccount.phoneNumber } : {}),
      ...(targetAccount.phoneNumberBoundAt ? { phoneNumberBoundAt: targetAccount.phoneNumberBoundAt } : {}),
      ...(targetAccount.accountSessionVersion !== undefined ? { accountSessionVersion: targetAccount.accountSessionVersion } : {}),
      wechatMiniGameOpenId: input.wechatIdentity.openId.trim(),
      ...(input.wechatIdentity.unionId?.trim()
        ? { wechatMiniGameUnionId: input.wechatIdentity.unionId.trim() }
        : targetAccount.wechatMiniGameUnionId
          ? { wechatMiniGameUnionId: targetAccount.wechatMiniGameUnionId }
          : {}),
      ...(input.wechatIdentity.ageVerified !== undefined
        ? { ageVerified: input.wechatIdentity.ageVerified }
        : progressSource.ageVerified !== undefined
          ? { ageVerified: progressSource.ageVerified }
          : {}),
      ...(input.wechatIdentity.isMinor !== undefined
        ? { isMinor: input.wechatIdentity.isMinor }
        : progressSource.isMinor !== undefined
          ? { isMinor: progressSource.isMinor }
          : {}),
      wechatMiniGameBoundAt: targetAccount.wechatMiniGameBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    delete nextTarget.guestMigratedToPlayerId;
    this.accounts.set(targetPlayerId, cloneAccount(nextTarget));
    this.playerIdByWechatOpenId.set(nextTarget.wechatMiniGameOpenId!, targetPlayerId);

    if (input.progressSource === "guest") {
      const guestArchives = await this.loadPlayerHeroArchives([guestPlayerId]);
      for (const key of Array.from(this.heroArchives.keys())) {
        if (key.startsWith(`${targetPlayerId}:`) || key.startsWith(`${guestPlayerId}:`)) {
          this.heroArchives.delete(key);
        }
      }
      for (const archive of guestArchives) {
        this.heroArchives.set(`${targetPlayerId}:${archive.heroId}`, {
          ...cloneArchive(archive),
          playerId: targetPlayerId,
          hero: {
            ...structuredClone(archive.hero),
            playerId: targetPlayerId
          }
        });
      }
      const guestQuestState = await this.loadPlayerQuestState(guestPlayerId);
      this.playerQuestStates.delete(targetPlayerId);
      this.playerQuestStates.delete(guestPlayerId);
      if (guestQuestState) {
        this.playerQuestStates.set(targetPlayerId, {
          ...structuredClone(guestQuestState),
          playerId: targetPlayerId
        });
      }
    } else {
      for (const key of Array.from(this.heroArchives.keys())) {
        if (key.startsWith(`${guestPlayerId}:`)) {
          this.heroArchives.delete(key);
        }
      }
      this.playerQuestStates.delete(guestPlayerId);
    }

    const migratedGuest: PlayerAccountSnapshot = {
      ...cloneAccount(guestAccount),
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentBattleReplays: [],
      gems: 0,
      seasonXp: 0,
      loginStreak: 0,
      guestMigratedToPlayerId: targetPlayerId,
      updatedAt: new Date().toISOString()
    };
    delete migratedGuest.wechatMiniGameOpenId;
    delete migratedGuest.wechatMiniGameUnionId;
    delete migratedGuest.wechatMiniGameBoundAt;
    delete migratedGuest.loginId;
    delete migratedGuest.credentialBoundAt;
    delete migratedGuest.phoneNumber;
    delete migratedGuest.phoneNumberBoundAt;
    this.accounts.set(guestPlayerId, cloneAccount(migratedGuest));

    return {
      account: cloneAccount(nextTarget),
      guestAccount: cloneAccount(migratedGuest)
    };
  }

  async deletePlayerAccount(
    playerId: string,
    input: { deletedAt?: string } = {}
  ): Promise<PlayerAccountSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.loadPlayerAccount(normalizedPlayerId);
    if (!existing) {
      return null;
    }

    if (existing.loginId) {
      this.authByLoginId.delete(existing.loginId);
    }
    if (existing.wechatMiniGameOpenId) {
      this.playerIdByWechatOpenId.delete(existing.wechatMiniGameOpenId);
    }
    this.authSessionsByPlayerId.delete(normalizedPlayerId);
    this.playerQuestStates.delete(normalizedPlayerId);
    this.compensationHistoryByPlayerId.delete(normalizedPlayerId);
    this.guildIdByPlayerId.delete(normalizedPlayerId);
    for (const [key, snapshot] of Array.from(this.battleSnapshots.entries())) {
      if (snapshot.attackerPlayerId === normalizedPlayerId || snapshot.defenderPlayerId === normalizedPlayerId) {
        this.battleSnapshots.delete(key);
      }
    }
    for (const key of Array.from(this.shopPurchases.keys())) {
      if (key.startsWith(`${normalizedPlayerId}:`)) {
        this.shopPurchases.delete(key);
      }
    }
    for (const [reportId, report] of Array.from(this.reports.entries())) {
      if (report.reporterId === normalizedPlayerId || report.targetId === normalizedPlayerId) {
        this.reports.delete(reportId);
      }
    }
    for (const referral of Array.from(this.referrals)) {
      if (referral.includes(`:${normalizedPlayerId}:`) || referral.endsWith(`:${normalizedPlayerId}`)) {
        this.referrals.delete(referral);
      }
    }
    for (const key of Array.from(this.seasonRewardLog.keys())) {
      if (key.endsWith(`:${normalizedPlayerId}`)) {
        this.seasonRewardLog.delete(key);
      }
    }
    for (const key of Array.from(this.heroArchives.keys())) {
      if (key.startsWith(`${normalizedPlayerId}:`)) {
        this.heroArchives.delete(key);
      }
    }

    const deletedAt = new Date(input.deletedAt ?? Date.now()).toISOString();
    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      displayName: `deleted-${normalizedPlayerId}`,
      seasonHistory: [],
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentEventLog: [],
      recentBattleReplays: [],
      seasonXp: 0,
      seasonPassTier: 1,
      seasonPassPremium: false,
      seasonPassClaimedTiers: [],
      seasonBadges: [],
      cosmeticInventory: { ownedIds: [] },
      equippedCosmetics: {},
      leaderboardModerationState: {
        hiddenAt: deletedAt,
        hiddenByPlayerId: "system:gdpr-delete"
      },
      tutorialStep: DEFAULT_TUTORIAL_STEP,
      banStatus: "none",
      accountSessionVersion: (existing.accountSessionVersion ?? 0) + 1,
      updatedAt: deletedAt
    };
    delete nextAccount.avatarUrl;
    delete nextAccount.eloRating;
    delete nextAccount.rankDivision;
    delete nextAccount.peakRankDivision;
    delete nextAccount.promotionSeries;
    delete nextAccount.demotionShield;
    delete nextAccount.rankedWeeklyProgress;
    delete nextAccount.campaignProgress;
    delete nextAccount.seasonalEventStates;
    delete nextAccount.mailbox;
    delete nextAccount.dailyDungeonState;
    delete nextAccount.leaderboardAbuseState;
    delete nextAccount.lastSeenAt;
    delete nextAccount.lastRoomId;
    delete nextAccount.loginId;
    delete nextAccount.credentialBoundAt;
    delete nextAccount.privacyConsentAt;
    delete nextAccount.ageVerified;
    delete nextAccount.isMinor;
    delete nextAccount.dailyPlayMinutes;
    delete nextAccount.lastPlayDate;
    delete nextAccount.banExpiry;
    delete nextAccount.banReason;
    delete nextAccount.phoneNumber;
    delete nextAccount.phoneNumberBoundAt;
    delete nextAccount.notificationPreferences;
    delete nextAccount.refreshSessionId;
    delete nextAccount.refreshTokenExpiresAt;
    delete nextAccount.wechatMiniGameOpenId;
    delete nextAccount.wechatMiniGameUnionId;
    delete nextAccount.wechatMiniGameBoundAt;
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    for (const [ticketId, ticket] of this.supportTickets.entries()) {
      if (ticket.playerId === normalizedPlayerId) {
        this.supportTickets.delete(ticketId);
      }
    }
    return cloneAccount(nextAccount);
  }

  async resolvePlayerReport(reportId: string, input: PlayerReportResolveInput): Promise<PlayerReportRecord | null> {
    const normalizedReportId = reportId.trim();
    if (!normalizedReportId) {
      throw new Error("reportId must not be empty");
    }

    const existing = this.reports.get(normalizedReportId);
    if (!existing) {
      return null;
    }

    const next: PlayerReportRecord = {
      ...existing,
      status: input.status,
      resolvedAt: new Date().toISOString()
    };
    this.reports.set(normalizedReportId, structuredClone(next));
    return structuredClone(next);
  }

  async resolveSupportTicket(ticketId: string, input: SupportTicketResolveInput): Promise<SupportTicketRecord | null> {
    const normalizedTicketId = ticketId.trim();
    if (!normalizedTicketId) {
      throw new Error("ticketId must not be empty");
    }

    const existing = this.supportTickets.get(normalizedTicketId);
    if (!existing) {
      return null;
    }

    if (input.status !== "resolved" && input.status !== "dismissed") {
      throw new Error("resolved support ticket status must not be open");
    }

    const resolution = input.resolution.trim();
    if (!resolution) {
      throw new Error("support ticket resolution must not be empty");
    }

    const resolvedAt = new Date().toISOString();
    const next: SupportTicketRecord = {
      ...existing,
      status: input.status,
      handlerId: normalizePlayerId(input.handlerId),
      resolution: resolution.slice(0, 2_000),
      resolvedAt,
      updatedAt: resolvedAt
    };
    this.supportTickets.set(normalizedTicketId, structuredClone(next));
    return structuredClone(next);
  }

  async savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const nextPushTokens =
      patch.pushTokens !== undefined
        ? patch.pushTokens?.length
          ? normalizeMobilePushTokenRegistrations(patch.pushTokens)
          : undefined
        : existing.pushTokens
          ? normalizeMobilePushTokenRegistrations(existing.pushTokens)
          : undefined;
    const normalizedAvatarUrl =
      patch.avatarUrl !== undefined ? normalizeAvatarUrl(patch.avatarUrl) : existing.avatarUrl;
    const nextDisplayName =
      patch.displayName !== undefined ? normalizeDisplayName(normalizedPlayerId, patch.displayName) : existing.displayName;
    if (nextDisplayName !== existing.displayName) {
      await assertDisplayNameAvailableOrThrow(this, nextDisplayName, normalizedPlayerId);
    }
    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      displayName: nextDisplayName,
      ...(normalizedAvatarUrl ? { avatarUrl: normalizedAvatarUrl } : {}),
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId?.trim()
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      ...(patch.notificationPreferences !== undefined
        ? patch.notificationPreferences
          ? { notificationPreferences: structuredClone(patch.notificationPreferences) }
          : {}
        : existing.notificationPreferences
          ? { notificationPreferences: structuredClone(existing.notificationPreferences) }
          : {}),
      ...(nextPushTokens ? { pushTokens: nextPushTokens } : {}),
      updatedAt: new Date().toISOString()
    };
    if (patch.pushTokens !== undefined && !nextPushTokens) {
      delete nextAccount.pushTokens;
    }
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    if (nextDisplayName !== existing.displayName) {
      this.appendPlayerNameHistory(normalizedPlayerId, nextDisplayName, nextAccount.updatedAt);
    }
    if (nextAccount.loginId) {
      const auth = this.authByLoginId.get(nextAccount.loginId);
      if (auth) {
        this.authByLoginId.set(nextAccount.loginId, {
          ...auth,
          displayName: nextAccount.displayName
        });
      }
    }
    return cloneAccount(nextAccount);
  }

  async savePlayerAccountProgress(playerId: string, patch: PlayerAccountProgressPatch): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const battlePassConfig = resolveBattlePassConfig();
    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const battlePassProgress = applyBattlePassXp(battlePassConfig, existing, patch.seasonXpDelta ?? 0);
    const mergedReplays = structuredClone(
      (patch.recentBattleReplays as PlayerAccountSnapshot["recentBattleReplays"] | undefined) ??
        existing.recentBattleReplays ??
        []
    );
    const competitiveProgression = resolveCompetitiveProgression(
      existing,
      patch,
      mergedReplays,
      patch.eloRating ?? existing.eloRating ?? 1000
    );
    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      ...(patch.gems !== undefined ? { gems: Math.max(0, Math.floor(patch.gems)) } : {}),
      seasonXp: battlePassProgress.seasonXp,
      seasonPassTier: battlePassProgress.seasonPassTier,
      ...(patch.seasonPassPremium !== undefined
        ? { seasonPassPremium: patch.seasonPassPremium === true }
        : existing.seasonPassPremium
          ? { seasonPassPremium: true }
          : {}),
      cosmeticInventory: structuredClone((patch.cosmeticInventory as PlayerAccountSnapshot["cosmeticInventory"]) ?? existing.cosmeticInventory ?? { ownedIds: [] }),
      equippedCosmetics: structuredClone((patch.equippedCosmetics as PlayerAccountSnapshot["equippedCosmetics"]) ?? existing.equippedCosmetics ?? {}),
      seasonPassClaimedTiers: structuredClone(
        (patch.seasonPassClaimedTiers as number[] | undefined) ?? existing.seasonPassClaimedTiers ?? []
      ),
      seasonBadges: structuredClone((patch.seasonBadges as string[] | undefined) ?? existing.seasonBadges ?? []),
      ...(patch.campaignProgress !== undefined
        ? patch.campaignProgress
          ? { campaignProgress: structuredClone(patch.campaignProgress) }
          : {}
        : existing.campaignProgress
          ? { campaignProgress: structuredClone(existing.campaignProgress) }
          : {}),
      ...(patch.mailbox !== undefined
        ? patch.mailbox
          ? { mailbox: structuredClone(patch.mailbox) }
          : {}
        : existing.mailbox
          ? { mailbox: structuredClone(existing.mailbox) }
          : {}),
      globalResources: structuredClone(
        (patch.globalResources as PlayerAccountSnapshot["globalResources"] | undefined) ?? existing.globalResources
      ),
      achievements: structuredClone((patch.achievements as PlayerAccountSnapshot["achievements"] | undefined) ?? existing.achievements),
      recentEventLog: structuredClone((patch.recentEventLog as PlayerAccountSnapshot["recentEventLog"] | undefined) ?? existing.recentEventLog),
      recentBattleReplays: mergedReplays,
      ...((patch.rankDivision ?? competitiveProgression.rankDivision)
        ? { rankDivision: (patch.rankDivision ?? competitiveProgression.rankDivision)! }
        : {}),
      ...((patch.peakRankDivision ?? competitiveProgression.peakRankDivision)
        ? { peakRankDivision: (patch.peakRankDivision ?? competitiveProgression.peakRankDivision)! }
        : {}),
      ...(patch.promotionSeries !== undefined
        ? patch.promotionSeries
          ? { promotionSeries: structuredClone(patch.promotionSeries) }
          : {}
        : competitiveProgression.promotionSeries
          ? { promotionSeries: structuredClone(competitiveProgression.promotionSeries) }
          : {}),
      ...(patch.demotionShield !== undefined
        ? patch.demotionShield
          ? { demotionShield: structuredClone(patch.demotionShield) }
          : {}
        : competitiveProgression.demotionShield
          ? { demotionShield: structuredClone(competitiveProgression.demotionShield) }
          : {}),
      seasonHistory: structuredClone((patch.seasonHistory as PlayerAccountSnapshot["seasonHistory"] | undefined) ?? existing.seasonHistory ?? []),
      ...(patch.rankedWeeklyProgress !== undefined
        ? patch.rankedWeeklyProgress
          ? { rankedWeeklyProgress: structuredClone(patch.rankedWeeklyProgress) }
          : {}
        : { rankedWeeklyProgress: structuredClone(competitiveProgression.rankedWeeklyProgress) }),
      ...(patch.dailyDungeonState !== undefined
        ? patch.dailyDungeonState
          ? { dailyDungeonState: structuredClone(patch.dailyDungeonState) }
          : {}
        : existing.dailyDungeonState
          ? { dailyDungeonState: structuredClone(existing.dailyDungeonState) }
          : {}),
      ...(patch.seasonalEventStates !== undefined
        ? patch.seasonalEventStates
          ? { seasonalEventStates: structuredClone(patch.seasonalEventStates) }
          : {}
        : existing.seasonalEventStates
          ? { seasonalEventStates: structuredClone(existing.seasonalEventStates) }
          : {}),
      ...(patch.leaderboardAbuseState !== undefined
        ? patch.leaderboardAbuseState
          ? { leaderboardAbuseState: structuredClone(patch.leaderboardAbuseState) }
          : {}
        : existing.leaderboardAbuseState
          ? { leaderboardAbuseState: structuredClone(existing.leaderboardAbuseState) }
          : {}),
      ...(patch.leaderboardModerationState !== undefined
        ? patch.leaderboardModerationState
          ? { leaderboardModerationState: structuredClone(patch.leaderboardModerationState) }
          : {}
        : existing.leaderboardModerationState
          ? { leaderboardModerationState: structuredClone(existing.leaderboardModerationState) }
          : {}),
      ...(patch.tutorialStep !== undefined
        ? { tutorialStep: patch.tutorialStep }
        : existing.tutorialStep !== undefined
          ? { tutorialStep: existing.tutorialStep }
          : {}),
      ...(patch.dailyPlayMinutes !== undefined ? { dailyPlayMinutes: Math.max(0, Math.floor(patch.dailyPlayMinutes ?? 0)) } : existing.dailyPlayMinutes ? { dailyPlayMinutes: existing.dailyPlayMinutes } : {}),
      ...(patch.lastPlayDate !== undefined ? (patch.lastPlayDate ? { lastPlayDate: patch.lastPlayDate.trim() } : {}) : existing.lastPlayDate ? { lastPlayDate: existing.lastPlayDate } : {}),
      ...(patch.eloRating !== undefined ? { eloRating: patch.eloRating } : {}),
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId?.trim()
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
    return cloneAccount(nextAccount);
  }

  async savePlayerQuestState(playerId: string, state: PlayerQuestState): Promise<PlayerQuestState> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const nextState: PlayerQuestState = {
      ...structuredClone(state),
      playerId: normalizedPlayerId
    };
    this.playerQuestStates.set(normalizedPlayerId, nextState);
    return structuredClone(nextState);
  }

  async claimBattlePassTier(playerId: string, tier: number) {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedTier = Math.max(1, Math.floor(tier));
    const config = resolveBattlePassConfig();
    const tierConfig = resolveBattlePassTier(config, normalizedTier);
    if (!tierConfig) {
      throw new Error("battle_pass_tier_not_found");
    }

    const account = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    if ((account.seasonPassTier ?? 1) < normalizedTier) {
      throw new Error("battle_pass_tier_locked");
    }
    if ((account.seasonPassClaimedTiers ?? []).includes(normalizedTier)) {
      throw new Error("battle_pass_tier_already_claimed");
    }

    const granted = toBattlePassRewardGrant(
      tierConfig.freeReward,
      account.seasonPassPremium ? tierConfig.premiumReward : undefined
    );

    let heroId: string | undefined;
    if (granted.equipmentIds.length > 0) {
      const currentArchive = Array.from(this.heroArchives.values())
        .filter((archive) => archive.playerId === normalizedPlayerId)
        .sort((left, right) => left.heroId.localeCompare(right.heroId))[0];
      if (!currentArchive) {
        throw new Error("player hero archive not found");
      }

      let nextInventory = [...currentArchive.hero.loadout.inventory];
      for (const equipmentId of granted.equipmentIds) {
        const inventoryUpdate = tryAddEquipmentToInventory(nextInventory, equipmentId);
        if (!inventoryUpdate.stored) {
          throw new Error("equipment inventory full");
        }
        nextInventory = inventoryUpdate.inventory;
      }

      heroId = currentArchive.heroId;
      this.heroArchives.set(`${currentArchive.playerId}:${currentArchive.heroId}`, {
        ...cloneArchive(currentArchive),
        hero: {
          ...cloneArchive(currentArchive).hero,
          loadout: {
            ...cloneArchive(currentArchive).hero.loadout,
            inventory: nextInventory
          }
        }
      });
    }

    const nextAccount: PlayerAccountSnapshot = {
      ...account,
      gems: (account.gems ?? 0) + granted.gems,
      seasonPassClaimedTiers: [...(account.seasonPassClaimedTiers ?? []), normalizedTier].sort((a, b) => a - b),
      globalResources: normalizeResourceLedger({
        gold: (account.globalResources.gold ?? 0) + granted.resources.gold,
        wood: account.globalResources.wood ?? 0,
        ore: account.globalResources.ore ?? 0
      }),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));

    return {
      tier: normalizedTier,
      granted: {
        ...granted,
        equipmentIds: [...granted.equipmentIds]
      },
      seasonPassPremiumApplied: account.seasonPassPremium === true,
      account: cloneAccount(this.accounts.get(normalizedPlayerId) ?? nextAccount),
      ...(heroId ? { heroId } : {})
    };
  }

  async listPlayerAccounts(options: PlayerAccountListOptions = {}): Promise<PlayerAccountSnapshot[]> {
    const filtered = Array.from(this.accounts.values())
      .filter((account) => (options.playerId ? account.playerId === options.playerId : true))
      .sort((left, right) =>
        options.orderBy === "eloRating"
          ? (right.eloRating ?? 0) - (left.eloRating ?? 0)
          : String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""))
      );
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
    return filtered.slice(safeOffset, safeOffset + safeLimit).map((account) => cloneAccount(account));
  }

  async save(roomId: string, snapshot: RoomPersistenceSnapshot): Promise<void> {
    this.snapshots.set(roomId, structuredClone(snapshot));
    for (const account of createPlayerAccountsFromWorldState(snapshot.state)) {
      const previous = this.accounts.get(account.playerId);
      this.accounts.set(account.playerId, {
        ...(previous ? cloneAccount(previous) : cloneAccount(account)),
        playerId: account.playerId,
        displayName: previous?.displayName ?? account.displayName,
        globalResources: structuredClone(account.globalResources),
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      if (previous?.wechatMiniGameOpenId) {
        this.playerIdByWechatOpenId.set(previous.wechatMiniGameOpenId, account.playerId);
      }
    }
    for (const hero of snapshot.state.heroes) {
      this.heroArchives.set(`${hero.playerId}:${hero.id}`, {
        playerId: hero.playerId,
        heroId: hero.id,
        hero: structuredClone(hero)
      });
    }
  }

  async saveGuild(guildInput: GuildState): Promise<GuildState> {
    const guild = normalizeGuildState(guildInput);
    const existing = this.guilds.get(guild.id);
    if (existing) {
      for (const member of existing.members) {
        this.guildIdByPlayerId.delete(member.playerId);
      }
    }

    this.guilds.set(guild.id, normalizeGuildState(structuredClone(guild)));
    for (const member of guild.members) {
      this.guildIdByPlayerId.set(member.playerId, guild.id);
    }

    return normalizeGuildState(structuredClone(guild));
  }

  async delete(roomId: string): Promise<void> {
    this.snapshots.delete(roomId);
  }

  async deleteGuild(guildId: string): Promise<void> {
    const normalizedGuildId = guildId.trim();
    const existing = this.guilds.get(normalizedGuildId);
    if (!existing) {
      return;
    }

    for (const member of existing.members) {
      this.guildIdByPlayerId.delete(member.playerId);
    }
    this.guilds.delete(normalizedGuildId);
    this.guildMessages.delete(normalizedGuildId);
  }

  async pruneExpired(): Promise<number> {
    let removedCount = 0;
    const now = new Date();
    for (const [playerId, account] of this.accounts.entries()) {
      const pruned = pruneExpiredPlayerMailboxMessages(account.mailbox, now);
      if (pruned.removedCount === 0) {
        continue;
      }
      removedCount += pruned.removedCount;
      this.accounts.set(
        playerId,
        cloneAccount({
          ...account,
          mailbox: pruned.mailbox,
          updatedAt: now.toISOString()
        })
      );
    }

    for (const [guildId, messages] of this.guildMessages.entries()) {
      const nextMessages = messages.filter((message) => new Date(message.expiresAt).getTime() > now.getTime());
      removedCount += messages.length - nextMessages.length;
      if (nextMessages.length === 0) {
        this.guildMessages.delete(guildId);
      } else if (nextMessages.length !== messages.length) {
        this.guildMessages.set(
          guildId,
          nextMessages.map((message) => structuredClone(message))
        );
      }
    }
    return removedCount;
  }

  async getCurrentSeason(): Promise<import("./persistence").SeasonSnapshot | null> {
    return this.selectSeasons({ status: "active", limit: 1 })[0] ?? null;
  }

  async listSeasons(options: SeasonListOptions = {}): Promise<SeasonSnapshot[]> {
    return this.selectSeasons(options);
  }

  async listLeaderboardSeasonArchive(seasonId: string, limit = 100): Promise<LeaderboardSeasonArchiveEntry[]> {
    const normalizedSeasonId = seasonId.trim();
    if (!normalizedSeasonId) {
      throw new Error("seasonId must not be empty");
    }

    return (this.leaderboardSeasonArchives.get(normalizedSeasonId) ?? [])
      .slice(0, Math.min(100, Math.max(1, Math.floor(limit))))
      .map((entry) => structuredClone(entry));
  }

  async createSeason(seasonId: string): Promise<import("./persistence").SeasonSnapshot> {
    const season: SeasonSnapshot = {
      seasonId: seasonId.trim(),
      status: "active",
      startedAt: new Date().toISOString()
    };
    this.seasons.set(season.seasonId, structuredClone(season));
    return structuredClone(season);
  }

  async closeSeason(seasonId: string): Promise<SeasonCloseSummary> {
    const normalizedSeasonId = seasonId.trim();
    const existing = this.seasons.get(normalizedSeasonId);
    if (!existing) {
      return {
        seasonId: normalizedSeasonId,
        playersRewarded: 0,
        totalGemsGranted: 0
      };
    }
    if (existing.status === "closed" && existing.rewardDistributedAt) {
      return {
        seasonId: normalizedSeasonId,
        playersRewarded: 0,
        totalGemsGranted: 0
      };
    }

    const rewardConfig = resolveSeasonRewardConfig();
    const rankedAccounts = Array.from(this.accounts.values())
      .filter((account) => account.eloRating != null)
      .sort(
        (left, right) =>
          normalizeEloRating(right.eloRating) - normalizeEloRating(left.eloRating) ||
          left.playerId.localeCompare(right.playerId)
      );

    const distributedAt = new Date().toISOString();
    if (!this.leaderboardSeasonArchives.has(normalizedSeasonId)) {
      this.leaderboardSeasonArchives.set(
        normalizedSeasonId,
        rankedAccounts.slice(0, 100).map((account, index) => ({
          seasonId: normalizedSeasonId,
          rank: index + 1,
          playerId: account.playerId,
          displayName: account.displayName,
          finalRating: normalizeEloRating(account.eloRating),
          tier: getTierForRating(normalizeEloRating(account.eloRating)),
          archivedAt: distributedAt
        }))
      );
    }
    let playersRewarded = 0;
    let totalGemsGranted = 0;
    const rewardedPlayerIds = new Set<string>();
    for (const [index, account] of rankedAccounts.entries()) {
      const reward = computeSeasonReward(index + 1, rankedAccounts.length, rewardConfig);
      if (!reward) {
        continue;
      }
      const rewardLogKey = `${normalizedSeasonId}:${account.playerId}`;
      if (this.seasonRewardLog.has(rewardLogKey)) {
        continue;
      }
      this.seasonRewardLog.set(rewardLogKey, {
        gems: reward.gems,
        badge: reward.badge,
        distributedAt
      });
      await this.savePlayerAccountProgress(account.playerId, {
        gems: (account.gems ?? 0) + reward.gems,
        seasonBadges: Array.from(new Set([...(account.seasonBadges ?? []), reward.badge]))
      });
      playersRewarded += 1;
      totalGemsGranted += reward.gems;
      rewardedPlayerIds.add(account.playerId);
    }

    for (const account of rankedAccounts) {
      const current = this.accounts.get(account.playerId) ?? account;
      const decay = applySeasonSoftDecay(current);
      const rankPosition = rankedAccounts.findIndex((entry) => entry.playerId === account.playerId) + 1;
      const finalRating = normalizeEloRating(current.eloRating ?? account.eloRating ?? 1000);
      await this.savePlayerAccountProgress(account.playerId, {
        eloRating: decayDivisionToRating(decay.rankDivision ?? current.rankDivision ?? "bronze_i"),
        rankDivision: decay.rankDivision,
        peakRankDivision: decay.peakRankDivision,
        promotionSeries: null,
        demotionShield: null,
        seasonHistory: [
          {
            seasonId: normalizedSeasonId,
            rankPosition,
            totalPlayers: rankedAccounts.length,
            finalRating,
            peakDivision: current.peakRankDivision ?? current.rankDivision ?? "bronze_i",
            finalDivision: current.rankDivision ?? "bronze_i",
            rewardTier: getTierForDivision(current.rankDivision ?? "bronze_i"),
            rankPercentile: rankedAccounts.length > 0 ? rankPosition / rankedAccounts.length : 1,
            rewardClaimed: rewardedPlayerIds.has(account.playerId),
            archivedAt: distributedAt,
            ...(rewardedPlayerIds.has(account.playerId) ? { rewardsGrantedAt: distributedAt } : {})
          },
          ...(current.seasonHistory ?? [])
        ].slice(0, 20)
      });
    }

    this.seasons.set(normalizedSeasonId, {
      ...existing,
      status: "closed",
      endedAt: existing.endedAt ?? distributedAt,
      rewardDistributedAt: existing.rewardDistributedAt ?? distributedAt
    });

    return {
      seasonId: normalizedSeasonId,
      playersRewarded,
      totalGemsGranted
    };
  }

  async close(): Promise<void> {}

  /** For testing: Clear all in-memory state */
  clearAll(): void {
    this.snapshots.clear();
    this.accounts.clear();
    this.authByLoginId.clear();
    this.authSessionsByPlayerId.clear();
    this.playerIdByWechatOpenId.clear();
    this.heroArchives.clear();
    this.shopPurchases.clear();
    this.seasons.clear();
    this.leaderboardSeasonArchives.clear();
    this.seasonRewardLog.clear();
  }

  private selectSeasons(options: SeasonListOptions): SeasonSnapshot[] {
    const status = options.status ?? "closed";
    const rawLimit = options.limit ?? 20;
    const limit = Math.min(100, Math.max(1, Math.floor(rawLimit)));

    return Array.from(this.seasons.values())
      .filter((season) => status === "all" || season.status === status)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt) || left.seasonId.localeCompare(right.seasonId))
      .slice(0, limit)
      .map((season) => structuredClone(season));
  }
}

export function createMemoryRoomSnapshotStore(): RoomSnapshotStore {
  return new MemoryRoomSnapshotStore();
}
