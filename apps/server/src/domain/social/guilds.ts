import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { GuildState } from "@veil/shared/models";
import { findDisplayNameModerationViolation } from "@veil/shared/platform";
import type { GuildCreateAction } from "@veil/shared/protocol";
import { createGuild, createGuildRosterView, createGuildSummaryView, type GuildChatMessage, type GuildChatSendAction, type GuildMembershipEvent, joinGuild, leaveGuild, validateGuildChatMessageContentOrThrow } from "@veil/shared/social";
import { validateAuthSessionFromRequest } from "@server/domain/account/auth";
import { loadDisplayNameValidationRules } from "@server/domain/account/display-name-rules";
import { recordHttpRateLimited } from "@server/domain/ops/observability";
import { resolveTrustedRequestIp } from "@server/infra/request-ip";
import type { GuildAuditLogRecord, GuildChatMessageRecord, RoomSnapshotStore } from "@server/persistence";

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

class PayloadTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Request body exceeds ${maxBytes} bytes`);
    this.name = "payload_too_large";
  }
}

const MAX_JSON_BODY_BYTES = 16 * 1024;
const GUILD_CREATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const GUILD_CREATE_MAX_PER_WINDOW = 2;
const DEFAULT_GUILD_CHAT_HISTORY_LIMIT = 50;
const MAX_GUILD_CHAT_HISTORY_LIMIT = 50;
const DEFAULT_GUILD_CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_GUILD_CHAT_MESSAGE_RATE_LIMIT_MAX = 10;
const DEFAULT_GUILD_CHAT_MESSAGE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface GuildChatEventEnvelope {
  type: "guild.chat.message" | "guild.chat.deleted";
  guildId: string;
  message?: GuildChatMessage;
  messageId?: string;
}

type GuildChatRealtimeListener = (event: GuildChatEventEnvelope) => void;

export interface GuildChatRealtimeTransport {
  subscribe(topic: string, callback: (message: unknown) => void): Promise<unknown> | unknown;
  unsubscribe(topic: string, callback?: (message: unknown) => void): Promise<unknown> | unknown;
  publish(topic: string, data: unknown): Promise<unknown> | unknown;
}

const GUILD_CHAT_REALTIME_TOPIC_PREFIX = "veil:guild-chat";

function buildGuildChatRealtimeTopic(guildId: string): string {
  return `${GUILD_CHAT_REALTIME_TOPIC_PREFIX}:${guildId.trim()}`;
}

function decodeGuildChatRealtimeEvent(payload: unknown): GuildChatEventEnvelope | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const event = payload as Partial<GuildChatEventEnvelope>;
  const guildId = typeof event.guildId === "string" ? event.guildId.trim() : "";
  if (!guildId) {
    return null;
  }

  if (event.type === "guild.chat.message" && event.message) {
    return {
      type: event.type,
      guildId,
      message: event.message
    };
  }

  if (event.type === "guild.chat.deleted" && typeof event.messageId === "string") {
    return {
      type: event.type,
      guildId,
      messageId: event.messageId
    };
  }

  return null;
}

function readGuildChatMessageRateLimitWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.VEIL_GUILD_CHAT_RATE_LIMIT_WINDOW_MS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_GUILD_CHAT_MESSAGE_RATE_LIMIT_WINDOW_MS;
}

function readGuildChatMessageRateLimitMax(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number(env.VEIL_GUILD_CHAT_RATE_LIMIT_MAX);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_GUILD_CHAT_MESSAGE_RATE_LIMIT_MAX;
}

function readGuildChatMessageTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const ttlDays = Number(env.VEIL_GUILD_CHAT_TTL_DAYS);
  if (Number.isFinite(ttlDays) && ttlDays > 0) {
    return Math.floor(ttlDays * 24 * 60 * 60 * 1000);
  }

  const ttlMs = Number(env.VEIL_GUILD_CHAT_TTL_MS);
  return Number.isFinite(ttlMs) && ttlMs > 0 ? Math.floor(ttlMs) : DEFAULT_GUILD_CHAT_MESSAGE_TTL_MS;
}

function parseChatLimit(request: IncomingMessage): number {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = Number(url.searchParams.get("limit"));
  if (!Number.isFinite(value)) {
    return DEFAULT_GUILD_CHAT_HISTORY_LIMIT;
  }

  return Math.max(1, Math.min(MAX_GUILD_CHAT_HISTORY_LIMIT, Math.floor(value)));
}

function parseChatBeforeCursor(request: IncomingMessage): string | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("before")?.trim();
  return value ? value : undefined;
}

function encodeGuildChatCursor(message: Pick<GuildChatMessage, "createdAt" | "messageId">): string {
  return `${message.createdAt}|${message.messageId}`;
}

function toGuildChatMessage(record: GuildChatMessageRecord): GuildChatMessage {
  return { ...record };
}

function resolveRequestIp(request: Pick<IncomingMessage, "headers" | "socket">): string {
  return resolveTrustedRequestIp(request);
}

class GuildChatRateLimiter {
  private readonly counters = new Map<string, number[]>();
  private readonly windowMs = readGuildChatMessageRateLimitWindowMs();
  private readonly max = readGuildChatMessageRateLimitMax();

  consume(playerId: string, request: Pick<IncomingMessage, "headers" | "socket">): RateLimitResult {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const key = `${playerId.trim()}:${resolveRequestIp(request)}`;
    const timestamps = (this.counters.get(key) ?? []).filter((timestamp) => timestamp > windowStart);
    if (timestamps.length >= this.max) {
      this.counters.set(key, timestamps);
      const oldestTimestamp = timestamps[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((oldestTimestamp + this.windowMs - now) / 1000))
      };
    }

    timestamps.push(now);
    this.counters.set(key, timestamps);
    return { allowed: true };
  }
}

class GuildChatRealtimeHub {
  private readonly subscribers = new Map<string, Set<GuildChatRealtimeListener>>();
  private readonly transportHandlers = new Map<string, (message: unknown) => void>();
  private readonly transportSubscriptions = new Map<string, Promise<void>>();

  constructor(private readonly transport?: GuildChatRealtimeTransport | null) {}

  async subscribe(guildId: string, listener: GuildChatRealtimeListener): Promise<() => void> {
    const normalizedGuildId = guildId.trim();
    const listeners = this.subscribers.get(normalizedGuildId) ?? new Set<GuildChatRealtimeListener>();
    listeners.add(listener);
    this.subscribers.set(normalizedGuildId, listeners);

    if (this.transport) {
      let subscription = this.transportSubscriptions.get(normalizedGuildId);
      if (!subscription) {
        const handler = (message: unknown): void => {
          const event = decodeGuildChatRealtimeEvent(message);
          if (!event || event.guildId !== normalizedGuildId) {
            return;
          }

          this.publishLocal(event);
        };
        this.transportHandlers.set(normalizedGuildId, handler);
        subscription = Promise.resolve(this.transport.subscribe(buildGuildChatRealtimeTopic(normalizedGuildId), handler))
          .then(() => undefined)
          .catch((error) => {
            this.transportHandlers.delete(normalizedGuildId);
            this.transportSubscriptions.delete(normalizedGuildId);
            throw error;
          });
        this.transportSubscriptions.set(normalizedGuildId, subscription);
      }
      try {
        await subscription;
      } catch (error) {
        const activeListeners = this.subscribers.get(normalizedGuildId);
        activeListeners?.delete(listener);
        if (activeListeners?.size === 0) {
          this.subscribers.delete(normalizedGuildId);
        }
        throw error;
      }
    }

    return () => {
      const activeListeners = this.subscribers.get(normalizedGuildId);
      if (!activeListeners) {
        return;
      }

      activeListeners.delete(listener);
      if (activeListeners.size === 0) {
        this.subscribers.delete(normalizedGuildId);
        const handler = this.transportHandlers.get(normalizedGuildId);
        if (handler) {
          this.transportHandlers.delete(normalizedGuildId);
          this.transportSubscriptions.delete(normalizedGuildId);
          void Promise.resolve(
            this.transport?.unsubscribe(buildGuildChatRealtimeTopic(normalizedGuildId), handler)
          ).catch(() => undefined);
        }
      }
    };
  }

  async publish(event: GuildChatEventEnvelope): Promise<void> {
    const normalizedEvent = { ...event, guildId: event.guildId.trim() };
    if (this.transport) {
      await this.transport.publish(buildGuildChatRealtimeTopic(normalizedEvent.guildId), normalizedEvent);
      return;
    }

    this.publishLocal(normalizedEvent);
  }

  private publishLocal(event: GuildChatEventEnvelope): void {
    for (const listener of this.subscribers.get(event.guildId.trim()) ?? []) {
      listener(event);
    }
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    request.resume();
    throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > MAX_JSON_BODY_BYTES) {
      throw new PayloadTooLargeError(MAX_JSON_BODY_BYTES);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseLimit(request: IncomingMessage): number | undefined {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const value = url.searchParams.get("limit");
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function requireAuthSession(
  request: IncomingMessage,
  response: ServerResponse,
  store: RoomSnapshotStore | null
): Promise<{ playerId: string; displayName: string } | null> {
  const result = await validateAuthSessionFromRequest(request, store);
  if (result.session) {
    return result.session;
  }

  if (result.errorCode === "account_banned") {
    sendJson(response, 403, {
      error: {
        code: "account_banned",
        message: "Account is banned",
        reason: result.ban?.banReason ?? "No reason provided",
        ...(result.ban?.banExpiry ? { expiry: result.ban.banExpiry } : {})
      }
    });
    return null;
  }

  sendJson(response, 401, {
    error: {
      code: result.errorCode ?? "unauthorized",
      message: "Authentication required"
    }
  });
  return null;
}

function mapGuildError(error: unknown): { status: number; code: string; message: string } {
  const message = error instanceof Error ? error.message : String(error);

  if (
    error instanceof SyntaxError ||
    /guild_create_.*required|guild_create_.*blocked|guild_join_player_required|guild_leave_player_required|guild_chat_message_required|guild_chat_message_too_long|guild_chat_message_html_not_allowed|beforeCursor|payload_too_large|Unexpected token/.test(
      message
    )
  ) {
    return { status: 400, code: "invalid_request", message };
  }
  if (error instanceof Error && error.name === "guild_chat_content_violation") {
    return { status: 400, code: "guild_chat_content_violation", message };
  }
  if (/guild_not_found/.test(message)) {
    return { status: 404, code: "guild_not_found", message };
  }
  if (/guild_chat_message_not_found/.test(message)) {
    return { status: 404, code: "guild_chat_message_not_found", message };
  }
  if (/guild_chat_forbidden|guild_chat_delete_forbidden/.test(message)) {
    return { status: 403, code: "guild_chat_forbidden", message };
  }
  if (/guild_member_not_found|guild_leave_member_not_found/.test(message)) {
    return { status: 409, code: "guild_membership_invalid", message };
  }
  if (/guild_already_member|guild_join_already_member|guild_member_limit_reached|guild_tag_taken/.test(message)) {
    return { status: 409, code: "guild_conflict", message };
  }
  if (/guild_store_unavailable/.test(message)) {
    return { status: 503, code: "guild_store_unavailable", message };
  }
  if (/guild_create_rate_limited/.test(message)) {
    return { status: 429, code: "guild_create_rate_limited", message };
  }
  if (/guild_chat_rate_limited/.test(message)) {
    return { status: 429, code: "guild_chat_rate_limited", message };
  }

  return { status: 500, code: "guild_error", message };
}

function isGuildHidden(guild: GuildState): boolean {
  return guild.moderation?.isHidden === true;
}

function ensureGuildPubliclyVisible(guild: GuildState): GuildState {
  if (isGuildHidden(guild)) {
    throw new Error("guild_not_found");
  }
  return guild;
}

function validateGuildCreateModeration(action: GuildCreateAction): void {
  if (!action.name.trim() || !action.tag.trim()) {
    return;
  }

  const nameViolation = findDisplayNameModerationViolation(action.name);
  if (nameViolation) {
    throw new Error(`guild_create_name_blocked: Guild name contains blocked content (${nameViolation.term})`);
  }
  const tagViolation = findDisplayNameModerationViolation(action.tag);
  if (tagViolation) {
    throw new Error(`guild_create_tag_blocked: Guild tag contains blocked content (${tagViolation.term})`);
  }
}

export class GuildService {
  constructor(
    private readonly store: RoomSnapshotStore | null,
    private readonly guildChatRateLimiter = new GuildChatRateLimiter()
  ) {}

  private requireStore(): {
    ensurePlayerAccount: RoomSnapshotStore["ensurePlayerAccount"];
    appendGuildAuditLog: NonNullable<RoomSnapshotStore["appendGuildAuditLog"]>;
    listGuildAuditLogs: NonNullable<RoomSnapshotStore["listGuildAuditLogs"]>;
    loadGuild: NonNullable<RoomSnapshotStore["loadGuild"]>;
    loadGuildByMemberPlayerId: NonNullable<RoomSnapshotStore["loadGuildByMemberPlayerId"]>;
    listGuilds: NonNullable<RoomSnapshotStore["listGuilds"]>;
    saveGuild: NonNullable<RoomSnapshotStore["saveGuild"]>;
    deleteGuild: NonNullable<RoomSnapshotStore["deleteGuild"]>;
  } {
    if (
      !this.store ||
      !this.store.appendGuildAuditLog ||
      !this.store.listGuildAuditLogs ||
      !this.store.loadGuild ||
      !this.store.loadGuildByMemberPlayerId ||
      !this.store.listGuilds ||
      !this.store.saveGuild ||
      !this.store.deleteGuild
    ) {
      throw new Error("guild_store_unavailable");
    }

    return {
      ensurePlayerAccount: this.store.ensurePlayerAccount.bind(this.store),
      appendGuildAuditLog: this.store.appendGuildAuditLog.bind(this.store),
      listGuildAuditLogs: this.store.listGuildAuditLogs.bind(this.store),
      loadGuild: this.store.loadGuild.bind(this.store),
      loadGuildByMemberPlayerId: this.store.loadGuildByMemberPlayerId.bind(this.store),
      listGuilds: this.store.listGuilds.bind(this.store),
      saveGuild: this.store.saveGuild.bind(this.store),
      deleteGuild: this.store.deleteGuild.bind(this.store)
    };
  }

  private requireChatStore(): {
    createGuildChatMessage: NonNullable<RoomSnapshotStore["createGuildChatMessage"]>;
    deleteGuildChatMessage: NonNullable<RoomSnapshotStore["deleteGuildChatMessage"]>;
    listGuildChatMessages: NonNullable<RoomSnapshotStore["listGuildChatMessages"]>;
    loadGuildChatMessage: NonNullable<RoomSnapshotStore["loadGuildChatMessage"]>;
  } {
    if (
      !this.store ||
      !this.store.createGuildChatMessage ||
      !this.store.deleteGuildChatMessage ||
      !this.store.listGuildChatMessages ||
      !this.store.loadGuildChatMessage
    ) {
      throw new Error("guild_store_unavailable");
    }

    return {
      createGuildChatMessage: this.store.createGuildChatMessage.bind(this.store),
      deleteGuildChatMessage: this.store.deleteGuildChatMessage.bind(this.store),
      listGuildChatMessages: this.store.listGuildChatMessages.bind(this.store),
      loadGuildChatMessage: this.store.loadGuildChatMessage.bind(this.store)
    };
  }

  async listGuilds(limit?: number): Promise<GuildState[]> {
    const store = this.requireStore();
    return (await store.listGuilds({ ...(limit != null ? { limit } : {}) })).filter((guild) => !isGuildHidden(guild));
  }

  async getGuild(guildId: string): Promise<GuildState> {
    const store = this.requireStore();
    const guild = await store.loadGuild(guildId);
    if (!guild) {
      throw new Error("guild_not_found");
    }

    return ensureGuildPubliclyVisible(guild);
  }

  async getGuildForAdmin(guildId: string): Promise<GuildState> {
    const store = this.requireStore();
    const guild = await store.loadGuild(guildId);
    if (!guild) {
      throw new Error("guild_not_found");
    }

    return guild;
  }

  async listGuildAuditLogs(guildId: string, limit?: number): Promise<GuildAuditLogRecord[]> {
    const store = this.requireStore();
    return store.listGuildAuditLogs({
      guildId,
      ...(limit != null ? { limit } : {})
    });
  }

  private async requireGuildMembership(guildId: string, playerId: string): Promise<GuildState> {
    const store = this.requireStore();
    const guild = await store.loadGuild(guildId);
    if (!guild) {
      throw new Error("guild_not_found");
    }

    ensureGuildPubliclyVisible(guild);
    if (!guild.members.some((member) => member.playerId === playerId.trim())) {
      throw new Error("guild_chat_forbidden");
    }

    return guild;
  }

  async listGuildChatMessagesForPlayer(
    authSession: { playerId: string; displayName: string },
    guildId: string,
    options: { beforeCursor?: string; limit?: number } = {}
  ): Promise<{ items: GuildChatMessage[]; nextCursor?: string }> {
    const store = this.requireChatStore();
    await this.requireGuildMembership(guildId, authSession.playerId);
    const items = (
      await store.listGuildChatMessages({
        guildId,
        ...(options.beforeCursor ? { beforeCursor: options.beforeCursor } : {}),
        ...(options.limit != null ? { limit: options.limit } : {})
      })
    ).map((record) => toGuildChatMessage(record));

    const lastMessage = items.at(-1);
    return {
      items,
      ...(lastMessage ? { nextCursor: encodeGuildChatCursor(lastMessage) } : {})
    };
  }

  async createGuildChatMessageForPlayer(
    authSession: { playerId: string; displayName: string },
    guildId: string,
    action: GuildChatSendAction,
    request: Pick<IncomingMessage, "headers" | "socket">
  ): Promise<GuildChatMessage> {
    const store = this.requireChatStore();
    const baseStore = this.requireStore();
    await baseStore.ensurePlayerAccount({
      playerId: authSession.playerId,
      displayName: authSession.displayName
    });
    const guild = await this.requireGuildMembership(guildId, authSession.playerId);
    const normalizedContent = validateGuildChatMessageContentOrThrow(
      typeof action.content === "string" ? action.content : "",
      loadDisplayNameValidationRules()
    );
    const rateLimitResult = this.guildChatRateLimiter.consume(authSession.playerId, request);
    if (!rateLimitResult.allowed) {
      throw new Error(`guild_chat_rate_limited: retry after ${rateLimitResult.retryAfterSeconds ?? 1} seconds`);
    }

    const message = await store.createGuildChatMessage({
      guildId: guild.id,
      authorPlayerId: authSession.playerId,
      authorDisplayName: authSession.displayName,
      content: normalizedContent,
      expiresAt: new Date(Date.now() + readGuildChatMessageTtlMs()).toISOString()
    });
    return toGuildChatMessage(message);
  }

  async deleteGuildChatMessageForPlayer(
    authSession: { playerId: string; displayName: string },
    guildId: string,
    messageId: string
  ): Promise<{ messageId: string }> {
    const store = this.requireChatStore();
    const guild = await this.requireGuildMembership(guildId, authSession.playerId);
    const message = await store.loadGuildChatMessage(guild.id, messageId);
    if (!message) {
      throw new Error("guild_chat_message_not_found");
    }

    const actorMembership = guild.members.find((member) => member.playerId === authSession.playerId);
    const canDelete = actorMembership?.role === "owner" || message.authorPlayerId === authSession.playerId;
    if (!canDelete) {
      throw new Error("guild_chat_delete_forbidden");
    }

    const deleted = await store.deleteGuildChatMessage(guild.id, message.messageId);
    if (!deleted) {
      throw new Error("guild_chat_message_not_found");
    }

    return { messageId: message.messageId };
  }

  async createGuildForPlayer(
    authSession: { playerId: string; displayName: string },
    action: GuildCreateAction
  ): Promise<GuildState> {
    const store = this.requireStore();
    validateGuildCreateModeration(action);
    await store.ensurePlayerAccount({
      playerId: authSession.playerId,
      displayName: authSession.displayName
    });

    const existingGuild = await store.loadGuildByMemberPlayerId(authSession.playerId);
    if (existingGuild) {
      throw new Error("guild_already_member");
    }

    const recentCreations = await store.listGuildAuditLogs({
      actorPlayerId: authSession.playerId,
      since: new Date(Date.now() - GUILD_CREATE_WINDOW_MS).toISOString(),
      limit: GUILD_CREATE_MAX_PER_WINDOW + 1
    });
    const createCount = recentCreations.filter((entry) => entry.action === "created").length;
    if (createCount >= GUILD_CREATE_MAX_PER_WINDOW) {
      throw new Error(
        `guild_create_rate_limited: Guild creation is limited to ${GUILD_CREATE_MAX_PER_WINDOW} per 24 hours`
      );
    }

    const existingTag = (await store.listGuilds({ limit: 200 })).find(
      (guild) => guild.tag.toUpperCase() === action.tag.trim().toUpperCase()
    );
    if (existingTag) {
      throw new Error("guild_tag_taken");
    }

    const created = createGuild({
      ownerPlayerId: authSession.playerId,
      ownerDisplayName: authSession.displayName,
      guildId: `guild-${randomUUID()}`,
      name: action.name,
      tag: action.tag,
      ...(action.description != null ? { description: action.description } : {}),
      ...(action.memberLimit != null ? { memberLimit: action.memberLimit } : {})
    });

    const saved = await store.saveGuild(created.guild);
    await store.appendGuildAuditLog({
      guildId: saved.id,
      action: "created",
      actorPlayerId: authSession.playerId,
      occurredAt: saved.createdAt,
      name: saved.name,
      tag: saved.tag
    });
    return saved;
  }

  async joinGuildForPlayer(authSession: { playerId: string; displayName: string }, guildId: string): Promise<GuildState> {
    const store = this.requireStore();
    await store.ensurePlayerAccount({
      playerId: authSession.playerId,
      displayName: authSession.displayName
    });

    const existingGuild = await store.loadGuildByMemberPlayerId(authSession.playerId);
    if (existingGuild) {
      if (existingGuild.id === guildId.trim()) {
        throw new Error("guild_join_already_member");
      }
      throw new Error("guild_already_member");
    }

    const guild = await store.loadGuild(guildId);
    if (!guild) {
      throw new Error("guild_not_found");
    }
    ensureGuildPubliclyVisible(guild);

    const joined = joinGuild(guild, {
      playerId: authSession.playerId,
      displayName: authSession.displayName
    });
    return store.saveGuild(joined.guild);
  }

  async leaveGuildForPlayer(authSession: { playerId: string; displayName: string }, guildId: string): Promise<{
    guild: GuildState;
    deleted: boolean;
    events: GuildMembershipEvent[];
  }> {
    const store = this.requireStore();
    const guild = await store.loadGuild(guildId);
    if (!guild) {
      throw new Error("guild_not_found");
    }

    if (!guild.members.some((member) => member.playerId === authSession.playerId)) {
      throw new Error("guild_leave_member_not_found");
    }

    const result = leaveGuild(guild, {
      playerId: authSession.playerId
    });
    if (result.deleted) {
      await store.deleteGuild(guild.id);
      return { guild: result.guild, events: result.events, deleted: true };
    }

    return {
      guild: await store.saveGuild(result.guild),
      events: result.events,
      deleted: false
    };
  }

  async hideGuild(guildId: string, actorPlayerId: string, reason?: string): Promise<GuildState> {
    const store = this.requireStore();
    const guild = await this.getGuildForAdmin(guildId);
    const nextGuild: GuildState = {
      ...guild,
      moderation: {
        isHidden: true,
        hiddenAt: new Date().toISOString(),
        hiddenByPlayerId: actorPlayerId.trim(),
        ...(reason?.trim() ? { hiddenReason: reason.trim() } : {})
      }
    };
    const saved = await store.saveGuild(nextGuild);
    await store.appendGuildAuditLog({
      guildId: saved.id,
      action: "hidden",
      actorPlayerId,
      name: saved.name,
      tag: saved.tag,
      ...(reason?.trim() ? { reason: reason.trim() } : {})
    });
    return saved;
  }

  async unhideGuild(guildId: string, actorPlayerId: string, reason?: string): Promise<GuildState> {
    const store = this.requireStore();
    const guild = await this.getGuildForAdmin(guildId);
    const nextGuild: GuildState = {
      ...guild,
      moderation: {
        isHidden: false
      }
    };
    const saved = await store.saveGuild(nextGuild);
    await store.appendGuildAuditLog({
      guildId: saved.id,
      action: "unhidden",
      actorPlayerId,
      name: saved.name,
      tag: saved.tag,
      ...(reason?.trim() ? { reason: reason.trim() } : {})
    });
    return saved;
  }

  async deleteGuildAsAdmin(guildId: string, actorPlayerId: string, reason?: string): Promise<void> {
    const store = this.requireStore();
    const guild = await this.getGuildForAdmin(guildId);
    await store.appendGuildAuditLog({
      guildId: guild.id,
      action: "deleted",
      actorPlayerId,
      name: guild.name,
      tag: guild.tag,
      ...(reason?.trim() ? { reason: reason.trim() } : {})
    });
    await store.deleteGuild(guild.id);
  }
}

export function registerGuildRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null,
  options: { chatRealtimeTransport?: GuildChatRealtimeTransport | null } = {}
): void {
  const service = new GuildService(store);
  const guildChatHub = new GuildChatRealtimeHub(options.chatRealtimeTransport);

  app.use((request, response, next) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Veil-Auth");

    if (request.method === "OPTIONS") {
      response.statusCode = 204;
      response.end();
      return;
    }

    next();
  });

  app.get("/api/guilds", async (request, response) => {
    try {
      const items = await service.listGuilds(parseLimit(request));
      sendJson(response, 200, {
        items: items.map((guild) => createGuildSummaryView(guild))
      });
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.get("/api/guilds/:guildId", async (request, response) => {
    try {
      const guildId = request.params.guildId ?? "";
      const guild = await service.getGuild(guildId);
      sendJson(response, 200, {
        guild: createGuildSummaryView(guild)
      });
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.get("/api/guilds/:guildId/roster", async (request, response) => {
    try {
      const guildId = request.params.guildId ?? "";
      const guild = await service.getGuild(guildId);
      sendJson(response, 200, {
        roster: createGuildRosterView(guild)
      });
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.get("/api/guilds/:guildId/chat", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const guildId = request.params.guildId ?? "";
      const beforeCursor = parseChatBeforeCursor(request);
      const result = await service.listGuildChatMessagesForPlayer(authSession, guildId, {
        limit: parseChatLimit(request),
        ...(beforeCursor ? { beforeCursor } : {})
      });
      sendJson(response, 200, result);
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.get("/api/guilds/:guildId/chat/stream", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const guildId = request.params.guildId ?? "";
      await service.listGuildChatMessagesForPlayer(authSession, guildId, { limit: 1 });
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.setHeader("X-Accel-Buffering", "no");

      const writeEvent = (event: GuildChatEventEnvelope): void => {
        response.write(`event: ${event.type}\n`);
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const unsubscribe = await guildChatHub.subscribe(guildId, writeEvent);
      response.flushHeaders?.();
      response.write(": connected\n\n");
      const heartbeat = setInterval(() => {
        response.write(": keepalive\n\n");
      }, 25_000);
      heartbeat.unref?.();

      const close = (): void => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      request.once("close", close);
      response.once("close", close);
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.post("/api/guilds", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const payload = (await readJsonBody(request)) as GuildCreateAction;
      const guild = await service.createGuildForPlayer(authSession, payload);
      sendJson(response, 201, {
        guild: createGuildSummaryView(guild),
        roster: createGuildRosterView(guild)
      });
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.post("/api/guilds/:guildId/join", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const guildId = request.params.guildId ?? "";
      const guild = await service.joinGuildForPlayer(authSession, guildId);
      sendJson(response, 200, {
        guild: createGuildSummaryView(guild),
        roster: createGuildRosterView(guild)
      });
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.post("/api/guilds/:guildId/leave", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const guildId = request.params.guildId ?? "";
      const result = await service.leaveGuildForPlayer(authSession, guildId);
      sendJson(
        response,
        200,
        result.deleted
          ? {
              guildId,
              events: result.events,
              deleted: true
            }
          : {
              guild: createGuildSummaryView(result.guild),
              roster: createGuildRosterView(result.guild),
              events: result.events,
              deleted: false
            }
      );
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.post("/api/guilds/:guildId/chat", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const guildId = request.params.guildId ?? "";
      const payload = (await readJsonBody(request)) as GuildChatSendAction;
      const message = await service.createGuildChatMessageForPlayer(authSession, guildId, payload, request);
      await guildChatHub.publish({
        type: "guild.chat.message",
        guildId,
        message
      });
      sendJson(response, 201, { message });
    } catch (error) {
      const mapped = mapGuildError(error);
      if (mapped.status === 429) {
        recordHttpRateLimited();
      }
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });

  app.post("/api/guilds/:guildId/chat/:messageId/delete", async (request, response) => {
    const authSession = await requireAuthSession(request, response, store);
    if (!authSession) {
      return;
    }

    try {
      const guildId = request.params.guildId ?? "";
      const messageId = request.params.messageId ?? "";
      const deleted = await service.deleteGuildChatMessageForPlayer(authSession, guildId, messageId);
      await guildChatHub.publish({
        type: "guild.chat.deleted",
        guildId,
        messageId: deleted.messageId
      });
      sendJson(response, 200, { deleted: true, ...deleted });
    } catch (error) {
      const mapped = mapGuildError(error);
      sendJson(response, mapped.status, { error: { code: mapped.code, message: mapped.message } });
    }
  });
}
