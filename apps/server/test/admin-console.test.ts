import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { GuildState } from "@veil/shared/models";
import { normalizeGuildState } from "@veil/shared/social";
import { captureAnalyticsEventsForTest, resetAnalyticsRuntimeDependencies } from "@server/domain/ops/analytics";
import {
  deliverAccountToken,
  resetAccountTokenDeliveryState
} from "@server/adapters/account-token-delivery";
import { registerAdminRoutes } from "@server/domain/ops/admin-console";
import {
  configureLobbyRoomSummaryStore,
  getActiveRoomInstances,
  type LobbyRoomSummary
} from "@server/transport/colyseus-room/VeilColyseusRoom";
import type { AdminAuditLogCreateInput, PlayerBanHistoryRecord, PlayerCompensationRecord, PlayerPurchaseHistoryRecord, RoomSnapshotStore } from "@server/persistence";

type RouteHandler = (request: any, response: ServerResponse) => void | Promise<void>;

function createTestApp() {
  const gets = new Map<string, RouteHandler>();
  const posts = new Map<string, RouteHandler>();
  const deletes = new Map<string, RouteHandler>();
  const uses: Array<(request: IncomingMessage, response: ServerResponse, next: () => void) => void> = [];

  return {
    app: {
      use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) {
        uses.push(handler);
      },
      get(path: string, handler: RouteHandler) {
        gets.set(path, handler);
      },
      post(path: string, handler: RouteHandler) {
        posts.set(path, handler);
      },
      delete(path: string, handler: RouteHandler) {
        deletes.set(path, handler);
      }
    },
    uses,
    gets,
    posts,
    deletes
  };
}

function createRequest(options: {
  method?: string;
  headers?: Record<string, string | undefined>;
  params?: Record<string, string>;
  body?: string;
  url?: string;
} = {}): IncomingMessage & {
  params: Record<string, string>;
} {
  async function* iterateBody() {
    if (options.body !== undefined) {
      yield Buffer.from(options.body, "utf8");
    }
  }

  const request = iterateBody() as IncomingMessage & { params: Record<string, string> };
  Object.assign(request, {
    method: options.method ?? "GET",
    headers: options.headers ?? {},
    params: options.params ?? {},
    url: options.url ?? "/"
  });
  return request;
}

function createResponse(): ServerResponse & {
  body: string;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  let body = "";

  return {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name] = value;
      return this;
    },
    end(chunk?: string | Buffer) {
      body = chunk === undefined ? "" : Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
      return this;
    },
    get body() {
      return body;
    },
    headers
  } as ServerResponse & { body: string; headers: Record<string, string> };
}

function withAdminSecret(t: TestContext, secret = "test-admin-secret"): string {
  const originalAdminSecret = process.env.ADMIN_SECRET;
  process.env.ADMIN_SECRET = secret;
  getActiveRoomInstances().clear();
  resetAnalyticsRuntimeDependencies();
  t.after(() => {
    resetAnalyticsRuntimeDependencies();
    getActiveRoomInstances().clear();
    if (originalAdminSecret === undefined) {
      delete process.env.ADMIN_SECRET;
      return;
    }
    process.env.ADMIN_SECRET = originalAdminSecret;
  });
  return secret;
}

function withSupportSecrets(
  t: TestContext,
  options: {
    moderator?: string;
    supervisor?: string;
  } = {}
): { moderator: string; supervisor: string } {
  const moderator = options.moderator ?? "test-support-moderator-secret";
  const supervisor = options.supervisor ?? "test-support-supervisor-secret";
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  process.env.SUPPORT_MODERATOR_SECRET = moderator;
  process.env.SUPPORT_SUPERVISOR_SECRET = supervisor;
  t.after(() => {
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  });
  return { moderator, supervisor };
}

async function withAnnouncementConfig(t: TestContext, payload: unknown): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "veil-announcements-admin-"));
  const filePath = path.join(dir, "announcements.json");
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  const originalPath = process.env.VEIL_ANNOUNCEMENTS_CONFIG;
  process.env.VEIL_ANNOUNCEMENTS_CONFIG = filePath;
  t.after(() => {
    if (originalPath === undefined) {
      delete process.env.VEIL_ANNOUNCEMENTS_CONFIG;
      return;
    }
    process.env.VEIL_ANNOUNCEMENTS_CONFIG = originalPath;
  });
  return filePath;
}

function registerRoutes(store: RoomSnapshotStore | null = null) {
  const { app, uses, gets, posts, deletes } = createTestApp();
  registerAdminRoutes(app, store);
  return { uses, gets, posts, deletes };
}

function createStore(initialResourcesByPlayer: Record<string, { gold: number; wood: number; ore: number }> = {}) {
  const accounts = new Map(
    Object.entries(initialResourcesByPlayer).map(([playerId, globalResources]) => [
      playerId,
      {
        playerId,
        displayName: playerId,
        globalResources: { ...globalResources }
      }
    ])
  );
  const banHistoryByPlayerId = new Map<string, PlayerBanHistoryRecord[]>();
  const compensationHistoryByPlayerId = new Map<string, PlayerCompensationRecord[]>();
  const purchaseHistoryByPlayerId = new Map<string, PlayerPurchaseHistoryRecord[]>();
  const reports = new Map<string, {
    reportId: string;
    reporterId: string;
    targetId: string;
    reason: "cheating" | "harassment" | "afk";
    description?: string;
    roomId: string;
    status: "pending" | "dismissed" | "warned" | "banned";
    createdAt: string;
    resolvedAt?: string;
  }>();
  const supportTickets = new Map<string, {
    ticketId: string;
    playerId: string;
    category: "bug" | "payment" | "account" | "other";
    message: string;
    priority: "normal" | "high" | "urgent";
    status: "open" | "resolved" | "dismissed";
    handlerId?: string;
    resolution?: string;
    createdAt: string;
    resolvedAt?: string;
    updatedAt: string;
  }>();
  const mailboxByPlayerId = new Map<string, Array<{ id: string; title: string; body: string }>>();
  const guilds = new Map<string, GuildState>();
  const battleHistoryByPlayerId = new Map<string, Array<{
    roomId: string;
    battleId: string;
    status: "active" | "resolved" | "compensated" | "aborted";
    encounterKind: "neutral" | "hero";
    startedAt: string;
  }>>();
  const guildAuditLogs: Array<{
    auditId: string;
    guildId: string;
    action: "created" | "hidden" | "unhidden" | "deleted";
    actorPlayerId: string;
    occurredAt: string;
    name: string;
    tag: string;
    reason?: string;
  }> = [];
  const adminAuditLogs: Array<{
    auditId: string;
    actorPlayerId: string;
    actorRole: "admin" | "support-moderator" | "support-supervisor";
    action: string;
    targetPlayerId?: string;
    targetScope?: string;
    summary: string;
    beforeJson?: string;
    afterJson?: string;
    metadataJson?: string;
    occurredAt: string;
  }> = [];
  const saveCalls: Array<{ playerId: string; globalResources: { gold: number; wood: number; ore: number } }> = [];
  let nextReportId = 1;
  let nextSupportTicketId = 1;

  const store = {
    saveCalls,
    mailboxByPlayerId,
    async loadPlayerAccount(playerId: string) {
      return accounts.get(playerId) ?? null;
    },
    async listPlayerAccounts(options: { limit?: number; offset?: number } = {}) {
      const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
      const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
      return Array.from(accounts.values())
        .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
        .slice(safeOffset, safeOffset + safeLimit)
        .map((account) => structuredClone(account));
    },
    async createPlayerReport(input: {
      reporterId: string;
      targetId: string;
      reason: "cheating" | "harassment" | "afk";
      description?: string;
      roomId: string;
    }) {
      const duplicate = Array.from(reports.values()).find(
        (report) =>
          report.reporterId === input.reporterId &&
          report.targetId === input.targetId &&
          report.roomId === input.roomId
      );
      if (duplicate) {
        throw new Error("duplicate_player_report");
      }
      const report = {
        reportId: String(nextReportId++),
        reporterId: input.reporterId,
        targetId: input.targetId,
        reason: input.reason,
        ...(input.description ? { description: input.description } : {}),
        roomId: input.roomId,
        status: "pending" as const,
        createdAt: new Date().toISOString()
      };
      reports.set(report.reportId, report);
      return report;
    },
    async createSupportTicket(input: {
      playerId: string;
      category: "bug" | "payment" | "account" | "other";
      message: string;
      attachmentsRef?: string;
      priority?: "normal" | "high" | "urgent";
    }) {
      const now = new Date().toISOString();
      const ticket = {
        ticketId: `ticket-${nextSupportTicketId++}`,
        playerId: input.playerId,
        category: input.category,
        message: input.message,
        ...(input.attachmentsRef ? { attachmentsRef: input.attachmentsRef } : {}),
        priority: input.priority ?? "normal",
        status: "open" as const,
        createdAt: now,
        updatedAt: now
      };
      supportTickets.set(ticket.ticketId, ticket);
      return ticket;
    },
    async loadPlayerBan(playerId: string) {
      const account = accounts.get(playerId);
      if (!account) {
        return null;
      }
      return {
        playerId: account.playerId,
        banStatus: account.banStatus ?? "none",
        ...(account.banExpiry ? { banExpiry: account.banExpiry } : {}),
        ...(account.banReason ? { banReason: account.banReason } : {})
      };
    },
    async ensurePlayerAccount(input: { playerId: string; displayName?: string }) {
      const existing = accounts.get(input.playerId);
      if (existing) {
        return existing;
      }
      const created = {
        playerId: input.playerId,
        displayName: input.displayName ?? input.playerId,
        globalResources: { gold: 0, wood: 0, ore: 0 },
        banStatus: "none" as const
      };
      accounts.set(input.playerId, created);
      return created;
    },
    async loadGuild(guildId: string) {
      return guilds.get(guildId) ? normalizeGuildState(guilds.get(guildId)) : null;
    },
    async loadGuildByMemberPlayerId(playerId: string) {
      const match = Array.from(guilds.values()).find((guild) => guild.members.some((member) => member.playerId === playerId));
      return match ? normalizeGuildState(match) : null;
    },
    async listGuilds(options: { limit?: number } = {}) {
      return Array.from(guilds.values())
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, Math.max(1, Math.floor(options.limit ?? 50)))
        .map((guild) => normalizeGuildState(guild));
    },
    async saveGuild(guild: GuildState) {
      const normalized = normalizeGuildState(guild);
      guilds.set(normalized.id, normalized);
      return normalizeGuildState(normalized);
    },
    async deleteGuild(guildId: string) {
      guilds.delete(guildId);
    },
    async appendGuildAuditLog(input: {
      guildId: string;
      action: "created" | "hidden" | "unhidden" | "deleted";
      actorPlayerId: string;
      occurredAt?: string;
      name: string;
      tag: string;
      reason?: string;
    }) {
      const entry = {
        auditId: `${guildAuditLogs.length + 1}`,
        guildId: input.guildId,
        action: input.action,
        actorPlayerId: input.actorPlayerId,
        occurredAt: input.occurredAt ?? new Date().toISOString(),
        name: input.name,
        tag: input.tag,
        ...(input.reason ? { reason: input.reason } : {})
      };
      guildAuditLogs.unshift(entry);
      return entry;
    },
    async listGuildAuditLogs(options: { guildId?: string; limit?: number } = {}) {
      return guildAuditLogs
        .filter((entry) => !options.guildId || entry.guildId === options.guildId)
        .slice(0, Math.max(1, Math.floor(options.limit ?? 50)));
    },
    async savePlayerAccountProgress(
      playerId: string,
      patch: {
        gems?: number;
        globalResources?: { gold: number; wood: number; ore: number };
        leaderboardAbuseState?: Record<string, unknown>;
        leaderboardModerationState?: Record<string, unknown>;
        recentEventLog?: Array<Record<string, unknown>>;
      }
    ) {
      const account =
        (await this.loadPlayerAccount(playerId)) ??
        (await this.ensurePlayerAccount({
          playerId,
          displayName: playerId
        }));
      if (patch.gems !== undefined) {
        account.gems = patch.gems;
      }
      account.globalResources = { ...account.globalResources, ...patch.globalResources };
      if (patch.leaderboardAbuseState !== undefined) {
        account.leaderboardAbuseState =
          Object.keys(patch.leaderboardAbuseState).length > 0 ? { ...patch.leaderboardAbuseState } : undefined;
      }
      if (patch.leaderboardModerationState !== undefined) {
        account.leaderboardModerationState = {
          ...patch.leaderboardModerationState
        };
        if (Object.keys(account.leaderboardModerationState).length === 0) {
          delete account.leaderboardModerationState;
        }
      }
      if (patch.recentEventLog) {
        account.recentEventLog = [...patch.recentEventLog];
      }
      account.updatedAt = new Date().toISOString();
      saveCalls.push({ playerId, globalResources: { ...account.globalResources } });
      return account;
    },
    async appendPlayerCompensationRecord(
      playerId: string,
      input: {
        type: "add" | "deduct";
        currency: "gems" | "gold" | "wood" | "ore";
        amount: number;
        reason: string;
        previousBalance: number;
        balanceAfter: number;
      }
    ) {
      const history = compensationHistoryByPlayerId.get(playerId) ?? [];
      const record = {
        auditId: `comp-${history.length + 1}`,
        playerId,
        type: input.type,
        currency: input.currency,
        amount: input.amount,
        reason: input.reason,
        previousBalance: input.previousBalance,
        balanceAfter: input.balanceAfter,
        createdAt: new Date().toISOString()
      } satisfies PlayerCompensationRecord;
      history.unshift(record);
      compensationHistoryByPlayerId.set(playerId, history);
      return record;
    },
    async listPlayerCompensationHistory(playerId: string, options: { limit?: number } = {}) {
      return (compensationHistoryByPlayerId.get(playerId) ?? []).slice(0, Math.max(1, Math.floor(options.limit ?? 20)));
    },
    async listPlayerPurchaseHistory(
      playerId: string,
      query: { from?: string; to?: string; itemId?: string; limit?: number; offset?: number } = {}
    ) {
      const from = query.from ? new Date(query.from).getTime() : Number.NEGATIVE_INFINITY;
      const to = query.to ? new Date(query.to).getTime() : Number.POSITIVE_INFINITY;
      const limit = Math.max(1, Math.floor(query.limit ?? 20));
      const offset = Math.max(0, Math.floor(query.offset ?? 0));
      const items = (purchaseHistoryByPlayerId.get(playerId) ?? [])
        .filter((item) => !query.itemId || item.itemId === query.itemId)
        .filter((item) => {
          const grantedAt = new Date(item.grantedAt).getTime();
          return grantedAt >= from && grantedAt <= to;
        })
        .sort((left, right) => right.grantedAt.localeCompare(left.grantedAt) || right.purchaseId.localeCompare(left.purchaseId));
      return {
        items: items.slice(offset, offset + limit),
        total: items.length,
        limit,
        offset
      };
    },
    async savePlayerBan(playerId: string, input: { banStatus: "temporary" | "permanent"; banReason: string; banExpiry?: string }) {
      const account =
        (await this.loadPlayerAccount(playerId)) ??
        (await this.ensurePlayerAccount({
          playerId,
          displayName: playerId
        }));
      account.banStatus = input.banStatus;
      account.banReason = input.banReason;
      account.banExpiry = input.banStatus === "temporary" ? input.banExpiry : undefined;
      const history = banHistoryByPlayerId.get(playerId) ?? [];
      history.unshift({
        id: (history[0]?.id ?? 0) + 1,
        playerId,
        action: "ban",
        banStatus: input.banStatus,
        ...(input.banExpiry ? { banExpiry: input.banExpiry } : {}),
        banReason: input.banReason,
        createdAt: new Date().toISOString()
      });
      banHistoryByPlayerId.set(playerId, history);
      return account;
    },
    async clearPlayerBan(playerId: string, input: { reason?: string } = {}) {
      const account =
        (await this.loadPlayerAccount(playerId)) ??
        (await this.ensurePlayerAccount({
          playerId,
          displayName: playerId
        }));
      account.banStatus = "none";
      delete account.banReason;
      delete account.banExpiry;
      const history = banHistoryByPlayerId.get(playerId) ?? [];
      history.unshift({
        id: (history[0]?.id ?? 0) + 1,
        playerId,
        action: "unban",
        banStatus: "none",
        ...(input.reason ? { banReason: input.reason } : {}),
        createdAt: new Date().toISOString()
      });
      banHistoryByPlayerId.set(playerId, history);
      return account;
    },
    async listPlayerBanHistory(playerId: string, options: { limit?: number } = {}) {
      return (banHistoryByPlayerId.get(playerId) ?? []).slice(0, Math.max(1, Math.floor(options.limit ?? 20)));
    },
    async listBattleSnapshotsForPlayer(playerId: string, options: { limit?: number } = {}) {
      return (battleHistoryByPlayerId.get(playerId) ?? []).slice(0, Math.max(1, Math.floor(options.limit ?? 50)));
    },
    seedPurchaseHistory(playerId: string, items: PlayerPurchaseHistoryRecord[]) {
      purchaseHistoryByPlayerId.set(playerId, items);
    },
    seedBattleHistory(
      playerId: string,
      items: Array<{
        roomId: string;
        battleId: string;
        status: "active" | "resolved" | "compensated" | "aborted";
        encounterKind: "neutral" | "hero";
        startedAt: string;
      }>
    ) {
      battleHistoryByPlayerId.set(playerId, items);
    },
    async listPlayerReports(options: {
      status?: "pending" | "dismissed" | "warned" | "banned";
      reporterId?: string;
      targetId?: string;
      limit?: number;
    } = {}) {
      return Array.from(reports.values())
        .filter((report) => !options.status || report.status === options.status)
        .filter((report) => !options.reporterId || report.reporterId === options.reporterId)
        .filter((report) => !options.targetId || report.targetId === options.targetId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.reportId.localeCompare(right.reportId))
        .slice(0, Math.max(1, Math.floor(options.limit ?? 50)));
    },
    async listSupportTickets(options: {
      status?: "open" | "resolved" | "dismissed";
      playerId?: string;
      category?: "bug" | "payment" | "account" | "other";
      limit?: number;
    } = {}) {
      return Array.from(supportTickets.values())
        .filter((ticket) => !options.status || ticket.status === options.status)
        .filter((ticket) => !options.playerId || ticket.playerId === options.playerId)
        .filter((ticket) => !options.category || ticket.category === options.category)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.ticketId.localeCompare(right.ticketId))
        .slice(0, Math.max(1, Math.floor(options.limit ?? 50)));
    },
    async resolvePlayerReport(reportId: string, input: { status: "dismissed" | "warned" | "banned" }) {
      const report = reports.get(reportId);
      if (!report) {
        return null;
      }
      const next = {
        ...report,
        status: input.status,
        resolvedAt: new Date().toISOString()
      };
      reports.set(reportId, next);
      return next;
    },
    async resolveSupportTicket(
      ticketId: string,
      input: { status: "resolved" | "dismissed"; handlerId: string; resolution: string }
    ) {
      const ticket = supportTickets.get(ticketId);
      if (!ticket) {
        return null;
      }
      const next = {
        ...ticket,
        status: input.status,
        handlerId: input.handlerId,
        resolution: input.resolution,
        resolvedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      supportTickets.set(ticketId, next);
      return next;
    },
    async deliverPlayerMailbox(input: { playerIds: string[]; message: { id: string; title: string; body: string; kind?: string; grant?: unknown } }) {
      const deliveredPlayerIds: string[] = [];
      const skippedPlayerIds: string[] = [];
      for (const playerId of input.playerIds) {
        const mailbox = mailboxByPlayerId.get(playerId) ?? [];
        if (mailbox.some((message) => message.id === input.message.id)) {
          skippedPlayerIds.push(playerId);
          continue;
        }
        mailbox.push({
          id: input.message.id,
          title: input.message.title,
          body: input.message.body
        });
        mailboxByPlayerId.set(playerId, mailbox);
        const account = accounts.get(playerId);
        if (account) {
          account.mailbox = [
            {
              id: input.message.id,
              title: input.message.title,
              body: input.message.body,
              kind: input.message.kind === "compensation" || input.message.kind === "announcement" ? input.message.kind : "system",
              sentAt: new Date().toISOString(),
              ...(typeof input.message.grant === "object" && input.message.grant ? { grant: input.message.grant as never } : {})
            },
            ...(account.mailbox ?? [])
          ];
        }
        deliveredPlayerIds.push(playerId);
      }
      return {
        deliveredPlayerIds,
        skippedPlayerIds,
        message: input.message
      };
    },
    async appendAdminAuditLog(input: {
      actorPlayerId: string;
      actorRole: "admin" | "support-moderator" | "support-supervisor";
      action: string;
      targetPlayerId?: string;
      targetScope?: string;
      summary: string;
      beforeJson?: string;
      afterJson?: string;
      metadataJson?: string;
      occurredAt?: string;
    }) {
      const record = {
        auditId: `admin-audit-${adminAuditLogs.length + 1}`,
        actorPlayerId: input.actorPlayerId,
        actorRole: input.actorRole,
        action: input.action,
        ...(input.targetPlayerId ? { targetPlayerId: input.targetPlayerId } : {}),
        ...(input.targetScope ? { targetScope: input.targetScope } : {}),
        summary: input.summary,
        ...(input.beforeJson ? { beforeJson: input.beforeJson } : {}),
        ...(input.afterJson ? { afterJson: input.afterJson } : {}),
        ...(input.metadataJson ? { metadataJson: input.metadataJson } : {}),
        occurredAt: input.occurredAt ?? new Date().toISOString()
      };
      adminAuditLogs.unshift(record);
      return record;
    },
    async listAdminAuditLogs(options: {
      actorPlayerId?: string;
      action?: string;
      targetPlayerId?: string;
      targetScope?: string;
      since?: string;
      limit?: number;
    } = {}) {
      const since = options.since ? new Date(options.since).getTime() : Number.NEGATIVE_INFINITY;
      return adminAuditLogs
        .filter((entry) => !options.actorPlayerId || entry.actorPlayerId === options.actorPlayerId)
        .filter((entry) => !options.action || entry.action === options.action)
        .filter((entry) => !options.targetPlayerId || entry.targetPlayerId === options.targetPlayerId)
        .filter((entry) => !options.targetScope || entry.targetScope === options.targetScope)
        .filter((entry) => new Date(entry.occurredAt).getTime() >= since)
        .slice(0, Math.max(1, Math.floor(options.limit ?? 50)));
    }
  };

  return store as Pick<
    RoomSnapshotStore,
    | "loadPlayerAccount"
    | "listPlayerAccounts"
    | "createPlayerReport"
    | "loadPlayerBan"
    | "ensurePlayerAccount"
    | "loadGuild"
    | "loadGuildByMemberPlayerId"
    | "listGuilds"
    | "saveGuild"
    | "deleteGuild"
    | "appendGuildAuditLog"
    | "listGuildAuditLogs"
    | "savePlayerAccountProgress"
    | "savePlayerBan"
    | "clearPlayerBan"
    | "listPlayerBanHistory"
    | "appendPlayerCompensationRecord"
    | "listPlayerCompensationHistory"
    | "listPlayerPurchaseHistory"
    | "listBattleSnapshotsForPlayer"
    | "listPlayerReports"
    | "resolvePlayerReport"
    | "createSupportTicket"
    | "listSupportTickets"
    | "resolveSupportTicket"
    | "deliverPlayerMailbox"
    | "appendAdminAuditLog"
    | "listAdminAuditLogs"
  > & {
    saveCalls: Array<{ playerId: string; globalResources: { gold: number; wood: number; ore: number } }>;
    mailboxByPlayerId: Map<string, Array<{ id: string; title: string; body: string }>>;
    seedPurchaseHistory(playerId: string, items: PlayerPurchaseHistoryRecord[]): void;
    seedBattleHistory(
      playerId: string,
      items: Array<{
        roomId: string;
        battleId: string;
        status: "active" | "resolved" | "compensated" | "aborted";
        encounterKind: "neutral" | "hero";
        startedAt: string;
      }>
    ): void;
  } & typeof store;
}

test("GET /api/admin/overview returns 401 without a valid admin secret", async (t) => {
  withAdminSecret(t);
  const { gets } = registerRoutes();
  const handler = gets.get("/api/admin/overview");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-secret": "wrong-secret"
      }
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
});

test("admin console auth uses timing-safe secret comparisons", async () => {
  const sourcePath = fileURLToPath(new URL("../src/domain/ops/admin-console.ts", import.meta.url));
  const source = await readFile(sourcePath, "utf8");

  assert.match(source, /\btimingSafeCompareAdminToken\b/);
  assert.doesNotMatch(source, /readHeaderSecret\(request\)\s*===\s*adminSecret/);
  assert.doesNotMatch(source, /requestSecret\s*===\s*read(?:Admin|SupportSupervisor|SupportModerator)Secret\(\)/);
});

test("OPTIONS /api/admin preflight omits wildcard CORS exposure", async (t) => {
  withAdminSecret(t);
  const { uses } = registerRoutes();
  const middleware = uses[0];
  assert.ok(middleware);

  const response = createResponse();
  let nextCalled = false;
  await middleware(
    createRequest({
      method: "OPTIONS",
      url: "/api/admin/overview"
    }),
    response,
    () => {
      nextCalled = true;
    }
  );

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
});

test("GET /api/admin/overview returns server overview payload with a valid admin secret", async (t) => {
  const secret = withAdminSecret(t);
  const { gets } = registerRoutes();
  const handler = gets.get("/api/admin/overview");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-secret": secret
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    serverTime: string;
    activeRooms: number;
    activePlayers: number;
    nodeVersion: string;
    memoryUsage: NodeJS.MemoryUsage;
  };

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(payload.activeRooms, 0);
  assert.equal(payload.activePlayers, 0);
  assert.equal(payload.nodeVersion, process.version);
  assert.ok(Number.isFinite(Date.parse(payload.serverTime)));
  assert.equal(typeof payload.memoryUsage.rss, "number");
});

test("GET /api/admin/overview reads shared lobby room summaries", async (t) => {
  const secret = withAdminSecret(t);
  const summaries: LobbyRoomSummary[] = [
    {
      roomId: "shared-room-a",
      seed: 1001,
      day: 2,
      connectedPlayers: 2,
      disconnectedPlayers: 0,
      heroCount: 2,
      activeBattles: 0,
      statusLabel: "探索中",
      updatedAt: "2026-04-27T05:00:00.000Z"
    },
    {
      roomId: "shared-room-b",
      seed: 1002,
      day: 5,
      connectedPlayers: 1,
      disconnectedPlayers: 0,
      heroCount: 1,
      activeBattles: 1,
      statusLabel: "PVP 进行中",
      updatedAt: "2026-04-27T05:01:00.000Z"
    }
  ];
  configureLobbyRoomSummaryStore({
    async upsert() {},
    async delete() {},
    async list() {
      return summaries;
    }
  });
  t.after(() => configureLobbyRoomSummaryStore(null));

  const { gets } = registerRoutes();
  const handler = gets.get("/api/admin/overview");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-secret": secret
      }
    }),
    response
  );
  const payload = JSON.parse(response.body) as { activeRooms: number; activePlayers: number };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.activeRooms, 2);
  assert.equal(payload.activePlayers, 3);
});

test("GET /api/admin/experiments returns live experiment summaries with metrics", async (t) => {
  const secret = withAdminSecret(t);
  const { gets } = registerRoutes();
  const handler = gets.get("/api/admin/experiments");
  assert.ok(handler);

  captureAnalyticsEventsForTest([
    {
      schemaVersion: 1,
      name: "experiment_exposure",
      version: 1,
      at: "2026-05-10T00:00:00.000Z",
      playerId: "player-a",
      source: "server",
      payload: {
        experimentKey: "shop_headline_2026_05",
        experimentName: "Shop Headline May 2026",
        variant: "control",
        bucket: 10,
        surface: "shop_panel",
        owner: "monetization"
      }
    },
    {
      schemaVersion: 1,
      name: "experiment_exposure",
      version: 1,
      at: "2026-05-10T00:00:00.000Z",
      playerId: "player-b",
      source: "server",
      payload: {
        experimentKey: "shop_headline_2026_05",
        experimentName: "Shop Headline May 2026",
        variant: "value",
        bucket: 60,
        surface: "shop_panel",
        owner: "monetization"
      }
    },
    {
      schemaVersion: 1,
      name: "experiment_conversion",
      version: 1,
      at: "2026-05-10T01:00:00.000Z",
      playerId: "player-b",
      source: "server",
      payload: {
        experimentKey: "shop_headline_2026_05",
        experimentName: "Shop Headline May 2026",
        variant: "value",
        bucket: 60,
        conversion: "shop_purchase",
        owner: "monetization"
      }
    },
    {
      schemaVersion: 1,
      name: "purchase_completed",
      version: 1,
      at: "2026-05-10T01:05:00.000Z",
      playerId: "player-b",
      source: "server",
      payload: {
        purchaseId: "purchase-b",
        productId: "gem_pack_small",
        totalPrice: 30,
        paymentMethod: "wechat_pay",
        orderStatus: "completed"
      }
    }
  ]);

  const response = createResponse();
  await handler(
    createRequest({
      url: "/api/admin/experiments",
      headers: {
        "x-veil-admin-secret": secret
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    experiments: Array<{
      experimentKey: string;
      metrics: {
        variants: Array<{
          variant: string;
          conversions: number;
          revenue: number;
        }>;
      } | null;
    }>;
  };
  const summary = payload.experiments.find((entry) => entry.experimentKey === "shop_headline_2026_05");
  assert.ok(summary);
  assert.equal(summary.metrics?.variants.find((entry) => entry.variant === "value")?.conversions, 1);
  assert.equal(summary.metrics?.variants.find((entry) => entry.variant === "value")?.revenue, 30);
});

test("admin auth-token delivery DLQ routes list global dead letters and requeue without exposing tokens", async (t) => {
  withAdminSecret(t);
  const { supervisor } = withSupportSecrets(t);
  const auditLogs: AdminAuditLogCreateInput[] = [];
  t.after(() => resetAccountTokenDeliveryState());

  await assert.rejects(() =>
    deliverAccountToken(
      "webhook",
      {
        kind: "password-recovery",
        loginId: "admin-dlq-ranger",
        playerId: "player-admin-dlq",
        token: "do-not-expose-token",
        expiresAt: "2099-04-25T00:00:00.000Z"
      },
      {
        VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL: "http://127.0.0.1:1/token-delivery",
        VEIL_AUTH_TOKEN_DELIVERY_MAX_ATTEMPTS: "1",
        VEIL_AUTH_TOKEN_DELIVERY_TIMEOUT_MS: "50"
      }
    )
  );

  const { gets, posts } = registerRoutes({
    async appendAdminAuditLog(input: AdminAuditLogCreateInput) {
      auditLogs.push(input);
      return {
        auditId: `audit-${auditLogs.length}`,
        occurredAt: new Date().toISOString(),
        ...input
      };
    }
  } as unknown as RoomSnapshotStore);
  const listHandler = gets.get("/api/admin/auth-token-delivery/dead-letters");
  assert.ok(listHandler);

  const listResponse = createResponse();
  await listHandler(
    createRequest({
      headers: {
        "x-veil-admin-secret": supervisor
      }
    }),
    listResponse
  );

  assert.equal(listResponse.statusCode, 200);
  const listPayload = JSON.parse(listResponse.body) as {
    deadLetters: Array<Record<string, unknown>>;
  };
  assert.equal(listPayload.deadLetters.length, 1);
  assert.equal(listPayload.deadLetters[0]?.key, "password-recovery:admin-dlq-ranger");
  assert.equal(listPayload.deadLetters[0]?.loginId, "admin-dlq-ranger");
  assert.equal("token" in (listPayload.deadLetters[0] ?? {}), false);

  const requeueHandler = posts.get("/api/admin/auth-token-delivery/dead-letters/:key/requeue");
  assert.ok(requeueHandler);

  const requeueResponse = createResponse();
  await requeueHandler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": supervisor
      },
      params: {
        key: "password-recovery:admin-dlq-ranger"
      }
    }),
    requeueResponse
  );

  assert.equal(requeueResponse.statusCode, 202);
  const requeuePayload = JSON.parse(requeueResponse.body) as {
    queuedEntry: Record<string, unknown>;
  };
  assert.equal(requeuePayload.queuedEntry.key, "password-recovery:admin-dlq-ranger");
  assert.equal("token" in requeuePayload.queuedEntry, false);
  assert.equal(auditLogs.length, 1);
  assert.equal(auditLogs[0]?.action, "auth_token_delivery_dlq_requeue");
  assert.equal(auditLogs[0]?.targetPlayerId, "player-admin-dlq");
  assert.match(auditLogs[0]?.metadataJson ?? "", /admin-dlq-ranger/);
});

test("GET /api/admin/runtime/kill-switches returns minimum versions and kill-switch matrix", async (t) => {
  const secret = withAdminSecret(t);
  const { gets } = registerRoutes();
  const handler = gets.get("/api/admin/runtime/kill-switches");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: {
        "x-veil-admin-secret": secret
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    serverTime: string;
    clientMinVersion: {
      activeVersion: string;
      channels: Record<string, string>;
    };
    killSwitches: Array<{
      key: string;
      enabled: boolean;
    }>;
  };

  assert.equal(response.statusCode, 200);
  assert.ok(Number.isFinite(Date.parse(payload.serverTime)));
  assert.equal(payload.clientMinVersion.channels.wechat, "1.0.3");
  assert.equal(payload.killSwitches.find((entry) => entry.key === "wechat_matchmaking")?.enabled, false);
});

test("POST /api/admin/players/:id/resources returns 401 without a valid admin secret", async (t) => {
  withAdminSecret(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/resources");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      body: JSON.stringify({ gold: 5 })
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
  assert.equal(store.saveCalls.length, 0);
});

test("POST /api/admin/players/:id/resources returns 400 for malformed JSON", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes(createStore() as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/resources");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: "{"
    }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "Invalid JSON body" });
});

test("POST /api/admin/players/:id/resources returns 400 for invalid resource payload types", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore({
    "player-1": { gold: 10, wood: 4, ore: 1 }
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/resources");
  assert.ok(handler);

  const nonObjectResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: "null"
    }),
    nonObjectResponse
  );

  assert.equal(nonObjectResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(nonObjectResponse.body), { error: "JSON body must be an object" });

  const invalidFieldResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ gold: "drop table", wood: 2.5, ore: 1 })
    }),
    invalidFieldResponse
  );

  assert.equal(invalidFieldResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(invalidFieldResponse.body), { error: '"gold" must be a finite integer' });
  assert.equal(store.saveCalls.length, 0);
});

test("POST /api/admin/players/:id/resources adds and clamps resources and syncs active rooms", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore({
    "player-1": { gold: 10, wood: 4, ore: 1 }
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/resources");
  assert.ok(handler);

  const internalState = {
    resources: {
      "player-1": { gold: 10, wood: 4, ore: 1 }
    },
    playerResources: {
      "player-1": { gold: 10, wood: 4, ore: 1 }
    }
  };
  const snapshot = {
    state: {
      resources: { gold: 10, wood: 4, ore: 1 }
    },
    battle: { turn: 1 }
  };
  const sentMessages: Array<{ type: string; payload: unknown }> = [];
  const buildStatePayloadCalls: string[] = [];

  getActiveRoomInstances().set("room-alpha", {
    getPlayerId(client: { sessionId?: string }) {
      return client.sessionId === "session-player-2" ? "player-2" : "player-1";
    },
    buildStatePayload(playerId: string) {
      buildStatePayloadCalls.push(playerId);
      return {
        world: {
          playerId,
          resources: { gold: 0, wood: 7, ore: 3 }
        },
        battle: null,
        events: [{ type: "system.announcement", text: "资源已更新", tone: "system" }],
        movementPlan: null,
        reachableTiles: [],
        featureFlags: {
          quest_system_enabled: false,
          battle_pass_enabled: false,
          pve_enabled: true,
          tutorial_enabled: false
        }
      };
    },
    worldRoom: {
      getInternalState() {
        return internalState;
      },
      getSnapshot(playerId: string) {
        assert.equal(playerId, "player-1");
        return snapshot;
      }
    },
    clients: [
      {
        sessionId: "session-player-1",
        send(type: string, payload: unknown) {
          sentMessages.push({ type, payload });
        }
      },
      {
        sessionId: "session-player-2",
        send(type: string, payload: unknown) {
          sentMessages.push({ type, payload });
        }
      }
    ]
  } as never);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ gold: -15, wood: 3, ore: 2 })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    ok: true,
    resources: { gold: 0, wood: 7, ore: 3 },
    syncedToRoom: true
  });
  assert.deepEqual(store.saveCalls, [
    {
      playerId: "player-1",
      globalResources: { gold: 0, wood: 7, ore: 3 }
    }
  ]);
  assert.deepEqual(internalState.resources["player-1"], { gold: 0, wood: 7, ore: 3 });
  assert.deepEqual(internalState.playerResources["player-1"], { gold: 0, wood: 7, ore: 3 });
  assert.deepEqual(snapshot.state.resources, { gold: 0, wood: 7, ore: 3 });
  assert.deepEqual(buildStatePayloadCalls, ["player-1", "player-2"]);
  assert.equal(sentMessages.length, 2);
  assert.equal(sentMessages[0]?.type, "session.state");
});

test("POST /api/admin/players/:id/compensation returns 400 for invalid payloads", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes(createStore() as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/compensation");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ type: "grant", currency: "credits", amount: 0, reason: "" })
    }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: '"type" must be "add" or "deduct"' });
});

test("POST /api/admin/players/:id/compensation adds gems, writes audit history, and returns balances", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore({
    "player-1": { gold: 10, wood: 4, ore: 1 }
  });
  const existing = await store.ensurePlayerAccount({ playerId: "player-1", displayName: "player-1" });
  existing.gems = 25;
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/compensation");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({
        type: "add",
        currency: "gems",
        amount: 40,
        reason: "Failed payment refund"
      })
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    ok: true;
    compensation: PlayerCompensationRecord;
    balances: { gems: number; resources: { gold: number; wood: number; ore: number } };
    syncedToRoom: boolean;
  };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.compensation.type, "add");
  assert.equal(payload.compensation.currency, "gems");
  assert.equal(payload.compensation.amount, 40);
  assert.equal(payload.compensation.previousBalance, 25);
  assert.equal(payload.compensation.balanceAfter, 65);
  assert.equal(payload.compensation.reason, "Failed payment refund");
  assert.equal(payload.balances.gems, 65);
  assert.deepEqual(payload.balances.resources, { gold: 10, wood: 4, ore: 1 });
  assert.equal(payload.syncedToRoom, false);

  const history = await store.listPlayerCompensationHistory("player-1");
  assert.equal(history.length, 1);
  assert.equal(history[0]?.reason, "Failed payment refund");
  assert.equal((await store.loadPlayerAccount("player-1"))?.recentEventLog?.[0]?.category, "account");
  assert.match((await store.loadPlayerAccount("player-1"))?.recentEventLog?.[0]?.description ?? "", /Failed payment refund/);
});

test("POST /api/admin/players/:id/compensation deducts resources with clamping and syncs rooms", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore({
    "player-1": { gold: 10, wood: 4, ore: 1 }
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/compensation");
  assert.ok(handler);

  const internalState = {
    resources: {
      "player-1": { gold: 10, wood: 4, ore: 1 }
    },
    playerResources: {
      "player-1": { gold: 10, wood: 4, ore: 1 }
    }
  };
  const snapshot = {
    state: {
      resources: { gold: 10, wood: 4, ore: 1 }
    }
  };

  getActiveRoomInstances().set("room-alpha", {
    getPlayerId() {
      return "player-1";
    },
    buildStatePayload() {
      return {
        world: {
          playerId: "player-1",
          resources: { gold: 0, wood: 4, ore: 1 }
        },
        battle: null,
        events: [{ type: "system.announcement", text: "资源已更新", tone: "system" }],
        movementPlan: null,
        reachableTiles: [],
        featureFlags: {
          quest_system_enabled: false,
          battle_pass_enabled: false,
          pve_enabled: true,
          tutorial_enabled: false
        }
      };
    },
    worldRoom: {
      getInternalState() {
        return internalState;
      },
      getSnapshot() {
        return snapshot;
      }
    },
    clients: [
      {
        send() {}
      }
    ]
  } as never);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({
        type: "deduct",
        currency: "gold",
        amount: 25,
        reason: "Reverse erroneous grant"
      })
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    balances: { gems: number; resources: { gold: number; wood: number; ore: number } };
    syncedToRoom: boolean;
  };
  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload.balances.resources, { gold: 0, wood: 4, ore: 1 });
  assert.equal(payload.syncedToRoom, true);
  assert.deepEqual(internalState.resources["player-1"], { gold: 0, wood: 4, ore: 1 });
  assert.deepEqual(snapshot.state.resources, { gold: 0, wood: 4, ore: 1 });
});

test("GET /api/admin/players/:id/compensation/history returns compensation audit records", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore({
    "player-1": { gold: 10, wood: 4, ore: 1 }
  });
  await store.appendPlayerCompensationRecord("player-1", {
    type: "add",
    currency: "gold",
    amount: 15,
    reason: "Outage compensation",
    previousBalance: 10,
    balanceAfter: 25
  });
  await store.appendPlayerCompensationRecord("player-1", {
    type: "deduct",
    currency: "gems",
    amount: 5,
    reason: "Chargeback reversal",
    previousBalance: 20,
    balanceAfter: 15
  });

  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/compensation/history");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      url: "/api/admin/players/player-1/compensation/history?limit=2"
    }),
    response
  );

  const payload = JSON.parse(response.body) as { items: PlayerCompensationRecord[] };
  assert.equal(response.statusCode, 200);
  assert.equal(payload.items.length, 2);
  assert.equal(payload.items[0]?.reason, "Chargeback reversal");
  assert.equal(payload.items[1]?.reason, "Outage compensation");
});

test("GET /api/admin/players/:id/purchase-history returns filtered purchase audit records", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore();
  store.seedPurchaseHistory("player-1", [
    {
      purchaseId: "purchase-3",
      itemId: "starter-bundle",
      quantity: 1,
      currency: "gems",
      amount: 30,
      paymentMethod: "gems",
      grantedAt: "2026-02-03T11:00:00.000Z",
      status: "completed"
    },
    {
      purchaseId: "purchase-2",
      itemId: "starter-bundle",
      quantity: 2,
      currency: "gems",
      amount: 60,
      paymentMethod: "gems",
      grantedAt: "2026-02-02T10:00:00.000Z",
      status: "completed"
    },
    {
      purchaseId: "purchase-1",
      itemId: "sunforged-spear",
      quantity: 1,
      currency: "gems",
      amount: 20,
      paymentMethod: "gems",
      grantedAt: "2026-01-30T08:00:00.000Z",
      status: "completed"
    }
  ]);

  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/purchase-history");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      params: { id: "player-1" },
      headers: {
        "x-veil-admin-secret": secret
      },
      url: "/api/admin/players/player-1/purchase-history?from=2026-02-01T00:00:00.000Z&to=2026-02-28T23:59:59.999Z&itemId=starter-bundle&limit=1&page=2"
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    items: PlayerPurchaseHistoryRecord[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  assert.equal(response.statusCode, 200);
  assert.equal(payload.page, 2);
  assert.equal(payload.limit, 1);
  assert.equal(payload.total, 2);
  assert.equal(payload.totalPages, 2);
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0]?.purchaseId, "purchase-2");
  assert.equal(payload.items[0]?.itemId, "starter-bundle");
});

test("GET /api/admin/players/:id/overview aggregates GM 360 data and records an audit entry", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore({
    "player-gm": { gold: 120, wood: 30, ore: 12 }
  });
  const account = await store.ensurePlayerAccount({ playerId: "player-gm", displayName: "GM Target" });
  account.rankDivision = "D";
  account.seasonPassPremium = true;
  account.seasonPassTier = 9;
  account.gems = 55;
  account.mailbox = [
    {
      id: "mail-1",
      kind: "compensation",
      title: "补偿已发放",
      body: "请查收奖励",
      sentAt: "2026-04-10T10:00:00.000Z"
    }
  ];
  await store.createPlayerReport({
    reporterId: "player-2",
    targetId: "player-gm",
    reason: "harassment",
    roomId: "room-gm"
  });
  await store.createSupportTicket({
    playerId: "player-gm",
    category: "payment",
    message: "Missing bundle"
  });
  await store.appendPlayerCompensationRecord("player-gm", {
    type: "add",
    currency: "gems",
    amount: 20,
    reason: "Outage compensation",
    previousBalance: 35,
    balanceAfter: 55
  });
  await store.savePlayerBan("player-gm", {
    banStatus: "temporary",
    banReason: "Appeal pending",
    banExpiry: "2026-05-01T00:00:00.000Z"
  });
  store.seedPurchaseHistory("player-gm", [
    {
      purchaseId: "purchase-1",
      itemId: "starter-pack",
      quantity: 1,
      currency: "gems",
      amount: 60,
      paymentMethod: "gems",
      grantedAt: "2026-04-08T12:00:00.000Z",
      status: "completed"
    }
  ]);
  store.seedBattleHistory("player-gm", [
    {
      roomId: "room-gm",
      battleId: "battle-1",
      status: "resolved",
      encounterKind: "neutral",
      startedAt: "2026-04-09T09:00:00.000Z"
    }
  ]);

  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/overview");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      params: { id: "player-gm" },
      headers: { "x-veil-admin-secret": moderator }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    account: { playerId: string; rankDivision?: string };
    moderation: { currentBan: { banStatus: string } };
    reports: { againstPlayer: Array<{ targetId: string }> };
    supportTickets: Array<{ playerId: string }>;
    compensationHistory: Array<{ reason: string }>;
    purchaseHistory: { items: Array<{ purchaseId: string }> };
    mailbox: Array<{ id: string }>;
    battleHistory: Array<{ battleId: string }>;
  };
  assert.equal(payload.account.playerId, "player-gm");
  assert.equal(payload.account.rankDivision, "D");
  assert.equal(payload.moderation.currentBan.banStatus, "temporary");
  assert.equal(payload.reports.againstPlayer[0]?.targetId, "player-gm");
  assert.equal(payload.supportTickets[0]?.playerId, "player-gm");
  assert.equal(payload.compensationHistory[0]?.reason, "Outage compensation");
  assert.equal(payload.purchaseHistory.items[0]?.purchaseId, "purchase-1");
  assert.equal(payload.mailbox[0]?.id, "mail-1");
  assert.equal(payload.battleHistory[0]?.battleId, "battle-1");

  const audit = await store.listAdminAuditLogs({ targetPlayerId: "player-gm" });
  assert.equal(audit[0]?.action, "player_overview_viewed");
});

test("POST /api/admin/compensation/batch supports preview and delivery", async (t) => {
  withAdminSecret(t);
  const { supervisor } = withSupportSecrets(t);
  const store = createStore({
    "player-d1": { gold: 120, wood: 0, ore: 0 },
    "player-e1": { gold: 80, wood: 0, ore: 0 }
  });
  const d1 = await store.ensurePlayerAccount({ playerId: "player-d1", displayName: "Frontier D1" });
  d1.rankDivision = "D";
  d1.seasonPassPremium = true;
  const e1 = await store.ensurePlayerAccount({ playerId: "player-e1", displayName: "Frontier E1" });
  e1.rankDivision = "E";

  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/compensation/batch");
  assert.ok(handler);

  const previewResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": supervisor,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "add",
        currency: "gems",
        amount: 25,
        reason: "Weekend compensation",
        previewOnly: true,
        segment: {
          rankDivision: "D"
        },
        message: {
          title: "周末补偿",
          body: "请查收 25 gems。"
        }
      })
    }),
    previewResponse
  );

  assert.equal(previewResponse.statusCode, 200);
  const previewPayload = JSON.parse(previewResponse.body) as {
    matchedCount: number;
    targets: Array<{ playerId: string }>;
  };
  assert.equal(previewPayload.matchedCount, 1);
  assert.equal(previewPayload.targets[0]?.playerId, "player-d1");

  const executeResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": supervisor,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        type: "add",
        currency: "gems",
        amount: 25,
        reason: "Weekend compensation",
        segment: {
          rankDivision: "D"
        },
        message: {
          title: "周末补偿",
          body: "请查收 25 gems。"
        }
      })
    }),
    executeResponse
  );

  assert.equal(executeResponse.statusCode, 200);
  const executePayload = JSON.parse(executeResponse.body) as {
    delivery: { deliveredPlayerIds: string[]; skippedPlayerIds: string[] };
  };
  assert.deepEqual(executePayload.delivery.deliveredPlayerIds, ["player-d1"]);
  assert.deepEqual(executePayload.delivery.skippedPlayerIds, []);
  assert.equal(store.mailboxByPlayerId.get("player-d1")?.[0]?.title, "周末补偿");

  const audit = await store.listAdminAuditLogs({ targetScope: "player-segment" });
  assert.equal(audit[0]?.action, "compensation_batch_granted");
});

test("GET /api/admin/audit-log returns filtered GM audit entries", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.appendAdminAuditLog({
    actorPlayerId: "support-moderator:admin-console",
    actorRole: "support-moderator",
    action: "player_overview_viewed",
    targetPlayerId: "player-1",
    summary: "Viewed player-1"
  });
  await store.appendAdminAuditLog({
    actorPlayerId: "support-moderator:admin-console",
    actorRole: "support-moderator",
    action: "support_ticket_resolved",
    targetPlayerId: "player-2",
    summary: "Resolved ticket"
  });

  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/audit-log");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      headers: { "x-veil-admin-secret": moderator },
      url: "/api/admin/audit-log?targetPlayerId=player-1"
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as { items: Array<{ targetPlayerId?: string; action: string }> };
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0]?.targetPlayerId, "player-1");
  assert.equal(payload.items[0]?.action, "player_overview_viewed");

  const actionResponse = createResponse();
  await handler(
    createRequest({
      headers: { "x-veil-admin-secret": moderator },
      url: "/api/admin/audit-log?action=support_ticket_resolved"
    }),
    actionResponse
  );
  const actionPayload = JSON.parse(actionResponse.body) as { items: Array<{ targetPlayerId?: string; action: string }> };
  assert.equal(actionResponse.statusCode, 200);
  assert.equal(actionPayload.items.length, 1);
  assert.equal(actionPayload.items[0]?.targetPlayerId, "player-2");
  assert.equal(actionPayload.items[0]?.action, "support_ticket_resolved");
});

test("admin console html includes compensation form and history table", async () => {
  const adminHtmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/admin.html");
  const html = await readFile(adminHtmlPath, "utf8");
  assert.match(html, /玩家补偿 \/ 退款/);
  assert.match(html, /compensationHistoryBody/);
  assert.match(html, /submitCompensation/);
  assert.match(html, /fetchCompensationHistory/);
});

test("admin console html does not prefill credentials and escapes dynamic content", async () => {
  const adminHtmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/admin.html");
  const html = await readFile(adminHtmlPath, "utf8");

  assert.doesNotMatch(html, /id="adminSecret"[^>]*\bvalue=/);
  assert.doesNotMatch(html, /veil-admin-2026|dev-admin-token/);
  assert.match(html, /function escapeHtml/);
  assert.match(html, /escapeHtml\(data\.account\.displayName/);
  assert.match(html, /escapeHtml\(item\.reason/);
  assert.match(html, /escapeHtml\(report\.description/);
});

test("admin kill-switch html exposes the matrix view", async () => {
  const htmlPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/admin-kill-switches.html");
  const html = await readFile(htmlPath, "utf8");
  assert.match(html, /Kill Switch Matrix/);
  assert.match(html, /clientMinVersion/i);
  assert.match(html, /api\/admin\/runtime\/kill-switches/);
});

test("admin calendar and kill-switch html escape dynamic rows", async () => {
  const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client");
  const calendarHtml = await readFile(path.join(clientDir, "admin-calendar.html"), "utf8");
  const killSwitchHtml = await readFile(path.join(clientDir, "admin-kill-switches.html"), "utf8");

  assert.match(calendarHtml, /function escapeHtml/);
  assert.match(calendarHtml, /escapeHtml\(entry\.description/);
  assert.match(calendarHtml, /escapeHtml\(JSON\.stringify/);
  assert.match(killSwitchHtml, /function escapeHtml/);
  assert.match(killSwitchHtml, /escapeHtml\(item\.label/);
  assert.match(killSwitchHtml, /escapeHtml\(item\.summary/);
});

test("POST /api/admin/broadcast returns 401 without a valid admin secret", async (t) => {
  withAdminSecret(t);
  const { posts } = registerRoutes();
  const handler = posts.get("/api/admin/broadcast");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      body: JSON.stringify({ message: "Server restart incoming" })
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
});

test("POST /api/admin/broadcast broadcasts to all active rooms and succeeds when none are active", async (t) => {
  const secret = withAdminSecret(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/broadcast");
  assert.ok(handler);

  const broadcasts: Array<{ roomId: string; type: string; payload: { text: string; type: string; timestamp: string } }> = [];
  getActiveRoomInstances().set("room-a", {
    broadcast(type: string, payload: { text: string; type: string; timestamp: string }) {
      broadcasts.push({ roomId: "room-a", type, payload });
    }
  } as never);
  getActiveRoomInstances().set("room-b", {
    broadcast(type: string, payload: { text: string; type: string; timestamp: string }) {
      broadcasts.push({ roomId: "room-b", type, payload });
    }
  } as never);

  const activeRoomsResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ message: "Server restart incoming", type: "warning" })
    }),
    activeRoomsResponse
  );

  assert.equal(activeRoomsResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(activeRoomsResponse.body), { ok: true });
  assert.equal(broadcasts.length, 2);
  assert.deepEqual(
    broadcasts.map(({ roomId, type, payload }) => ({
      roomId,
      type,
      text: payload.text,
      announcementType: payload.type,
      hasTimestamp: Number.isFinite(Date.parse(payload.timestamp))
    })),
    [
      {
        roomId: "room-a",
        type: "system.announcement",
        text: "Server restart incoming",
        announcementType: "warning",
        hasTimestamp: true
      },
      {
        roomId: "room-b",
        type: "system.announcement",
        text: "Server restart incoming",
        announcementType: "warning",
        hasTimestamp: true
      }
    ]
  );

  getActiveRoomInstances().clear();

  const noRoomsResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ message: "No listeners" })
    }),
    noRoomsResponse
  );

  assert.equal(noRoomsResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(noRoomsResponse.body), { ok: true });
  const auditLogs = await store.listAdminAuditLogs({ action: "global_broadcast", limit: 5 });
  assert.equal(auditLogs.length, 2);
  assert.match(auditLogs[0]?.metadataJson ?? "", /messageLength/);
});

test("POST /api/admin/broadcast returns 400 for invalid payload types", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes();
  const handler = posts.get("/api/admin/broadcast");
  assert.ok(handler);

  const nonObjectResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": secret
      },
      body: "[]"
    }),
    nonObjectResponse
  );

  assert.equal(nonObjectResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(nonObjectResponse.body), { error: "JSON body must be an object" });

  const invalidMessageResponse = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": secret
      },
      body: JSON.stringify({ message: "   ", type: 42 })
    }),
    invalidMessageResponse
  );

  assert.equal(invalidMessageResponse.statusCode, 400);
  assert.deepEqual(JSON.parse(invalidMessageResponse.body), { error: '"message" must be a non-empty string' });
});

test("POST /api/admin/players/:id/ban bans the player and POST /unban clears it", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore({
    "player-7": { gold: 1, wood: 2, ore: 3 }
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const banHandler = posts.get("/api/admin/players/:id/ban");
  const unbanHandler = posts.get("/api/admin/players/:id/unban");
  assert.ok(banHandler);
  assert.ok(unbanHandler);

  const banResponse = createResponse();
  await banHandler(
    createRequest({
      method: "POST",
      params: { id: "player-7" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({
        banStatus: "temporary",
        banExpiry: "2026-05-05T00:00:00.000Z",
        banReason: "Chargeback abuse"
      })
    }),
    banResponse
  );

  assert.equal(banResponse.statusCode, 200);
  const banPayload = JSON.parse(banResponse.body) as {
    ok: boolean;
    account: { banStatus: string; banExpiry?: string; banReason?: string };
    disconnectedClients: number;
  };
  assert.equal(banPayload.ok, true);
  assert.equal(banPayload.account.banStatus, "temporary");
  assert.equal(banPayload.account.banExpiry, "2026-05-05T00:00:00.000Z");
  assert.equal(banPayload.account.banReason, "Chargeback abuse");
  assert.equal(banPayload.disconnectedClients, 0);

  const unbanResponse = createResponse();
  await unbanHandler(
    createRequest({
      method: "POST",
      params: { id: "player-7" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ reason: "Appeal approved" })
    }),
    unbanResponse
  );

  assert.equal(unbanResponse.statusCode, 200);
  const unbanPayload = JSON.parse(unbanResponse.body) as {
    ok: boolean;
    account: { banStatus: string; banExpiry?: string; banReason?: string };
  };
  assert.equal(unbanPayload.ok, true);
  assert.equal(unbanPayload.account.banStatus, "none");
  assert.equal("banExpiry" in unbanPayload.account, false);
  assert.equal("banReason" in unbanPayload.account, false);
});

test("GET /api/admin/players/:id/ban-history returns current ban state and history records", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.savePlayerBan("player-history", {
    banStatus: "permanent",
    banReason: "Botting"
  });
  await store.clearPlayerBan("player-history", {
    reason: "Manual review"
  });
  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/ban-history");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      params: { id: "player-history" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    items: PlayerBanHistoryRecord[];
    currentBan: { banStatus: string };
  };
  assert.equal(payload.currentBan.banStatus, "none");
  assert.ok(payload.items.length >= 1);
  assert.equal(payload.items[0]?.action, "unban");
  assert.equal(payload.items[0]?.banReason, "Manual review");
});

test("GET /api/admin/reports returns filtered player reports", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.createPlayerReport({
    reporterId: "player-1",
    targetId: "player-2",
    reason: "cheating",
    roomId: "room-report"
  });
  const report = await store.createPlayerReport({
    reporterId: "player-3",
    targetId: "player-4",
    reason: "harassment",
    roomId: "room-report"
  });
  await store.resolvePlayerReport(report.reportId, { status: "dismissed" });

  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/reports");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      url: "/api/admin/reports?status=pending",
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    status: string;
    items: Array<{ reporterId: string; status: string }>;
  };
  assert.equal(payload.status, "pending");
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0]?.reporterId, "player-1");
  assert.equal(payload.items[0]?.status, "pending");
});

test("POST /api/admin/reports/:id/resolve marks a report resolved", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const report = await store.createPlayerReport({
    reporterId: "player-1",
    targetId: "player-2",
    reason: "afk",
    roomId: "room-report"
  });

  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/reports/:id/resolve");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: report.reportId },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ status: "warned" })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    ok: boolean;
    report: { status: string; resolvedAt?: string };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.report.status, "warned");
  assert.ok(payload.report.resolvedAt);
});

test("admin launch runtime routes list, create, and delete announcements", async (t) => {
  withAdminSecret(t);
  await withAnnouncementConfig(t, {
    announcements: [
      {
        id: "launch-1",
        title: "首发公告",
        message: "服务器将于今晚维护。",
        tone: "warning",
        startsAt: "2020-04-17T10:00:00.000Z",
        endsAt: "2099-04-17T12:00:00.000Z"
      }
    ],
    maintenanceMode: {
      enabled: false,
      title: "停服维护中",
      message: "服务器正在维护，请稍后再试。",
      whitelistPlayerIds: [],
      whitelistLoginIds: []
    },
    updatedAt: "2026-04-17T09:00:00.000Z"
  });

  const store = createStore();
  const { gets, posts, deletes } = registerRoutes(store as RoomSnapshotStore);
  const listHandler = gets.get("/api/admin/announcements");
  const createHandler = posts.get("/api/admin/announcements");
  const deleteHandler = deletes.get("/api/admin/announcements/:id");
  assert.ok(listHandler);
  assert.ok(createHandler);
  assert.ok(deleteHandler);

  const listResponse = createResponse();
  await listHandler(
    createRequest({
      headers: {
        "x-veil-admin-secret": process.env.ADMIN_SECRET
      }
    }),
    listResponse
  );
  assert.equal(listResponse.statusCode, 200);
  const listPayload = JSON.parse(listResponse.body) as {
    announcements: Array<{ id: string; title: string }>;
    active: Array<{ id: string }>;
    maintenanceMode: { active: boolean; blocked: boolean };
  };
  assert.equal(listPayload.announcements.length, 1);
  assert.equal(listPayload.announcements[0]?.id, "launch-1");
  assert.deepEqual(listPayload.active.map((item) => item.id), ["launch-1"]);
  assert.equal(listPayload.maintenanceMode.active, false);
  assert.equal(listPayload.maintenanceMode.blocked, false);

  const createResponseState = createResponse();
  await createHandler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": process.env.ADMIN_SECRET
      },
      body: JSON.stringify({
        id: "launch-2",
        title: "热更新公告",
        message: "热更新将在 15 分钟后生效。",
        tone: "info",
        startsAt: "2020-04-17T12:10:00.000Z",
        endsAt: "2099-04-17T13:00:00.000Z"
      })
    }),
    createResponseState
  );
  assert.equal(createResponseState.statusCode, 200);
  const createPayload = JSON.parse(createResponseState.body) as {
    ok: boolean;
    announcement: { id: string; title: string };
    active: Array<{ id: string }>;
  };
  assert.equal(createPayload.ok, true);
  assert.equal(createPayload.announcement.id, "launch-2");
  assert.deepEqual(createPayload.active.map((item) => item.id), ["launch-1", "launch-2"]);

  const deleteResponse = createResponse();
  await deleteHandler(
    createRequest({
      method: "DELETE",
      params: { id: "launch-1" },
      headers: {
        "x-veil-admin-secret": process.env.ADMIN_SECRET
      }
    }),
    deleteResponse
  );
  assert.equal(deleteResponse.statusCode, 200);
  const deletePayload = JSON.parse(deleteResponse.body) as {
    ok: boolean;
    removed: boolean;
    announcement?: { id: string };
    active: Array<{ id: string }>;
  };
  assert.equal(deletePayload.ok, true);
  assert.equal(deletePayload.removed, true);
  assert.equal(deletePayload.announcement?.id, "launch-1");
  assert.deepEqual(deletePayload.active.map((item) => item.id), ["launch-2"]);
  const auditLogs = await store.listAdminAuditLogs({ targetScope: "launch-announcement", limit: 5 });
  assert.deepEqual(auditLogs.map((entry) => entry.action), [
    "launch_announcement_deleted",
    "launch_announcement_upserted"
  ]);
  assert.match(auditLogs[0]?.metadataJson ?? "", /"removed":true/);
});

test("admin maintenance mode route persists the current maintenance snapshot", async (t) => {
  withAdminSecret(t);
  await withAnnouncementConfig(t, {
    announcements: [],
    maintenanceMode: {
      enabled: false,
      title: "停服维护中",
      message: "服务器正在维护，请稍后再试。",
      whitelistPlayerIds: [],
      whitelistLoginIds: []
    },
    updatedAt: "2026-04-17T09:00:00.000Z"
  });

  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/maintenance-mode");
  assert.ok(handler);

  const nextOpenAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      headers: {
        "x-veil-admin-secret": process.env.ADMIN_SECRET
      },
      body: JSON.stringify({
        enabled: true,
        title: "停服维护中",
        message: "预计 30 分钟后恢复开放。",
        nextOpenAt,
        whitelistPlayerIds: ["ops-player"],
        whitelistLoginIds: ["ops-login"]
      })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    ok: boolean;
    maintenanceMode: {
      active: boolean;
      blocked: boolean;
      title: string;
      message: string;
      nextOpenAt?: string;
    };
    updatedAt?: string;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.maintenanceMode.active, true);
  assert.equal(payload.maintenanceMode.blocked, true);
  assert.equal(payload.maintenanceMode.message, "预计 30 分钟后恢复开放。");
  assert.equal(payload.maintenanceMode.nextOpenAt, nextOpenAt);
  assert.ok(payload.updatedAt);
  const auditLogs = await store.listAdminAuditLogs({ action: "maintenance_mode_enabled", limit: 1 });
  assert.equal(auditLogs.length, 1);
  assert.match(auditLogs[0]?.metadataJson ?? "", /ops-player/);
});

test("GET /api/admin/support-tickets returns open support tickets", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.createSupportTicket({
    playerId: "player-1",
    category: "bug",
    message: "Cocos 大厅按钮没有响应。",
    priority: "high"
  });
  const resolved = await store.createSupportTicket({
    playerId: "player-2",
    category: "payment",
    message: "支付后未到账。"
  });
  await store.resolveSupportTicket(resolved.ticketId, {
    status: "resolved",
    handlerId: "support-moderator:admin-console",
    resolution: "已经补发。"
  });

  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/support-tickets");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      url: "/api/admin/support-tickets?status=open",
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    status: string;
    items: Array<{ ticketId: string; category: string; status: string }>;
  };
  assert.equal(payload.status, "open");
  assert.equal(payload.items.length, 1);
  assert.equal(payload.items[0]?.category, "bug");
  assert.equal(payload.items[0]?.status, "open");
});

test("POST /api/admin/support-tickets/:id/resolve resolves the ticket and delivers mailbox feedback", async (t) => {
  withAdminSecret(t);
  const { supervisor } = withSupportSecrets(t);
  const store = createStore();
  const ticket = await store.createSupportTicket({
    playerId: "player-support",
    category: "account",
    message: "请帮忙处理账号异常。"
  });

  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/support-tickets/:id/resolve");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: ticket.ticketId },
      headers: {
        "x-veil-admin-secret": supervisor
      },
      body: JSON.stringify({
        status: "resolved",
        resolution: "已重置账号状态，请重新登录。"
      })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    ok: boolean;
    mailboxDelivered: boolean;
    ticket: { status: string; handlerId?: string; resolution?: string };
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.mailboxDelivered, true);
  assert.equal(payload.ticket.status, "resolved");
  assert.equal(payload.ticket.handlerId, "support-supervisor:admin-console");
  assert.equal(payload.ticket.resolution, "已重置账号状态，请重新登录。");
  assert.equal(store.mailboxByPlayerId.get("player-support")?.[0]?.title, "客服工单已处理");
});

test("GET /api/admin/overview returns 503 when ADMIN_SECRET is not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;
  try {
    const { gets } = registerRoutes();
    const handler = gets.get("/api/admin/overview");
    assert.ok(handler);

    const response = createResponse();
    await handler(createRequest({ headers: { "x-veil-admin-secret": "any-secret" } }), response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "ADMIN_SECRET is not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
  }
});

test("GET /admin serves admin.html with text/html content-type", async (t) => {
  withAdminSecret(t);
  const { gets } = registerRoutes();
  const handler = gets.get("/admin");
  assert.ok(handler);

  const response = createResponse();
  await handler(createRequest({ url: "/admin" }), response);

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Content-Type"] ?? "", /text\/html/);
  assert.ok(response.body.length > 0, "admin.html body should be non-empty");
});

test("POST /api/admin/players/:id/unban returns 401 without a valid admin secret", async (t) => {
  withAdminSecret(t);
  withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/unban");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-1" },
      body: JSON.stringify({ reason: "appeal approved" })
    }),
    response
  );

  assert.equal(response.statusCode, 401);
  assert.deepEqual(JSON.parse(response.body), { error: "Unauthorized: Invalid Admin Secret" });
});

test("POST /api/admin/players/:id/unban returns 503 when support secrets are not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  delete process.env.ADMIN_SECRET;
  delete process.env.SUPPORT_MODERATOR_SECRET;
  delete process.env.SUPPORT_SUPERVISOR_SECRET;
  try {
    const { posts } = registerRoutes();
    const handler = posts.get("/api/admin/players/:id/unban");
    assert.ok(handler);

    const response = createResponse();
    await handler(
      createRequest({ method: "POST", params: { id: "player-1" }, body: JSON.stringify({}) }),
      response
    );

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "Player support secrets are not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  }
});

test("GET /api/admin/players/:id/ban-history returns 503 when support secrets are not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  delete process.env.ADMIN_SECRET;
  delete process.env.SUPPORT_MODERATOR_SECRET;
  delete process.env.SUPPORT_SUPERVISOR_SECRET;
  try {
    const store = createStore();
    const { gets } = registerRoutes(store as RoomSnapshotStore);
    const handler = gets.get("/api/admin/players/:id/ban-history");
    assert.ok(handler);

    const response = createResponse();
    await handler(createRequest({ params: { id: "player-1" } }), response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "Player support secrets are not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  }
});

test("GET /api/admin/reports returns 503 when support secrets are not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  delete process.env.ADMIN_SECRET;
  delete process.env.SUPPORT_MODERATOR_SECRET;
  delete process.env.SUPPORT_SUPERVISOR_SECRET;
  try {
    const store = createStore();
    const { gets } = registerRoutes(store as RoomSnapshotStore);
    const handler = gets.get("/api/admin/reports");
    assert.ok(handler);

    const response = createResponse();
    await handler(createRequest({ url: "/api/admin/reports" }), response);

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "Player support secrets are not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  }
});

test("POST /api/admin/reports/:id/resolve returns 503 when support secrets are not configured", async () => {
  const original = process.env.ADMIN_SECRET;
  const originalModeratorSecret = process.env.SUPPORT_MODERATOR_SECRET;
  const originalSupervisorSecret = process.env.SUPPORT_SUPERVISOR_SECRET;
  delete process.env.ADMIN_SECRET;
  delete process.env.SUPPORT_MODERATOR_SECRET;
  delete process.env.SUPPORT_SUPERVISOR_SECRET;
  try {
    const store = createStore();
    const { posts } = registerRoutes(store as RoomSnapshotStore);
    const handler = posts.get("/api/admin/reports/:id/resolve");
    assert.ok(handler);

    const response = createResponse();
    await handler(
      createRequest({ method: "POST", params: { id: "report-1" }, body: JSON.stringify({ status: "dismissed" }) }),
      response
    );

    assert.equal(response.statusCode, 503);
    assert.deepEqual(JSON.parse(response.body), { error: "Player support secrets are not configured" });
  } finally {
    if (original === undefined) {
      delete process.env.ADMIN_SECRET;
    } else {
      process.env.ADMIN_SECRET = original;
    }
    if (originalModeratorSecret === undefined) {
      delete process.env.SUPPORT_MODERATOR_SECRET;
    } else {
      process.env.SUPPORT_MODERATOR_SECRET = originalModeratorSecret;
    }
    if (originalSupervisorSecret === undefined) {
      delete process.env.SUPPORT_SUPERVISOR_SECRET;
    } else {
      process.env.SUPPORT_SUPERVISOR_SECRET = originalSupervisorSecret;
    }
  }
});

test("POST /api/admin/reports/:id/resolve with banned also bans the reported player", async (t) => {
  withAdminSecret(t);
  const { supervisor } = withSupportSecrets(t);
  const store = createStore();
  const report = await store.createPlayerReport({
    reporterId: "player-1",
    targetId: "player-2",
    reason: "cheating",
    roomId: "room-report"
  });

  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/reports/:id/resolve");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: report.reportId },
      headers: {
        "x-veil-admin-secret": supervisor
      },
      body: JSON.stringify({
        status: "banned",
        approval: {
          approvedBy: "ops-lead",
          approvalReference: "SUP-204"
        }
      })
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    ok: boolean;
    disconnectedClients: number;
    report: { status: string; targetId: string };
  };
  const currentBan = await store.loadPlayerBan("player-2");
  assert.equal(payload.ok, true);
  assert.equal(payload.report.status, "banned");
  assert.equal(payload.disconnectedClients, 0);
  assert.equal(currentBan?.banStatus, "permanent");
  assert.match(currentBan?.banReason ?? "", /player report/);
  assert.match(currentBan?.banReason ?? "", /approvedBy=ops-lead/);
});

test("POST /api/admin/players/:id/ban rejects permanent bans from support moderators", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/ban");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-9" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({
        banStatus: "permanent",
        banReason: "Confirmed botting",
        approval: {
          approvedBy: "ops-lead",
          approvalReference: "SUP-205"
        }
      })
    }),
    response
  );

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: "Forbidden: permanent bans require support-supervisor or admin credentials"
  });
});

test("POST /api/admin/players/:id/ban requires approval metadata for permanent bans", async (t) => {
  withAdminSecret(t);
  const { supervisor } = withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/ban");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-10" },
      headers: {
        "x-veil-admin-secret": supervisor
      },
      body: JSON.stringify({
        banStatus: "permanent",
        banReason: "Chargeback fraud"
      })
    }),
    response
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "\"approval\" is required" });
});

test("POST /api/admin/players/:id/unban rejects permanent-ban reversal from support moderators", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.savePlayerBan("player-11", {
    banStatus: "permanent",
    banReason: "Severe abuse"
  });
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/unban");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-11" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ reason: "appeal approved" })
    }),
    response
  );

  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), {
    error: "Forbidden: permanent-ban reversals require support-supervisor or admin credentials"
  });
});

test("GET /api/admin/players/:id/export returns account data for support workflows", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore({
    "player-export": { gold: 9, wood: 4, ore: 2 }
  });
  await store.savePlayerBan("player-export", {
    banStatus: "temporary",
    banReason: "Spam",
    banExpiry: "2026-05-10T00:00:00.000Z"
  });
  store.seedBattleHistory("player-export", [
    {
      roomId: "room-reconnect",
      battleId: "battle-neutral-1",
      status: "compensated",
      encounterKind: "neutral",
      startedAt: "2026-04-11T10:00:00.000Z"
    }
  ]);
  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/export");
  assert.ok(handler);

  const response = createResponse();
  await handler(
    createRequest({
      params: { id: "player-export" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  assert.equal(response.statusCode, 200);
  const payload = JSON.parse(response.body) as {
    playerId: string;
    exportedAt: string;
    account: { playerId: string; globalResources: { gold: number; wood: number; ore: number } };
    moderation: { currentBan: { banStatus: string }; banHistory: Array<{ action: string }> };
    battleHistory: Array<{ battleId: string; status: string }>;
  };
  assert.equal(payload.playerId, "player-export");
  assert.ok(Number.isFinite(Date.parse(payload.exportedAt)));
  assert.equal(payload.account.playerId, "player-export");
  assert.deepEqual(payload.account.globalResources, { gold: 9, wood: 4, ore: 2 });
  assert.equal(payload.moderation.currentBan.banStatus, "temporary");
  assert.equal(payload.moderation.banHistory[0]?.action, "ban");
  assert.equal(payload.battleHistory[0]?.battleId, "battle-neutral-1");
  assert.equal(payload.battleHistory[0]?.status, "compensated");
});

test("POST /api/admin/players/:id/leaderboard/freeze freezes leaderboard movement for a player", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/leaderboard/freeze");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-freeze" },
      body: JSON.stringify({ reason: "Suspicious ELO spike" }),
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    ok: boolean;
    account: { leaderboardModerationState?: { frozenByPlayerId?: string; freezeReason?: string; frozenAt?: string } };
  };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.account.leaderboardModerationState?.frozenByPlayerId, "support-moderator:admin-console");
  assert.equal(payload.account.leaderboardModerationState?.freezeReason, "Suspicious ELO spike");
  assert.ok(payload.account.leaderboardModerationState?.frozenAt);
  const auditLogs = await store.listAdminAuditLogs({ action: "leaderboard_player_frozen", targetPlayerId: "player-freeze", limit: 1 });
  assert.equal(auditLogs.length, 1);
  assert.match(auditLogs[0]?.metadataJson ?? "", /Suspicious ELO spike/);
});

test("GET /api/admin/players/:id/leaderboard/abuse-state returns structured abuse state and alert history", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore({
    "player-abuse": { gold: 0, wood: 0, ore: 0 }
  });
  await store.savePlayerAccountProgress("player-abuse", {
    leaderboardAbuseState: {
      currentDay: "2026-04-12",
      dailyEloGain: 120,
      dailyEloLoss: 0,
      status: "flagged",
      lastAlertAt: "2026-04-12T08:00:00.000Z",
      lastAlertReasons: ["daily_gain_cap_hit", "repeated_opponent_watch"]
    },
    leaderboardModerationState: {
      frozenAt: "2026-04-12T08:05:00.000Z",
      frozenByPlayerId: "support-moderator:admin-console",
      freezeReason: "Manual review"
    },
    recentEventLog: [
      {
        id: "leaderboard:freeze_cleared:2026-04-12T09:00:00.000Z:player-abuse",
        timestamp: "2026-04-12T09:00:00.000Z",
        roomId: "admin-console",
        playerId: "player-abuse",
        category: "account",
        description: "解除排行榜冻结（操作人：support-moderator:admin-console，原因：False positive）",
        rewards: []
      }
    ]
  });
  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/leaderboard/abuse-state");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      params: { id: "player-abuse" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    playerId: string;
    abuseState: { status?: string; lastAlertReasons?: string[] };
    moderationState: { frozenByPlayerId?: string };
    alertHistory: Array<{ type: string; source: string; detail: string }>;
  };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.playerId, "player-abuse");
  assert.equal(payload.abuseState.status, "flagged");
  assert.deepEqual(payload.abuseState.lastAlertReasons, ["daily_gain_cap_hit", "repeated_opponent_watch"]);
  assert.equal(payload.moderationState.frozenByPlayerId, "support-moderator:admin-console");
  assert.equal(payload.alertHistory.some((entry) => entry.type === "freeze_cleared" && entry.source === "event-log"), true);
  assert.equal(payload.alertHistory.some((entry) => entry.type === "leaderboard_daily_gain_cap" && entry.source === "abuse-state"), true);
  assert.equal(payload.alertHistory.some((entry) => /Manual review/.test(entry.detail)), true);
});

test("GET /api/admin/players/:id/leaderboard/abuse-state returns 404 for unknown players", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/players/:id/leaderboard/abuse-state");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      params: { id: "missing-player" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: "Player account not found" });
});

test("DELETE /api/admin/players/:id/leaderboard/freeze clears frozen state and appends an audit record", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore({
    "player-clear-freeze": { gold: 0, wood: 0, ore: 0 }
  });
  await store.savePlayerAccountProgress("player-clear-freeze", {
    leaderboardModerationState: {
      frozenAt: "2026-04-12T08:00:00.000Z",
      frozenByPlayerId: "support-moderator:admin-console",
      freezeReason: "Suspicious ELO spike"
    },
    recentEventLog: []
  });
  const { deletes } = registerRoutes(store as RoomSnapshotStore);
  const handler = deletes.get("/api/admin/players/:id/leaderboard/freeze");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "DELETE",
      params: { id: "player-clear-freeze" },
      body: JSON.stringify({ reason: "Investigation complete" }),
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    ok: boolean;
    account: { leaderboardModerationState?: { frozenAt?: string; freezeReason?: string } };
    audit: { action: string; actorPlayerId: string; reason?: string };
  };
  const updatedAccount = await store.loadPlayerAccount("player-clear-freeze");

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.audit.action, "freeze_cleared");
  assert.equal(payload.audit.actorPlayerId, "support-moderator:admin-console");
  assert.equal(payload.audit.reason, "Investigation complete");
  assert.deepEqual(payload.account.leaderboardModerationState ?? {}, {});
  assert.deepEqual(updatedAccount?.leaderboardModerationState ?? {}, {});
  assert.equal(updatedAccount?.recentEventLog?.[0]?.id.startsWith("leaderboard:freeze_cleared:"), true);
  assert.match(updatedAccount?.recentEventLog?.[0]?.description ?? "", /Investigation complete/);
  const auditLogs = await store.listAdminAuditLogs({
    action: "leaderboard_player_unfrozen",
    targetPlayerId: "player-clear-freeze",
    limit: 1
  });
  assert.equal(auditLogs.length, 1);
  assert.match(auditLogs[0]?.metadataJson ?? "", /Investigation complete/);
});

test("DELETE /api/admin/players/:id/leaderboard/freeze returns 404 for unknown players", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const { deletes } = registerRoutes(store as RoomSnapshotStore);
  const handler = deletes.get("/api/admin/players/:id/leaderboard/freeze");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "DELETE",
      params: { id: "missing-player" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: "Player account not found" });
});

test("GET /api/admin/leaderboard/moderation-queue paginates and filters by flag type", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore({
    "player-queue-flagged": { gold: 0, wood: 0, ore: 0 },
    "player-queue-watch": { gold: 0, wood: 0, ore: 0 },
    "player-queue-frozen": { gold: 0, wood: 0, ore: 0 }
  });
  await store.savePlayerAccountProgress("player-queue-flagged", {
    leaderboardAbuseState: {
      currentDay: "2026-04-12",
      dailyEloGain: 120,
      dailyEloLoss: 0,
      status: "flagged",
      lastAlertAt: "2026-04-12T10:00:00.000Z",
      lastAlertReasons: ["daily_gain_cap_hit"]
    }
  });
  await store.savePlayerAccountProgress("player-queue-watch", {
    leaderboardAbuseState: {
      currentDay: "2026-04-12",
      dailyEloGain: 40,
      dailyEloLoss: 0,
      status: "watch",
      lastAlertAt: "2026-04-12T09:00:00.000Z",
      lastAlertReasons: ["repeated_opponent_watch"]
    }
  });
  await store.savePlayerAccountProgress("player-queue-frozen", {
    leaderboardModerationState: {
      frozenAt: "2026-04-12T08:00:00.000Z",
      frozenByPlayerId: "support-moderator:admin-console",
      freezeReason: "Manual hold"
    }
  });
  (await store.loadPlayerAccount("player-queue-flagged"))!.updatedAt = "2026-04-12T10:00:00.000Z";
  (await store.loadPlayerAccount("player-queue-watch"))!.updatedAt = "2026-04-12T09:00:00.000Z";
  (await store.loadPlayerAccount("player-queue-frozen"))!.updatedAt = "2026-04-12T08:00:00.000Z";
  const { gets } = registerRoutes(store as RoomSnapshotStore);
  const handler = gets.get("/api/admin/leaderboard/moderation-queue");
  const filteredResponse = createResponse();
  const paginatedResponse = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      url: "/api/admin/leaderboard/moderation-queue?flagType=repeated_opponent_watch&limit=10&page=1",
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    filteredResponse
  );
  await handler(
    createRequest({
      url: "/api/admin/leaderboard/moderation-queue?limit=1&page=2",
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    paginatedResponse
  );

  const filteredPayload = JSON.parse(filteredResponse.body) as {
    items: Array<{ playerId: string; flagTypes: string[] }>;
    total: number;
    flagType?: string;
  };
  const paginatedPayload = JSON.parse(paginatedResponse.body) as {
    items: Array<{ playerId: string; lastFlagAt: string }>;
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };

  assert.equal(filteredResponse.statusCode, 200);
  assert.equal(filteredPayload.flagType, "repeated_opponent_watch");
  assert.equal(filteredPayload.total, 1);
  assert.deepEqual(filteredPayload.items.map((item) => item.playerId), ["player-queue-watch"]);
  assert.deepEqual(filteredPayload.items[0]?.flagTypes, ["repeated_opponent_watch", "watch"]);

  assert.equal(paginatedResponse.statusCode, 200);
  assert.equal(paginatedPayload.page, 2);
  assert.equal(paginatedPayload.limit, 1);
  assert.equal(paginatedPayload.total, 3);
  assert.equal(paginatedPayload.totalPages, 3);
  assert.deepEqual(paginatedPayload.items.map((item) => item.playerId), ["player-queue-watch"]);
});

test("POST /api/admin/players/:id/leaderboard/remove hides a player from leaderboard output", async (t) => {
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  const { posts } = registerRoutes(store as RoomSnapshotStore);
  const handler = posts.get("/api/admin/players/:id/leaderboard/remove");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-hidden" },
      body: JSON.stringify({ reason: "Leaderboard manipulation investigation" }),
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    response
  );

  const payload = JSON.parse(response.body) as {
    ok: boolean;
    account: { leaderboardModerationState?: { hiddenByPlayerId?: string; hiddenReason?: string; hiddenAt?: string } };
  };

  assert.equal(response.statusCode, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.account.leaderboardModerationState?.hiddenByPlayerId, "support-moderator:admin-console");
  assert.equal(payload.account.leaderboardModerationState?.hiddenReason, "Leaderboard manipulation investigation");
  assert.ok(payload.account.leaderboardModerationState?.hiddenAt);
  const auditLogs = await store.listAdminAuditLogs({
    action: "leaderboard_player_removed",
    targetPlayerId: "player-hidden",
    limit: 1
  });
  assert.equal(auditLogs.length, 1);
  assert.match(auditLogs[0]?.metadataJson ?? "", /Leaderboard manipulation investigation/);
});

test("support moderators can hide and inspect guild moderation audit", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.saveGuild(
    normalizeGuildState({
      id: "guild-admin-1",
      name: "Nightwatch",
      tag: "NW",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
      memberLimit: 20,
      level: 1,
      xp: 0,
      members: [{ playerId: "founder-1", displayName: "Founder", role: "owner", joinedAt: "2026-04-11T00:00:00.000Z" }],
      joinRequests: [],
      invites: []
    })
  );
  await store.appendGuildAuditLog({
    guildId: "guild-admin-1",
    action: "created",
    actorPlayerId: "founder-1",
    occurredAt: "2026-04-11T00:00:00.000Z",
    name: "Nightwatch",
    tag: "NW"
  });
  const { gets, posts } = registerRoutes(store as RoomSnapshotStore);
  const hideHandler = posts.get("/api/admin/guilds/:id/hide");
  const getHandler = gets.get("/api/admin/guilds/:id");
  assert.ok(hideHandler);
  assert.ok(getHandler);

  const hideResponse = createResponse();
  await hideHandler(
    createRequest({
      method: "POST",
      params: { id: "guild-admin-1" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ reason: "违规名称巡检下架" })
    }),
    hideResponse
  );

  assert.equal(hideResponse.statusCode, 200);
  const hiddenPayload = JSON.parse(hideResponse.body) as { guild: GuildState };
  assert.equal(hiddenPayload.guild.moderation?.isHidden, true);
  assert.equal(hiddenPayload.guild.moderation?.hiddenReason, "违规名称巡检下架");

  const getResponse = createResponse();
  await getHandler(
    createRequest({
      params: { id: "guild-admin-1" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    getResponse
  );

  assert.equal(getResponse.statusCode, 200);
  const getPayload = JSON.parse(getResponse.body) as {
    guild: GuildState;
    audit: Array<{ action: string; actorPlayerId: string; reason?: string; guildId: string; name: string; tag: string }>;
  };
  assert.equal(getPayload.guild.moderation?.isHidden, true);
  assert.equal(getPayload.audit[0]?.action, "hidden");
  assert.equal(getPayload.audit[0]?.actorPlayerId, "support-moderator:admin-console");
  assert.equal(getPayload.audit[0]?.reason, "违规名称巡检下架");
  assert.equal(getPayload.audit[0]?.guildId, "guild-admin-1");
  assert.equal(getPayload.audit[0]?.name, "Nightwatch");
  assert.equal(getPayload.audit[0]?.tag, "NW");
  const audit = await store.listGuildAuditLogs({ guildId: "guild-admin-1" });
  assert.equal(audit[0]?.action, "hidden");
  assert.equal(audit[1]?.action, "created");
  assert.equal(audit[1]?.actorPlayerId, "founder-1");
  const adminAudit = await store.listAdminAuditLogs({ action: "guild_hidden", targetScope: "guild-moderation", limit: 1 });
  assert.equal(adminAudit.length, 1);
  assert.equal(adminAudit[0]?.actorRole, "support-moderator");
  assert.match(adminAudit[0]?.afterJson ?? "", /guild-admin-1/);
});

test("support moderators can delete guilds without removing audit history", async (t) => {
  withAdminSecret(t);
  const { moderator } = withSupportSecrets(t);
  const store = createStore();
  await store.saveGuild(
    normalizeGuildState({
      id: "guild-admin-delete",
      name: "Spammy",
      tag: "SPM",
      createdAt: "2026-04-11T00:00:00.000Z",
      updatedAt: "2026-04-11T00:00:00.000Z",
      memberLimit: 20,
      level: 1,
      xp: 0,
      members: [{ playerId: "founder-delete", displayName: "Founder Delete", role: "owner", joinedAt: "2026-04-11T00:00:00.000Z" }],
      joinRequests: [],
      invites: []
    })
  );
  await store.appendGuildAuditLog({
    guildId: "guild-admin-delete",
    action: "created",
    actorPlayerId: "founder-delete",
    occurredAt: "2026-04-11T00:00:00.000Z",
    name: "Spammy",
    tag: "SPM"
  });
  const { posts, gets } = registerRoutes(store as RoomSnapshotStore);
  const deleteHandler = posts.get("/api/admin/guilds/:id/delete");
  const getHandler = gets.get("/api/admin/guilds/:id");
  assert.ok(deleteHandler);
  assert.ok(getHandler);

  const deleteResponse = createResponse();
  await deleteHandler(
    createRequest({
      method: "POST",
      params: { id: "guild-admin-delete" },
      headers: {
        "x-veil-admin-secret": moderator
      },
      body: JSON.stringify({ reason: "spam cleanup" })
    }),
    deleteResponse
  );

  assert.equal(deleteResponse.statusCode, 200);
  assert.equal((await store.loadGuild("guild-admin-delete")) === null, true);

  const getResponse = createResponse();
  await getHandler(
    createRequest({
      params: { id: "guild-admin-delete" },
      headers: {
        "x-veil-admin-secret": moderator
      }
    }),
    getResponse
  );

  assert.equal(getResponse.statusCode, 400);
  assert.match(getResponse.body, /guild_not_found/);
  const audit = await store.listGuildAuditLogs({ guildId: "guild-admin-delete" });
  assert.equal(audit[0]?.action, "deleted");
  assert.equal(audit[0]?.reason, "spam cleanup");
  assert.equal(audit[1]?.action, "created");
  const adminAudit = await store.listAdminAuditLogs({ action: "guild_deleted", targetScope: "guild-moderation", limit: 1 });
  assert.equal(adminAudit.length, 1);
  assert.equal(adminAudit[0]?.actorRole, "support-moderator");
  assert.match(adminAudit[0]?.afterJson ?? "", /guild-admin-delete/);
});

test("POST /api/admin/players/:id/resources returns 413 when content-length declares a 2 MB body", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes(null);
  const handler = posts.get("/api/admin/players/:id/resources");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-413" },
      headers: {
        "x-veil-admin-secret": secret,
        "content-length": String(2 * 1024 * 1024)
      }
    }),
    response
  );

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error, `Request body exceeds ${32 * 1024} bytes`);
});

test("POST /api/admin/players/:id/resources returns 413 when streamed body exceeds 32 KB", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes(null);
  const handler = posts.get("/api/admin/players/:id/resources");
  const response = createResponse();

  assert.ok(handler);
  await handler(
    createRequest({
      method: "POST",
      params: { id: "player-413-stream" },
      headers: { "x-veil-admin-secret": secret },
      body: "x".repeat(33 * 1024)
    }),
    response
  );

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error, `Request body exceeds ${32 * 1024} bytes`);
});

test("POST /api/admin/players/:id/resources returns 413 immediately when content-length is oversized without waiting for body stream to end", async (t) => {
  const secret = withAdminSecret(t);
  const { posts } = registerRoutes(null);
  const handler = posts.get("/api/admin/players/:id/resources");
  const response = createResponse();

  assert.ok(handler);

  // Create an async iterable that never ends — simulates a slow-loris upload.
  // The handler must return 413 before the stream finishes.
  async function* neverEndingBody() {
    await new Promise<void>(() => {}); // hangs forever, never yields
  }

  const request = neverEndingBody() as unknown as IncomingMessage & { params: Record<string, string> };
  Object.assign(request, {
    method: "POST",
    headers: {
      "x-veil-admin-secret": secret,
      "content-length": String(2 * 1024 * 1024)
    },
    params: { id: "player-413-fast" }
  });

  await handler(request, response);

  assert.equal(response.statusCode, 413);
  assert.equal(JSON.parse(response.body).error, `Request body exceeds ${32 * 1024} bytes`);
});
