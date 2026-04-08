import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createGuild,
  createGuildRosterView,
  createGuildSummaryView,
  joinGuild,
  leaveGuild,
  type GuildCreateAction,
  type GuildState
} from "../../../packages/shared/src/index";
import { validateAuthSessionFromRequest } from "./auth";
import type { RoomSnapshotStore } from "./persistence";

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
    /guild_create_.*required|guild_join_player_required|guild_leave_player_required|payload_too_large|Unexpected token/.test(
      message
    )
  ) {
    return { status: 400, code: "invalid_request", message };
  }
  if (/guild_not_found/.test(message)) {
    return { status: 404, code: "guild_not_found", message };
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

  return { status: 500, code: "guild_error", message };
}

class GuildService {
  constructor(private readonly store: RoomSnapshotStore | null) {}

  private requireStore(): {
    ensurePlayerAccount: RoomSnapshotStore["ensurePlayerAccount"];
    loadGuild: NonNullable<RoomSnapshotStore["loadGuild"]>;
    loadGuildByMemberPlayerId: NonNullable<RoomSnapshotStore["loadGuildByMemberPlayerId"]>;
    listGuilds: NonNullable<RoomSnapshotStore["listGuilds"]>;
    saveGuild: NonNullable<RoomSnapshotStore["saveGuild"]>;
    deleteGuild: NonNullable<RoomSnapshotStore["deleteGuild"]>;
  } {
    if (
      !this.store ||
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
      loadGuild: this.store.loadGuild.bind(this.store),
      loadGuildByMemberPlayerId: this.store.loadGuildByMemberPlayerId.bind(this.store),
      listGuilds: this.store.listGuilds.bind(this.store),
      saveGuild: this.store.saveGuild.bind(this.store),
      deleteGuild: this.store.deleteGuild.bind(this.store)
    };
  }

  async listGuilds(limit?: number): Promise<GuildState[]> {
    const store = this.requireStore();
    return store.listGuilds({ ...(limit != null ? { limit } : {}) });
  }

  async getGuild(guildId: string): Promise<GuildState> {
    const store = this.requireStore();
    const guild = await store.loadGuild(guildId);
    if (!guild) {
      throw new Error("guild_not_found");
    }

    return guild;
  }

  async createGuildForPlayer(
    authSession: { playerId: string; displayName: string },
    action: GuildCreateAction
  ): Promise<GuildState> {
    const store = this.requireStore();
    await store.ensurePlayerAccount({
      playerId: authSession.playerId,
      displayName: authSession.displayName
    });

    const existingGuild = await store.loadGuildByMemberPlayerId(authSession.playerId);
    if (existingGuild) {
      throw new Error("guild_already_member");
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

    return store.saveGuild(created.guild);
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

    const joined = joinGuild(guild, {
      playerId: authSession.playerId,
      displayName: authSession.displayName
    });
    return store.saveGuild(joined.guild);
  }

  async leaveGuildForPlayer(authSession: { playerId: string; displayName: string }, guildId: string): Promise<{
    guild: GuildState;
    events: ReturnType<typeof leaveGuild>["events"];
    deleted: boolean;
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
}

export function registerGuildRoutes(
  app: {
    use: (handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void;
    get: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
    post: (path: string, handler: (request: IncomingMessage & { params: Record<string, string> }, response: ServerResponse) => void | Promise<void>) => void;
  },
  store: RoomSnapshotStore | null
): void {
  const service = new GuildService(store);

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
}
