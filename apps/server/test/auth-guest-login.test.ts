import assert from "node:assert/strict";
import { createCipheriv } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "../../../packages/shared/src/index";
import { resetAccountTokenDeliveryState } from "../src/account-token-delivery";
import {
  configureAnalyticsRuntimeDependencies,
  flushAnalyticsEventsForTest,
  resetAnalyticsRuntimeDependencies
} from "../src/analytics";
import {
  hashAccountPassword,
  issueAccountAuthSession,
  registerAuthRoutes,
  resetGuestAuthSessions,
  type GuestAuthSession
} from "../src/auth";
import { configureRoomSnapshotStore, VeilColyseusRoom } from "../src/colyseus-room";
import { registerRuntimeObservabilityRoutes, resetRuntimeObservability } from "../src/observability";
import { registerPlayerAccountRoutes } from "../src/player-accounts";
import { resetWechatSessionKeyCache } from "../src/wechat-session-key";
import type {
  PlayerAccountBanHistoryListOptions,
  PlayerAccountBanInput,
  PlayerAccountBanSnapshot,
  PlayerAccountProgressPatch,
  PlayerAccountAuthSnapshot,
  PlayerAccountDeviceSessionSnapshot,
  PlayerAccountCredentialInput,
  PlayerAccountEnsureInput,
  PlayerEventHistoryQuery,
  PlayerEventHistorySnapshot,
  PlayerAccountListOptions,
  PlayerAccountUnbanInput,
  PlayerBanHistoryRecord,
  PlayerAccountProfilePatch,
  PlayerAccountSnapshot,
  PlayerHeroArchiveSnapshot,
  RoomSnapshotStore
} from "../src/persistence";
import type { RoomPersistenceSnapshot } from "../src/index";
import { queryEventLogEntries } from "../../../packages/shared/src/index";

class MemoryAuthStore implements RoomSnapshotStore {
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly banHistoryByPlayerId = new Map<string, PlayerBanHistoryRecord[]>();
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();
  private readonly authSessionsByPlayerId = new Map<string, Map<string, PlayerAccountDeviceSessionSnapshot>>();
  private readonly playerIdByWechatOpenId = new Map<string, string>();

  async load(_roomId: string): Promise<RoomPersistenceSnapshot | null> {
    return null;
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    return this.accounts.get(playerId) ?? null;
  }

  async loadPlayerBan(playerId: string): Promise<PlayerAccountBanSnapshot | null> {
    const account = this.accounts.get(playerId);
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

  async loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedLoginId = loginId.trim().toLowerCase();
    return Array.from(this.accounts.values()).find((account) => account.loginId === normalizedLoginId) ?? null;
  }

  async loadPlayerAccountByWechatMiniGameOpenId(openId: string): Promise<PlayerAccountSnapshot | null> {
    const playerId = this.playerIdByWechatOpenId.get(openId.trim());
    return playerId ? this.accounts.get(playerId) ?? null : null;
  }

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(playerId))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account));
  }

  async loadPlayerEventHistory(
    playerId: string,
    query: PlayerEventHistoryQuery = {}
  ): Promise<PlayerEventHistorySnapshot> {
    const account = this.accounts.get(playerId);
    const total = queryEventLogEntries(account?.recentEventLog ?? [], {
      ...query,
      limit: undefined,
      offset: undefined
    }).length;
    return {
      items: queryEventLogEntries(account?.recentEventLog ?? [], query),
      total
    };
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return this.authByLoginId.get(loginId.trim().toLowerCase()) ?? null;
  }

  async loadPlayerAccountAuthByPlayerId(playerId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return Array.from(this.authByLoginId.values()).find((auth) => auth.playerId === playerId.trim()) ?? null;
  }

  async loadPlayerAccountAuthSession(playerId: string, sessionId: string): Promise<PlayerAccountDeviceSessionSnapshot | null> {
    return this.authSessionsByPlayerId.get(playerId.trim())?.get(sessionId.trim()) ?? null;
  }

  async listPlayerAccountAuthSessions(playerId: string): Promise<PlayerAccountDeviceSessionSnapshot[]> {
    return Array.from(this.authSessionsByPlayerId.get(playerId.trim())?.values() ?? []).sort(
      (left, right) => right.lastUsedAt.localeCompare(left.lastUsedAt) || right.createdAt.localeCompare(left.createdAt)
    );
  }

  async getCurrentSeason() {
    return null;
  }

  async listSeasons() {
    return [];
  }

  async createSeason(seasonId: string) {
    return {
      seasonId,
      status: "active" as const,
      startedAt: new Date().toISOString()
    };
  }

  async closeSeason() {
    return { seasonId: "", playersRewarded: 0, totalGemsGranted: 0 };
  }

  async touchPlayerAccountAuthSession(playerId: string, sessionId: string, lastUsedAt?: string): Promise<void> {
    const sessions = this.authSessionsByPlayerId.get(playerId.trim());
    const existing = sessions?.get(sessionId.trim());
    if (!sessions || !existing) {
      return;
    }
    sessions.set(sessionId.trim(), {
      ...existing,
      lastUsedAt: lastUsedAt ? new Date(lastUsedAt).toISOString() : new Date().toISOString()
    });
  }

  async revokePlayerAccountAuthSession(playerId: string, sessionId: string): Promise<boolean> {
    return this.authSessionsByPlayerId.get(playerId.trim())?.delete(sessionId.trim()) ?? false;
  }

  async loadPlayerHeroArchives(_playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]> {
    return [];
  }

  async ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    const playerId = input.playerId.trim();
    const existing = this.accounts.get(playerId);
    const account: PlayerAccountSnapshot = {
      playerId,
      displayName: input.displayName?.trim() || existing?.displayName || playerId,
      ...(existing?.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: structuredClone(existing?.achievements ?? []),
      recentEventLog: structuredClone(existing?.recentEventLog ?? []),
      ...(input.lastRoomId?.trim() ? { lastRoomId: input.lastRoomId.trim() } : existing?.lastRoomId ? { lastRoomId: existing.lastRoomId } : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.ageVerified ? { ageVerified: existing.ageVerified } : {}),
      ...(existing?.isMinor ? { isMinor: existing.isMinor } : {}),
      ...(existing?.dailyPlayMinutes ? { dailyPlayMinutes: existing.dailyPlayMinutes } : {}),
      ...(existing?.lastPlayDate ? { lastPlayDate: existing.lastPlayDate } : {}),
      ...(existing?.banStatus ? { banStatus: existing.banStatus } : {}),
      ...(existing?.banExpiry ? { banExpiry: existing.banExpiry } : {}),
      ...(existing?.banReason ? { banReason: existing.banReason } : {}),
      ...(existing?.wechatMiniGameOpenId ? { wechatMiniGameOpenId: existing.wechatMiniGameOpenId } : {}),
      ...(existing?.wechatMiniGameUnionId ? { wechatMiniGameUnionId: existing.wechatMiniGameUnionId } : {}),
      ...(existing?.wechatMiniGameBoundAt ? { wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt } : {}),
      ...(existing?.credentialBoundAt ? { credentialBoundAt: existing.credentialBoundAt } : {}),
      ...(existing?.privacyConsentAt ? { privacyConsentAt: existing.privacyConsentAt } : {}),
      ...(existing?.phoneNumber ? { phoneNumber: existing.phoneNumber } : {}),
      ...(existing?.phoneNumberBoundAt ? { phoneNumberBoundAt: existing.phoneNumberBoundAt } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, account);
    return account;
  }

  async listPlayerBanHistory(
    playerId: string,
    options: PlayerAccountBanHistoryListOptions = {}
  ): Promise<PlayerBanHistoryRecord[]> {
    return (this.banHistoryByPlayerId.get(playerId.trim()) ?? []).slice(0, Math.max(1, Math.floor(options.limit ?? 20)));
  }

  async savePlayerBan(playerId: string, input: PlayerAccountBanInput): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      banStatus: input.banStatus,
      ...(input.banStatus === "temporary" && input.banExpiry ? { banExpiry: new Date(input.banExpiry).toISOString() } : {}),
      banReason: input.banReason.trim(),
      updatedAt: new Date().toISOString()
    };
    if (input.banStatus === "permanent") {
      delete account.banExpiry;
    }
    this.accounts.set(account.playerId, account);
    const history = this.banHistoryByPlayerId.get(account.playerId) ?? [];
    history.unshift({
      id: (history[0]?.id ?? 0) + 1,
      playerId: account.playerId,
      action: "ban",
      banStatus: input.banStatus,
      ...(account.banExpiry ? { banExpiry: account.banExpiry } : {}),
      banReason: account.banReason,
      createdAt: new Date().toISOString()
    });
    this.banHistoryByPlayerId.set(account.playerId, history);
    return account;
  }

  async clearPlayerBan(playerId: string, input: PlayerAccountUnbanInput = {}): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      banStatus: "none",
      updatedAt: new Date().toISOString()
    };
    delete account.banExpiry;
    delete account.banReason;
    this.accounts.set(account.playerId, account);
    const history = this.banHistoryByPlayerId.get(account.playerId) ?? [];
    history.unshift({
      id: (history[0]?.id ?? 0) + 1,
      playerId: account.playerId,
      action: "unban",
      banStatus: "none",
      ...(input.reason?.trim() ? { banReason: input.reason.trim() } : {}),
      createdAt: new Date().toISOString()
    });
    this.banHistoryByPlayerId.set(account.playerId, history);
    return account;
  }

  async bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const normalizedLoginId = input.loginId.trim().toLowerCase();
    const owner = await this.loadPlayerAccountByLoginId(normalizedLoginId);
    if (owner && owner.playerId !== existing.playerId) {
      throw new Error("loginId is already taken");
    }

    const account: PlayerAccountSnapshot = {
      ...existing,
      loginId: normalizedLoginId,
      credentialBoundAt: existing.credentialBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(existing.playerId, account);
    this.authByLoginId.set(normalizedLoginId, {
      playerId: existing.playerId,
      displayName: account.displayName,
      loginId: normalizedLoginId,
      passwordHash: input.passwordHash,
      accountSessionVersion: existing.accountSessionVersion ?? 0,
      ...(account.credentialBoundAt ? { credentialBoundAt: account.credentialBoundAt } : {})
    });
    return account;
  }

  async savePlayerAccountPrivacyConsent(
    playerId: string,
    input: { privacyConsentAt?: string } = {}
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      privacyConsentAt: existing.privacyConsentAt ?? new Date(input.privacyConsentAt ?? Date.now()).toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(account.playerId, account);
    return account;
  }

  async savePlayerAccountAuthSession(
    playerId: string,
    input: {
      refreshSessionId: string;
      refreshTokenHash: string;
      refreshTokenExpiresAt: string;
      provider?: string;
      deviceLabel?: string;
      lastUsedAt?: string;
    }
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const auth = await this.loadPlayerAccountAuthByPlayerId(playerId);
    if (!auth) {
      return null;
    }

    const nextAuth: PlayerAccountAuthSnapshot = {
      ...auth,
      refreshSessionId: input.refreshSessionId,
      refreshTokenHash: input.refreshTokenHash,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt
    };
    this.authByLoginId.set(auth.loginId, nextAuth);
    const sessions = this.authSessionsByPlayerId.get(playerId) ?? new Map<string, PlayerAccountDeviceSessionSnapshot>();
    sessions.set(input.refreshSessionId, {
      playerId,
      sessionId: input.refreshSessionId,
      provider: input.provider ?? "account-password",
      deviceLabel: input.deviceLabel ?? "Unknown device",
      refreshTokenHash: input.refreshTokenHash,
      refreshTokenExpiresAt: input.refreshTokenExpiresAt,
      createdAt: sessions.get(input.refreshSessionId)?.createdAt ?? new Date().toISOString(),
      lastUsedAt: input.lastUsedAt ?? new Date().toISOString()
    });
    this.authSessionsByPlayerId.set(playerId, sessions);
    return nextAuth;
  }

  async revokePlayerAccountAuthSessions(
    playerId: string,
    input: { passwordHash?: string; credentialBoundAt?: string } = {}
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const auth = await this.loadPlayerAccountAuthByPlayerId(playerId);
    if (!auth) {
      return null;
    }

    const nextAuth: PlayerAccountAuthSnapshot = {
      ...auth,
      ...(input.passwordHash ? { passwordHash: input.passwordHash } : {}),
      ...(input.credentialBoundAt ? { credentialBoundAt: input.credentialBoundAt } : {}),
      accountSessionVersion: auth.accountSessionVersion + 1
    };
    delete nextAuth.refreshSessionId;
    delete nextAuth.refreshTokenHash;
    delete nextAuth.refreshTokenExpiresAt;
    this.authByLoginId.set(auth.loginId, nextAuth);
    this.authSessionsByPlayerId.delete(playerId);
    return nextAuth;
  }

  async bindPlayerAccountWechatMiniGameIdentity(
    playerId: string,
    input: { openId: string; unionId?: string; displayName?: string; avatarUrl?: string | null; ageVerified?: boolean; isMinor?: boolean }
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({
      playerId,
      ...(input.displayName?.trim() ? { displayName: input.displayName } : {})
    });
    const normalizedOpenId = input.openId.trim();
    const owner = await this.loadPlayerAccountByWechatMiniGameOpenId(normalizedOpenId);
    if (owner && owner.playerId !== existing.playerId) {
      throw new Error("wechatMiniGameOpenId is already taken");
    }

    const account: PlayerAccountSnapshot = {
      ...existing,
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      ...(input.avatarUrl?.trim() ? { avatarUrl: input.avatarUrl.trim() } : existing.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      wechatMiniGameOpenId: normalizedOpenId,
      ...(input.unionId?.trim() ? { wechatMiniGameUnionId: input.unionId.trim() } : existing.wechatMiniGameUnionId ? { wechatMiniGameUnionId: existing.wechatMiniGameUnionId } : {}),
      ...(input.ageVerified !== undefined ? { ageVerified: input.ageVerified } : existing.ageVerified ? { ageVerified: existing.ageVerified } : {}),
      ...(input.isMinor !== undefined ? { isMinor: input.isMinor } : existing.isMinor ? { isMinor: existing.isMinor } : {}),
      wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(existing.playerId, account);
    this.playerIdByWechatOpenId.set(normalizedOpenId, existing.playerId);
    return account;
  }

  async savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      displayName: patch.displayName?.trim() || existing.displayName,
      ...(patch.avatarUrl !== undefined
        ? patch.avatarUrl?.trim()
          ? { avatarUrl: patch.avatarUrl.trim() }
          : {}
        : existing.avatarUrl
          ? { avatarUrl: existing.avatarUrl }
          : {}),
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId?.trim()
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      ...(patch.phoneNumber !== undefined
        ? patch.phoneNumber?.trim()
          ? { phoneNumber: patch.phoneNumber.trim() }
          : {}
        : existing.phoneNumber
          ? { phoneNumber: existing.phoneNumber }
          : {}),
      ...(patch.phoneNumberBoundAt !== undefined
        ? patch.phoneNumberBoundAt?.trim()
          ? { phoneNumberBoundAt: patch.phoneNumberBoundAt.trim() }
          : {}
        : existing.phoneNumberBoundAt
          ? { phoneNumberBoundAt: existing.phoneNumberBoundAt }
          : {}),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(account.playerId, account);
    if (account.loginId) {
      const auth = this.authByLoginId.get(account.loginId);
      if (auth) {
        this.authByLoginId.set(account.loginId, {
          ...auth,
          displayName: account.displayName
        });
      }
    }
    return account;
  }

  async savePlayerAccountProgress(playerId: string, patch: PlayerAccountProgressPatch): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      globalResources: structuredClone(
        (patch.globalResources as PlayerAccountSnapshot["globalResources"] | undefined) ?? existing.globalResources
      ),
      achievements: structuredClone((patch.achievements as PlayerAccountSnapshot["achievements"] | undefined) ?? existing.achievements),
      recentEventLog: structuredClone((patch.recentEventLog as PlayerAccountSnapshot["recentEventLog"] | undefined) ?? existing.recentEventLog),
      ...(patch.dailyPlayMinutes !== undefined ? { dailyPlayMinutes: Math.max(0, Math.floor(patch.dailyPlayMinutes ?? 0)) } : existing.dailyPlayMinutes ? { dailyPlayMinutes: existing.dailyPlayMinutes } : {}),
      ...(patch.lastPlayDate !== undefined ? (patch.lastPlayDate ? { lastPlayDate: patch.lastPlayDate.trim() } : {}) : existing.lastPlayDate ? { lastPlayDate: existing.lastPlayDate } : {}),
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId?.trim()
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(account.playerId, account);
    return account;
  }

  async deletePlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    const existing = this.accounts.get(playerId.trim());
    if (!existing) {
      return null;
    }
    if (existing.loginId) {
      this.authByLoginId.delete(existing.loginId);
    }
    if (existing.wechatMiniGameOpenId) {
      this.playerIdByWechatOpenId.delete(existing.wechatMiniGameOpenId);
    }
    this.authSessionsByPlayerId.delete(playerId.trim());
    const account: PlayerAccountSnapshot = {
      ...existing,
      displayName: `deleted-${existing.playerId.slice(0, 12)}`,
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      banStatus: "none",
      accountSessionVersion: (existing.accountSessionVersion ?? 0) + 1,
      updatedAt: new Date().toISOString()
    };
    delete account.avatarUrl;
    delete account.lastRoomId;
    delete account.lastSeenAt;
    delete account.loginId;
    delete account.credentialBoundAt;
    delete account.privacyConsentAt;
    delete account.ageVerified;
    delete account.isMinor;
    delete account.dailyPlayMinutes;
    delete account.lastPlayDate;
    delete account.banExpiry;
    delete account.banReason;
    delete account.refreshSessionId;
    delete account.refreshTokenExpiresAt;
    delete account.wechatMiniGameOpenId;
    delete account.wechatMiniGameUnionId;
    delete account.wechatMiniGameBoundAt;
    this.accounts.set(account.playerId, account);
    return account;
  }

  async listPlayerAccounts(_options: PlayerAccountListOptions = {}): Promise<PlayerAccountSnapshot[]> {
    return Array.from(this.accounts.values());
  }

  async save(_roomId: string, _snapshot: RoomPersistenceSnapshot): Promise<void> {}

  async delete(_roomId: string): Promise<void> {}

  async pruneExpired(): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {}
}

async function startAuthServer(port: number, store: RoomSnapshotStore | null = null): Promise<Server> {
  configureRoomSnapshotStore(store);
  resetGuestAuthSessions();
  resetAccountTokenDeliveryState();
  resetRuntimeObservability();
  const transport = new WebSocketTransport();
  registerAuthRoutes(transport.getExpressApp() as never, store);
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  registerRuntimeObservabilityRoutes(transport.getExpressApp() as never);
  const server = new Server({ transport });
  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

function createWechatPhonePayload(input: {
  sessionKey: string;
  appId: string;
  phoneNumber: string;
}): { encryptedData: string; iv: string } {
  const iv = Buffer.from("1234567890abcdef", "utf8").toString("base64");
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(input.sessionKey, "base64"),
    Buffer.from(iv, "base64")
  );
  cipher.setAutoPadding(true);
  const payload = JSON.stringify({
    phoneNumber: input.phoneNumber,
    purePhoneNumber: input.phoneNumber.replace(/^\+\d+/, ""),
    countryCode: "86",
    watermark: {
      appid: input.appId
    }
  });
  return {
    encryptedData: Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]).toString("base64"),
    iv
  };
}

async function joinRoom(port: number, logicalRoomId: string, playerId: string): Promise<ColyseusRoom> {
  const client = new Client(`http://127.0.0.1:${port}`);
  return client.joinOrCreate("veil", {
    logicalRoomId,
    playerId,
    seed: 1001
  });
}

async function sendRequest<T extends ServerMessage["type"]>(
  room: ColyseusRoom,
  message: ClientMessage,
  expectedType: T
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, 5_000);

    const unsubscribe = room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }

      const response = { type, ...(payload as object) } as ServerMessage;
      if ("requestId" in response && response.requestId !== message.requestId) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();

      if (response.type === "error") {
        reject(new Error(response.reason));
        return;
      }

      if (response.type !== expectedType) {
        reject(new Error(`Unexpected response type: ${response.type}`));
        return;
      }

      resolve(response as Extract<ServerMessage, { type: T }>);
    });

    room.send(message.type, message);
  });
}

function withEnvOverrides(
  overrides: Record<string, string | undefined>,
  cleanup: Array<() => void>
): void {
  const previousValues = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]])
  ) as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }

  cleanup.push(() => {
    for (const [key, value] of Object.entries(previousValues)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startTokenDeliveryWebhookServer(options: { statusCode?: number } = {}): Promise<{
  close: () => Promise<void>;
  requests: Array<{
    headers: Record<string, string | string[] | undefined>;
    body: Record<string, unknown>;
  }>;
  setStatusCode: (statusCode: number) => void;
  url: string;
}> {
  const requests: Array<{
    headers: Record<string, string | string[] | undefined>;
    body: Record<string, unknown>;
  }> = [];
  let statusCode = options.statusCode ?? 204;
  const server = createHttpServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    requests.push({
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>
    });

    response.statusCode = statusCode;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ ok: statusCode < 400 }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("webhook_server_address_unavailable");
  }

  return {
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    requests,
    setStatusCode: (nextStatusCode: number) => {
      statusCode = nextStatusCode;
    },
    url: `http://127.0.0.1:${address.port}/delivery`
  };
}

async function startTokenDeliverySmtpServer(): Promise<{
  close: () => Promise<void>;
  port: number;
  sessions: Array<{
    commands: string[];
    messages: string[];
  }>;
}> {
  const sessions: Array<{
    commands: string[];
    messages: string[];
  }> = [];
  const server = createNetServer((socket) => {
    const session = {
      commands: [] as string[],
      messages: [] as string[]
    };
    sessions.push(session);

    let buffer = "";
    let readingData = false;

    socket.setEncoding("utf8");
    socket.write("220 smtp.projectveil.test ESMTP ready\r\n");
    socket.on("data", (chunk: string | Buffer) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");

      while (true) {
        if (readingData) {
          const terminatorIndex = buffer.indexOf("\r\n.\r\n");
          if (terminatorIndex < 0) {
            break;
          }
          session.messages.push(buffer.slice(0, terminatorIndex));
          buffer = buffer.slice(terminatorIndex + 5);
          readingData = false;
          socket.write("250 message accepted\r\n");
          continue;
        }

        const lineBreakIndex = buffer.indexOf("\r\n");
        if (lineBreakIndex < 0) {
          break;
        }

        const line = buffer.slice(0, lineBreakIndex);
        buffer = buffer.slice(lineBreakIndex + 2);
        session.commands.push(line);

        if (/^EHLO\b/i.test(line)) {
          socket.write("250-smtp.projectveil.test\r\n250 AUTH PLAIN\r\n");
          continue;
        }
        if (/^AUTH PLAIN\b/i.test(line)) {
          socket.write("235 authenticated\r\n");
          continue;
        }
        if (/^MAIL FROM:/i.test(line)) {
          socket.write("250 sender ok\r\n");
          continue;
        }
        if (/^RCPT TO:/i.test(line)) {
          socket.write("250 recipient ok\r\n");
          continue;
        }
        if (/^DATA$/i.test(line)) {
          readingData = true;
          socket.write("354 end with <CRLF>.<CRLF>\r\n");
          continue;
        }
        if (/^QUIT$/i.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
          continue;
        }

        socket.write("502 command not implemented\r\n");
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("smtp_server_address_unavailable");
  }

  return {
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    port: address.port,
    sessions
  };
}

test("guest auth route issues a signed session token", async (t) => {
  const port = 43000 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "player-auth",
      displayName: "访客骑士",
      privacyConsentAccepted: true
    })
  });
  const payload = (await response.json()) as { session: GuestAuthSession };

  assert.equal(response.status, 200);
  assert.equal(payload.session.playerId, "player-auth");
  assert.equal(payload.session.displayName, "访客骑士");
  assert.equal(payload.session.provider, "guest");
  assert.match(payload.session.token, /\./);
});

test("auth session route resolves a bearer token into the current guest session", async (t) => {
  const port = 43500 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);
  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "player-session",
      displayName: "回声旅人",
      privacyConsentAccepted: true
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${loginPayload.session.token}`
    }
  });
  const sessionPayload = (await sessionResponse.json()) as { session: GuestAuthSession };

  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionPayload.session.playerId, "player-session");
  assert.equal(sessionPayload.session.displayName, "回声旅人");
  assert.equal(sessionPayload.session.provider, "guest");
  assert.match(sessionPayload.session.token, /\./);
});

test("connect message prefers auth token identity over a spoofed playerId", async (t) => {
  const port = 44000 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);
  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "trusted-player",
      displayName: "真正的访客",
      privacyConsentAccepted: true
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };
  const room = await joinRoom(port, "auth-room", "spoofed-player");

  t.after(async () => {
    await room.leave(true).catch(() => undefined);
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await sendRequest(
    room,
    {
      type: "connect",
      requestId: "auth-connect",
      roomId: "auth-room",
      playerId: "spoofed-player",
      authToken: loginPayload.session.token
    },
    "session.state"
  );

  assert.equal(response.payload.world.playerId, "trusted-player");
});

test("guest auth connect claims a default hero slot for non-template player ids", async (t) => {
  const port = 44250 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);
  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "guest-rune",
      displayName: "灰烬行者",
      privacyConsentAccepted: true
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };
  const room = await joinRoom(port, "guest-slot-room", "spoofed-player");

  t.after(async () => {
    await room.leave(true).catch(() => undefined);
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await sendRequest(
    room,
    {
      type: "connect",
      requestId: "guest-slot-connect",
      roomId: "guest-slot-room",
      playerId: "spoofed-player",
      authToken: loginPayload.session.token
    },
    "session.state"
  );

  assert.equal(response.payload.world.playerId, "guest-rune");
  assert.equal(response.payload.world.meta.day, 1);
  assert.equal(response.payload.world.ownHeroes.length, 1);
  assert.equal(response.payload.world.ownHeroes[0]?.playerId, "guest-rune");
  assert.ok(response.payload.reachableTiles.length > 0);
  assert.equal((await store.loadPlayerAccount("guest-rune"))?.lastRoomId, "guest-slot-room");
});

test("account bind upgrades a guest session into password login and account-login restores it", async (t) => {
  const port = 44500 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const guestLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "account-player",
      displayName: "暮潮守望",
      privacyConsentAccepted: true
    })
  });
  const guestLoginPayload = (await guestLoginResponse.json()) as { session: GuestAuthSession };

  const bindResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-bind`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${guestLoginPayload.session.token}`
    },
    body: JSON.stringify({
      loginId: "veil-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const bindPayload = (await bindResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: GuestAuthSession;
  };

  assert.equal(bindResponse.status, 200);
  assert.equal(bindPayload.account.loginId, "veil-ranger");
  assert.equal(bindPayload.session.authMode, "account");
  assert.equal(bindPayload.session.provider, "account-password");
  assert.equal(bindPayload.session.loginId, "veil-ranger");

  const accountLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "veil-ranger",
      password: "hunter2"
    })
  });
  const accountLoginPayload = (await accountLoginResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: GuestAuthSession;
  };

  assert.equal(accountLoginResponse.status, 200);
  assert.equal(accountLoginPayload.account.playerId, "account-player");
  assert.equal(accountLoginPayload.session.authMode, "account");
  assert.equal(accountLoginPayload.session.provider, "account-password");
  assert.equal(accountLoginPayload.session.loginId, "veil-ranger");

  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${accountLoginPayload.session.token}`
    }
  });
  const sessionPayload = (await sessionResponse.json()) as { session: GuestAuthSession };

  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionPayload.session.authMode, "account");
  assert.equal(sessionPayload.session.provider, "account-password");
  assert.equal(sessionPayload.session.loginId, "veil-ranger");
});

test("account bind emits experiment conversion analytics for the assigned variant", async (t) => {
  const port = 44510 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const analyticsLogs: string[] = [];
  process.env.VEIL_FEATURE_FLAGS_JSON = JSON.stringify({
    schemaVersion: 1,
    flags: {},
    experiments: {
      account_portal_copy: {
        name: "Account Portal Upgrade Copy",
        owner: "growth",
        enabled: true,
        fallbackVariant: "control",
        whitelist: {
          "account-exp-player": "upgrade"
        },
        variants: [{ key: "control", allocation: 100 }]
      }
    }
  });
  configureAnalyticsRuntimeDependencies({
    log: (message) => {
      analyticsLogs.push(message);
    }
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    delete process.env.VEIL_FEATURE_FLAGS_JSON;
    resetAnalyticsRuntimeDependencies();
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const guestLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "account-exp-player",
      displayName: "实验绑定玩家",
      privacyConsentAccepted: true
    })
  });
  const guestLoginPayload = (await guestLoginResponse.json()) as { session: GuestAuthSession };

  const bindResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-bind`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${guestLoginPayload.session.token}`
    },
    body: JSON.stringify({
      loginId: "veil-experiment",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });

  assert.equal(bindResponse.status, 200);
  await flushAnalyticsEventsForTest();

  const conversionLog = analyticsLogs.find((entry) => entry.includes("\"name\":\"experiment_conversion\""));
  assert.ok(conversionLog);
  assert.match(conversionLog ?? "", /"experimentKey":"account_portal_copy"/);
  assert.match(conversionLog ?? "", /"variant":"upgrade"/);
  assert.match(conversionLog ?? "", /"conversion":"account_bound"/);
});

test("account access tokens expire with token_expired and can be rotated through refresh", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_AUTH_ACCESS_TTL_SECONDS: "1",
      VEIL_AUTH_REFRESH_TTL_SECONDS: "30"
    },
    cleanup
  );

  const port = 44540 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.bindPlayerAccountCredentials("expiry-player", {
    loginId: "expiry-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "expiry-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const loginPayload = (await loginResponse.json()) as {
    session: GuestAuthSession;
  };

  assert.equal(loginResponse.status, 200);
  assert.equal(typeof loginPayload.session.refreshToken, "string");

  await sleep(1_100);

  const expiredResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${loginPayload.session.token}`
    }
  });
  const expiredPayload = (await expiredResponse.json()) as { error: { code: string } };

  assert.equal(expiredResponse.status, 401);
  assert.equal(expiredPayload.error.code, "token_expired");

  const refreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginPayload.session.refreshToken}`
    }
  });
  const refreshPayload = (await refreshResponse.json()) as { session: GuestAuthSession };

  assert.equal(refreshResponse.status, 200);
  assert.notEqual(refreshPayload.session.token, loginPayload.session.token);
  assert.notEqual(refreshPayload.session.refreshToken, loginPayload.session.refreshToken);
});

test("refresh rotation invalidates the previous refresh token and logout revokes the active one", async (t) => {
  const port = 44580 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.bindPlayerAccountCredentials("rotate-player", {
    loginId: "rotate-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "rotate-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };

  const rotatedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginPayload.session.refreshToken}`
    }
  });
  const rotatedPayload = (await rotatedResponse.json()) as { session: GuestAuthSession };

  assert.equal(rotatedResponse.status, 200);

  const staleRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginPayload.session.refreshToken}`
    }
  });
  const staleRefreshPayload = (await staleRefreshResponse.json()) as { error: { code: string } };

  assert.equal(staleRefreshResponse.status, 401);
  assert.equal(staleRefreshPayload.error.code, "session_revoked");

  const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rotatedPayload.session.token}`
    }
  });
  assert.equal(logoutResponse.status, 200);

  const revokedRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rotatedPayload.session.refreshToken}`
    }
  });
  const revokedRefreshPayload = (await revokedRefreshResponse.json()) as { error: { code: string } };

  assert.equal(revokedRefreshResponse.status, 401);
  assert.equal(revokedRefreshPayload.error.code, "session_revoked");
});

test("auth readiness and metrics summarize auth posture for dashboards", async (t) => {
  const port = 44590 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.bindPlayerAccountCredentials("metrics-player", {
    loginId: "metrics-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    resetRuntimeObservability();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const guestLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "metrics-guest",
      displayName: "指标访客",
      privacyConsentAccepted: true
    })
  });
  const guestLoginPayload = (await guestLoginResponse.json()) as { session: GuestAuthSession };
  assert.equal(guestLoginResponse.status, 200);

  const accountLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Metrics Browser"
    },
    body: JSON.stringify({
      loginId: "metrics-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const accountLoginPayload = (await accountLoginResponse.json()) as { session: GuestAuthSession };
  assert.equal(accountLoginResponse.status, 200);

  const revokedRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accountLoginPayload.session.refreshToken}`
    }
  });
  const rotatedPayload = (await revokedRefreshResponse.json()) as { session: GuestAuthSession };
  assert.equal(revokedRefreshResponse.status, 200);

  const staleRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accountLoginPayload.session.refreshToken}`
    }
  });
  assert.equal(staleRefreshResponse.status, 401);

  const invalidLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "metrics-ranger",
      password: "wrong-password",
      privacyConsentAccepted: true
    })
  });
  assert.equal(invalidLoginResponse.status, 401);

  const healthResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/health`);
  const healthPayload = (await healthResponse.json()) as {
    runtime: {
      auth: {
        activeGuestSessionCount: number;
        activeAccountSessionCount: number;
        counters: {
          guestLoginsTotal: number;
          accountLoginsTotal: number;
          refreshesTotal: number;
          invalidCredentialsTotal: number;
          sessionFailuresTotal: number;
        };
        sessionFailureReasons: {
          session_revoked: number;
        };
      };
    };
  };

  assert.equal(healthResponse.status, 200);
  assert.equal(healthPayload.runtime.auth.activeGuestSessionCount, 1);
  assert.equal(healthPayload.runtime.auth.activeAccountSessionCount, 1);
  assert.equal(healthPayload.runtime.auth.counters.guestLoginsTotal, 1);
  assert.equal(healthPayload.runtime.auth.counters.accountLoginsTotal, 1);
  assert.equal(healthPayload.runtime.auth.counters.refreshesTotal, 1);
  assert.equal(healthPayload.runtime.auth.counters.invalidCredentialsTotal, 1);
  assert.equal(healthPayload.runtime.auth.counters.sessionFailuresTotal, 1);
  assert.equal(healthPayload.runtime.auth.sessionFailureReasons.session_revoked, 1);

  const readinessResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/auth-readiness`);
  const readinessPayload = (await readinessResponse.json()) as {
    status: string;
    headline: string;
    alerts: string[];
    auth: {
      activeGuestSessionCount: number;
      activeAccountSessionCount: number;
    };
  };

  assert.equal(readinessResponse.status, 200);
  assert.equal(readinessPayload.status, "ok");
  assert.match(readinessPayload.headline, /guest=1 account=1 lockouts=0/);
  assert.deepEqual(readinessPayload.alerts, []);
  assert.equal(readinessPayload.auth.activeGuestSessionCount, 1);
  assert.equal(readinessPayload.auth.activeAccountSessionCount, 1);

  const metricsResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/metrics`);
  const metricsText = await metricsResponse.text();

  assert.equal(metricsResponse.status, 200);
  assert.match(metricsText, /^veil_auth_guest_sessions 1$/m);
  assert.match(metricsText, /^veil_auth_account_sessions 1$/m);
  assert.match(metricsText, /^veil_auth_guest_logins_total 1$/m);
  assert.match(metricsText, /^veil_auth_account_logins_total 1$/m);
  assert.match(metricsText, /^veil_auth_refreshes_total 1$/m);
  assert.match(metricsText, /^veil_auth_invalid_credentials_total 1$/m);
  assert.match(metricsText, /^veil_auth_session_failures_total 1$/m);
  assert.match(metricsText, /^veil_auth_session_failures_session_revoked_total 1$/m);

  const logoutResponse = await fetch(`http://127.0.0.1:${port}/api/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${rotatedPayload.session.token}`
    }
  });
  assert.equal(logoutResponse.status, 200);
});

test("revoking one device session leaves other account sessions active and blocks further refreshes for the revoked device", async (t) => {
  const port = 44600 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.bindPlayerAccountCredentials("device-player", {
    loginId: "device-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Current Browser"
    },
    body: JSON.stringify({
      loginId: "device-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const firstLoginPayload = (await firstLoginResponse.json()) as { session: GuestAuthSession };

  const secondLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "WeChat DevTools"
    },
    body: JSON.stringify({
      loginId: "device-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const secondLoginPayload = (await secondLoginResponse.json()) as { session: GuestAuthSession };

  assert.equal(firstLoginResponse.status, 200);
  assert.equal(secondLoginResponse.status, 200);
  assert.notEqual(firstLoginPayload.session.sessionId, secondLoginPayload.session.sessionId);

  const revokeResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/me/sessions/${encodeURIComponent(secondLoginPayload.session.sessionId ?? "")}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${firstLoginPayload.session.token}`
      }
    }
  );
  assert.equal(revokeResponse.status, 200);

  const revokedRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secondLoginPayload.session.refreshToken}`
    }
  });
  const revokedRefreshPayload = (await revokedRefreshResponse.json()) as { error: { code: string } };

  assert.equal(revokedRefreshResponse.status, 401);
  assert.equal(revokedRefreshPayload.error.code, "session_revoked");

  const survivingRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${firstLoginPayload.session.refreshToken}`
    }
  });

  assert.equal(survivingRefreshResponse.status, 200);
});

test("password changes revoke the current account session family", async (t) => {
  const port = 44610 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.bindPlayerAccountCredentials("password-player", {
    loginId: "password-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "password-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };

  const passwordChangeResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginPayload.session.token}`
    },
    body: JSON.stringify({
      currentPassword: "hunter2",
      newPassword: "hunter3"
    })
  });

  assert.equal(passwordChangeResponse.status, 200);

  const revokedAccessResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${loginPayload.session.token}`
    }
  });
  const revokedAccessPayload = (await revokedAccessResponse.json()) as { error: { code: string } };

  assert.equal(revokedAccessResponse.status, 401);
  assert.equal(revokedAccessPayload.error.code, "session_revoked");

  const revokedRefreshResponse = await fetch(`http://127.0.0.1:${port}/api/auth/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${loginPayload.session.refreshToken}`
    }
  });
  const revokedRefreshPayload = (await revokedRefreshResponse.json()) as { error: { code: string } };

  assert.equal(revokedRefreshResponse.status, 401);
  assert.equal(revokedRefreshPayload.error.code, "session_revoked");
});

test("guest auth route returns 429 after the per-IP rate limit is exceeded", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_AUTH_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_AUTH_MAX: "2"
    },
    cleanup
  );

  const port = 44625 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        playerId: `guest-rate-limit-${index}`,
        privacyConsentAccepted: true
      })
    });
    assert.equal(response.status, 200);
  }

  const limitedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "guest-rate-limit-3",
      privacyConsentAccepted: true
    })
  });
  const limitedPayload = (await limitedResponse.json()) as { error: { code: string } };

  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedPayload.error.code, "rate_limited");
  assert.equal(limitedResponse.headers.get("Retry-After"), "60");
});

test("account login locks after repeated invalid credentials and returns lockedUntil", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_AUTH_LOCKOUT_THRESHOLD: "2",
      VEIL_AUTH_LOCKOUT_DURATION_MINUTES: "15"
    },
    cleanup
  );

  const port = 44650 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "lockout-player",
    displayName: "锁定骑士"
  });
  await store.bindPlayerAccountCredentials("lockout-player", {
    loginId: "lockout-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: "lockout-ranger",
        password: "wrong-password",
        privacyConsentAccepted: true
      })
    });

    if (index === 0) {
      const payload = (await response.json()) as { error: { code: string } };
      assert.equal(response.status, 401);
      assert.equal(payload.error.code, "invalid_credentials");
      continue;
    }

    const payload = (await response.json()) as { error: { code: string; lockedUntil?: string } };
    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "account_locked");
    assert.ok(payload.error.lockedUntil);
  }

  const lockedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "lockout-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const lockedPayload = (await lockedResponse.json()) as { error: { code: string; lockedUntil?: string } };

  assert.equal(lockedResponse.status, 403);
  assert.equal(lockedPayload.error.code, "account_locked");
  assert.ok(lockedPayload.error.lockedUntil);
});

test("account login lockout expires after the configured duration", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_AUTH_LOCKOUT_THRESHOLD: "2",
      VEIL_AUTH_LOCKOUT_DURATION_MINUTES: "0.002"
    },
    cleanup
  );

  const port = 44675 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "lockout-expiry-player",
    displayName: "解锁骑士"
  });
  await store.bindPlayerAccountCredentials("lockout-expiry-player", {
    loginId: "expiry-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let index = 0; index < 2; index += 1) {
    await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: "expiry-ranger",
        password: "wrong-password",
        privacyConsentAccepted: true
      })
    });
  }

  await sleep(180);

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "expiry-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const payload = (await response.json()) as {
    account: PlayerAccountSnapshot;
    session: GuestAuthSession;
  };

  assert.equal(response.status, 200);
  assert.equal(payload.account.playerId, "lockout-expiry-player");
  assert.equal(payload.session.loginId, "expiry-ranger");
});

test("guest auth session LRU eviction invalidates the oldest idle guest token", async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_MAX_GUEST_SESSIONS: "2"
    },
    cleanup
  );

  const port = 44700 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const sessions: GuestAuthSession[] = [];
  for (const playerId of ["guest-lru-1", "guest-lru-2", "guest-lru-3"]) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ playerId, privacyConsentAccepted: true })
    });
    const payload = (await response.json()) as { session: GuestAuthSession };
    assert.equal(response.status, 200);
    sessions.push(payload.session);
  }

  const evictedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${sessions[0].token}`
    }
  });
  const activeResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${sessions[2].token}`
    }
  });
  const activePayload = (await activeResponse.json()) as { session: GuestAuthSession };

  assert.equal(evictedResponse.status, 401);
  assert.equal(activeResponse.status, 200);
  assert.equal(activePayload.session.playerId, "guest-lru-3");
});

test("account registration request and confirm create a new formal account, session, and audit trail", {
  concurrency: false
}, async (t) => {
  const port = 44710 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const requestResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "formal-ranger",
      displayName: "晨星旅团"
    })
  });
  const requestPayload = (await requestResponse.json()) as {
    status: string;
    expiresAt?: string;
    registrationToken?: string;
  };

  assert.equal(requestResponse.status, 202);
  assert.equal(requestPayload.status, "registration_requested");
  assert.ok(requestPayload.expiresAt);
  assert.equal(typeof requestPayload.registrationToken, "string");

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "formal-ranger",
      registrationToken: requestPayload.registrationToken,
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const confirmPayload = (await confirmResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: GuestAuthSession;
  };

  assert.equal(confirmResponse.status, 200);
  assert.match(confirmPayload.account.playerId, /^account-/);
  assert.equal(confirmPayload.account.displayName, "晨星旅团");
  assert.equal(confirmPayload.account.loginId, "formal-ranger");
  assert.equal(confirmPayload.session.authMode, "account");
  assert.equal(confirmPayload.session.loginId, "formal-ranger");
  assert.equal(typeof confirmPayload.session.refreshToken, "string");

  const storedAccount = await store.loadPlayerAccount(confirmPayload.account.playerId);
  assert.equal(storedAccount?.recentEventLog[0]?.category, "account");
  assert.match(storedAccount?.recentEventLog[0]?.description ?? "", /完成正式账号注册/);
  assert.equal(storedAccount?.recentEventLog[1]?.category, "account");
  assert.match(storedAccount?.recentEventLog[1]?.description ?? "", /发起正式注册申请/);

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "formal-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  assert.equal(loginResponse.status, 200);
});

test("account registration request rejects already-bound login IDs", { concurrency: false }, async (t) => {
  const port = 44715 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "registration-conflict-player",
    displayName: "已占用旅人"
  });
  await store.bindPlayerAccountCredentials("registration-conflict-player", {
    loginId: "taken-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "taken-ranger",
      displayName: "新旅人"
    })
  });
  const payload = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 409);
  assert.equal(payload.error.code, "login_id_taken");
});

test("account registration confirm rejects invalid tokens", { concurrency: false }, async (t) => {
  const port = 44720 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const requestResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "invalid-registration-ranger"
    })
  });
  assert.equal(requestResponse.status, 202);

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "invalid-registration-ranger",
      registrationToken: "wrong-token",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const confirmPayload = (await confirmResponse.json()) as { error: { code: string } };

  assert.equal(confirmResponse.status, 401);
  assert.equal(confirmPayload.error.code, "invalid_registration_token");
});

test("account registration request reuses the active token for the same loginId until it is consumed", { concurrency: false }, async (t) => {
  const port = 44721 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "stable-registration-ranger",
      displayName: "雾海守望"
    })
  });
  const firstPayload = (await firstResponse.json()) as {
    status: string;
    expiresAt?: string;
    registrationToken?: string;
  };

  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "stable-registration-ranger",
      displayName: "雾海守望"
    })
  });
  const secondPayload = (await secondResponse.json()) as {
    status: string;
    expiresAt?: string;
    registrationToken?: string;
  };

  assert.equal(firstResponse.status, 202);
  assert.equal(secondResponse.status, 202);
  assert.equal(firstPayload.status, "registration_requested");
  assert.equal(secondPayload.status, "registration_requested");
  assert.equal(secondPayload.registrationToken, firstPayload.registrationToken);
  assert.equal(secondPayload.expiresAt, firstPayload.expiresAt);

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "stable-registration-ranger",
      registrationToken: firstPayload.registrationToken,
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });

  assert.equal(confirmResponse.status, 200);
});

test("account registration request returns 429 after the per-IP rate limit is exceeded", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_AUTH_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_AUTH_MAX: "2"
    },
    cleanup
  );

  const port = 44722 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: `registration-limit-${index}`
      })
    });
    assert.equal(response.status, 202);
  }

  const limitedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "registration-limit-3"
    })
  });
  const limitedPayload = (await limitedResponse.json()) as { error: { code: string } };

  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedPayload.error.code, "rate_limited");
  assert.equal(limitedResponse.headers.get("Retry-After"), "60");
});

test("password recovery request and confirm reset the password, revoke old sessions, and append account audit events", {
  concurrency: false
}, async (t) => {
  const port = 44725 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "recovery-player",
    displayName: "回响旅人"
  });
  await store.bindPlayerAccountCredentials("recovery-player", {
    loginId: "recovery-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "recovery-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };
  assert.equal(loginResponse.status, 200);

  const requestResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "recovery-ranger"
    })
  });
  const requestPayload = (await requestResponse.json()) as {
    status: string;
    expiresAt?: string;
    recoveryToken?: string;
  };

  assert.equal(requestResponse.status, 202);
  assert.equal(requestPayload.status, "recovery_requested");
  assert.equal(typeof requestPayload.recoveryToken, "string");
  assert.ok(requestPayload.expiresAt);

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "recovery-ranger",
      recoveryToken: requestPayload.recoveryToken,
      newPassword: "hunter3"
    })
  });
  const confirmPayload = (await confirmResponse.json()) as { account: PlayerAccountSnapshot };

  assert.equal(confirmResponse.status, 200);
  assert.equal(confirmPayload.account.playerId, "recovery-player");

  const revokedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${loginPayload.session.token}`
    }
  });
  const revokedPayload = (await revokedResponse.json()) as { error: { code: string } };
  assert.equal(revokedResponse.status, 401);
  assert.equal(revokedPayload.error.code, "session_revoked");

  const stalePasswordResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "recovery-ranger",
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });
  assert.equal(stalePasswordResponse.status, 401);

  const freshPasswordResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "recovery-ranger",
      password: "hunter3",
      privacyConsentAccepted: true
    })
  });
  assert.equal(freshPasswordResponse.status, 200);

  const account = await store.loadPlayerAccount("recovery-player");
  assert.equal(account?.recentEventLog[0]?.category, "account");
  assert.match(account?.recentEventLog[0]?.description ?? "", /重置口令/);
  assert.equal(account?.recentEventLog[1]?.category, "account");
  assert.match(account?.recentEventLog[1]?.description ?? "", /发起密码找回申请/);
});

test("password recovery confirm rejects invalid tokens", { concurrency: false }, async (t) => {
  const port = 44735 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "recovery-invalid-player",
    displayName: "失效旅人"
  });
  await store.bindPlayerAccountCredentials("recovery-invalid-player", {
    loginId: "invalid-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const requestResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "invalid-ranger"
    })
  });
  assert.equal(requestResponse.status, 202);

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "invalid-ranger",
      recoveryToken: "wrong-token",
      newPassword: "hunter3"
    })
  });
  const confirmPayload = (await confirmResponse.json()) as { error: { code: string } };

  assert.equal(confirmResponse.status, 401);
  assert.equal(confirmPayload.error.code, "invalid_recovery_token");
});

test("password recovery request reuses the active token and avoids duplicate audit entries", { concurrency: false }, async (t) => {
  const port = 44740 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "recovery-stable-player",
    displayName: "稳定旅人"
  });
  await store.bindPlayerAccountCredentials("recovery-stable-player", {
    loginId: "stable-recovery-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "stable-recovery-ranger"
    })
  });
  const firstPayload = (await firstResponse.json()) as {
    status: string;
    expiresAt?: string;
    recoveryToken?: string;
  };

  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "stable-recovery-ranger"
    })
  });
  const secondPayload = (await secondResponse.json()) as {
    status: string;
    expiresAt?: string;
    recoveryToken?: string;
  };

  assert.equal(firstResponse.status, 202);
  assert.equal(secondResponse.status, 202);
  assert.equal(firstPayload.status, "recovery_requested");
  assert.equal(secondPayload.status, "recovery_requested");
  assert.equal(secondPayload.recoveryToken, firstPayload.recoveryToken);
  assert.equal(secondPayload.expiresAt, firstPayload.expiresAt);

  const accountAfterRequests = await store.loadPlayerAccount("recovery-stable-player");
  assert.equal(accountAfterRequests?.recentEventLog.filter((entry) => /发起密码找回申请/.test(entry.description)).length, 1);

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "stable-recovery-ranger",
      recoveryToken: firstPayload.recoveryToken,
      newPassword: "hunter3"
    })
  });

  assert.equal(confirmResponse.status, 200);
});

test("password recovery request returns 429 after the per-IP rate limit is exceeded", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_RATE_LIMIT_AUTH_WINDOW_MS: "60000",
      VEIL_RATE_LIMIT_AUTH_MAX: "2"
    },
    cleanup
  );

  const port = 44745 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "recovery-rate-limit-player",
    displayName: "限流旅人"
  });
  await store.bindPlayerAccountCredentials("recovery-rate-limit-player", {
    loginId: "limit-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  for (let index = 0; index < 2; index += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        loginId: "limit-ranger"
      })
    });
    assert.equal(response.status, 202);
  }

  const limitedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "limit-ranger"
    })
  });
  const limitedPayload = (await limitedResponse.json()) as { error: { code: string } };

  assert.equal(limitedResponse.status, 429);
  assert.equal(limitedPayload.error.code, "rate_limited");
  assert.equal(limitedResponse.headers.get("Retry-After"), "60");
});

test("account registration request uses webhook delivery without leaking the token", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  const webhook = await startTokenDeliveryWebhookServer();
  withEnvOverrides(
    {
      VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "webhook",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL: webhook.url
    },
    cleanup
  );

  const port = 44746 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    await webhook.close().catch(() => undefined);
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "webhook-registration-ranger",
      displayName: "Webhook Ranger"
    })
  });
  const firstPayload = (await firstResponse.json()) as {
    status: string;
    expiresAt?: string;
    registrationToken?: string;
  };

  assert.equal(firstResponse.status, 202);
  assert.equal(firstPayload.status, "registration_requested");
  assert.ok(firstPayload.expiresAt);
  assert.equal(firstPayload.registrationToken, undefined);
  assert.equal(webhook.requests.length, 1);
  assert.equal(webhook.requests[0]?.body.event, "account-registration");
  assert.equal(webhook.requests[0]?.body.loginId, "webhook-registration-ranger");
  assert.equal(webhook.requests[0]?.body.requestedDisplayName, "Webhook Ranger");
  assert.equal(webhook.requests[0]?.body.expiresAt, firstPayload.expiresAt);
  assert.equal(typeof webhook.requests[0]?.body.token, "string");

  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "webhook-registration-ranger",
      displayName: "Webhook Ranger"
    })
  });
  const secondPayload = (await secondResponse.json()) as {
    status: string;
    expiresAt?: string;
    registrationToken?: string;
  };

  assert.equal(secondResponse.status, 202);
  assert.equal(secondPayload.registrationToken, undefined);
  assert.equal(secondPayload.expiresAt, firstPayload.expiresAt);
  assert.equal(webhook.requests.length, 2);
  assert.equal(webhook.requests[1]?.body.token, webhook.requests[0]?.body.token);

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "webhook-registration-ranger",
      registrationToken: webhook.requests[0]?.body.token,
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });

  assert.equal(confirmResponse.status, 200);
});

test("account registration request uses smtp delivery without leaking the token", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  const smtp = await startTokenDeliverySmtpServer();
  withEnvOverrides(
    {
      VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "smtp",
      VEIL_AUTH_TOKEN_DELIVERY_SMTP_HOST: "127.0.0.1",
      VEIL_AUTH_TOKEN_DELIVERY_SMTP_PORT: String(smtp.port),
      VEIL_AUTH_TOKEN_DELIVERY_SMTP_FROM: "noreply@projectveil.test",
      VEIL_AUTH_TOKEN_DELIVERY_SMTP_RECIPIENT_DOMAIN: "mail.projectveil.test"
    },
    cleanup
  );

  const port = 44756 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    await smtp.close().catch(() => undefined);
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const requestResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "smtp-registration-ranger",
      displayName: "SMTP Ranger"
    })
  });
  const requestPayload = (await requestResponse.json()) as {
    status: string;
    expiresAt?: string;
    registrationToken?: string;
  };

  assert.equal(requestResponse.status, 202);
  assert.equal(requestPayload.status, "registration_requested");
  assert.ok(requestPayload.expiresAt);
  assert.equal(requestPayload.registrationToken, undefined);
  assert.equal(smtp.sessions.length, 1);
  assert.match(smtp.sessions[0]?.commands[1] ?? "", /^MAIL FROM:<noreply@projectveil\.test>$/);
  assert.match(smtp.sessions[0]?.commands[2] ?? "", /^RCPT TO:<smtp-registration-ranger@mail\.projectveil\.test>$/);
  const message = smtp.sessions[0]?.messages[0] ?? "";
  assert.match(message, /^Subject: \[ProjectVeil\] Registration token for smtp-registration-ranger$/m);
  assert.match(message, /^Expires at: .+$/m);
  const tokenMatch = message.match(/^Token: (.+)$/m);
  assert.ok(tokenMatch);

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "smtp-registration-ranger",
      registrationToken: tokenMatch?.[1],
      password: "hunter2",
      privacyConsentAccepted: true
    })
  });

  assert.equal(confirmResponse.status, 200);
});

test("account registration request returns 503 when webhook delivery is misconfigured", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  withEnvOverrides(
    {
      VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "webhook",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL: undefined
    },
    cleanup
  );

  const port = 44747 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "misconfigured-registration-ranger"
    })
  });
  const payload = (await response.json()) as { error: { code: string; message: string } };

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, "account_registration_delivery_misconfigured");
  assert.match(payload.error.message, /VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL/);
});

test("password recovery request uses webhook delivery without leaking the token", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  const webhook = await startTokenDeliveryWebhookServer();
  withEnvOverrides(
    {
      VEIL_PASSWORD_RECOVERY_DELIVERY_MODE: "webhook",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL: webhook.url,
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_BEARER_TOKEN: "veil-webhook-secret"
    },
    cleanup
  );

  const port = 44748 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "webhook-recovery-player",
    displayName: "Webhook Recovery"
  });
  await store.bindPlayerAccountCredentials("webhook-recovery-player", {
    loginId: "webhook-recovery-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    await webhook.close().catch(() => undefined);
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const firstResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "webhook-recovery-ranger"
    })
  });
  const firstPayload = (await firstResponse.json()) as {
    status: string;
    expiresAt?: string;
    recoveryToken?: string;
  };

  assert.equal(firstResponse.status, 202);
  assert.equal(firstPayload.status, "recovery_requested");
  assert.ok(firstPayload.expiresAt);
  assert.equal(firstPayload.recoveryToken, undefined);
  assert.equal(webhook.requests.length, 1);
  assert.equal(webhook.requests[0]?.headers.authorization, "Bearer veil-webhook-secret");
  assert.equal(webhook.requests[0]?.body.event, "password-recovery");
  assert.equal(webhook.requests[0]?.body.loginId, "webhook-recovery-ranger");
  assert.equal(webhook.requests[0]?.body.playerId, "webhook-recovery-player");
  assert.equal(webhook.requests[0]?.body.expiresAt, firstPayload.expiresAt);
  assert.equal(typeof webhook.requests[0]?.body.token, "string");

  const secondResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "webhook-recovery-ranger"
    })
  });
  const secondPayload = (await secondResponse.json()) as {
    status: string;
    expiresAt?: string;
    recoveryToken?: string;
  };

  assert.equal(secondResponse.status, 202);
  assert.equal(secondPayload.recoveryToken, undefined);
  assert.equal(secondPayload.expiresAt, firstPayload.expiresAt);
  assert.equal(webhook.requests.length, 2);
  assert.equal(webhook.requests[1]?.body.token, webhook.requests[0]?.body.token);

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "webhook-recovery-ranger",
      recoveryToken: webhook.requests[0]?.body.token,
      newPassword: "hunter3"
    })
  });

  assert.equal(confirmResponse.status, 200);
});

test("password recovery request schedules retry for retryable webhook failures and exposes delivery observability", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  const webhook = await startTokenDeliveryWebhookServer({ statusCode: 500 });
  withEnvOverrides(
    {
      VEIL_PASSWORD_RECOVERY_DELIVERY_MODE: "webhook",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL: webhook.url,
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_MAX_ATTEMPTS: "3",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_BASE_DELAY_MS: "20",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_MAX_DELAY_MS: "20"
    },
    cleanup
  );

  const port = 44749 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "failed-recovery-player",
    displayName: "Failed Recovery"
  });
  await store.bindPlayerAccountCredentials("failed-recovery-player", {
    loginId: "failed-recovery-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    await webhook.close().catch(() => undefined);
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "failed-recovery-ranger"
    })
  });
  const payload = (await response.json()) as {
    status: string;
    deliveryStatus: string;
    deliveryAttemptCount?: number;
    deliveryMaxAttempts?: number;
    deliveryNextAttemptAt?: string;
    recoveryToken?: string;
  };

  assert.equal(response.status, 202);
  assert.equal(payload.status, "recovery_requested");
  assert.equal(payload.deliveryStatus, "retry_scheduled");
  assert.equal(payload.deliveryAttemptCount, 1);
  assert.equal(payload.deliveryMaxAttempts, 3);
  assert.ok(payload.deliveryNextAttemptAt);
  assert.equal(payload.recoveryToken, undefined);
  assert.equal(webhook.requests.length, 1);

  const queuedResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/account-token-delivery`);
  const queuedPayload = (await queuedResponse.json()) as {
    status: string;
    delivery: {
      queueCount: number;
      deadLetterCount: number;
      counters: {
        tokenDeliveryRequestsTotal: number;
        tokenDeliveryFailuresTotal: number;
        tokenDeliveryRetriesTotal: number;
      };
      recentAttempts: Array<{
        status: string;
        failureReason?: string;
      }>;
    };
  };

  assert.equal(queuedResponse.status, 200);
  assert.equal(queuedPayload.status, "warn");
  assert.equal(queuedPayload.delivery.queueCount, 1);
  assert.equal(queuedPayload.delivery.deadLetterCount, 0);
  assert.equal(queuedPayload.delivery.counters.tokenDeliveryRequestsTotal, 1);
  assert.equal(queuedPayload.delivery.counters.tokenDeliveryFailuresTotal, 1);
  assert.equal(queuedPayload.delivery.counters.tokenDeliveryRetriesTotal, 1);
  assert.equal(queuedPayload.delivery.recentAttempts[0]?.status, "retry_scheduled");
  assert.equal(queuedPayload.delivery.recentAttempts[0]?.failureReason, "webhook_5xx");

  webhook.setStatusCode(204);
  await sleep(120);

  assert.equal(webhook.requests.length, 2);
  assert.equal(webhook.requests[1]?.body.token, webhook.requests[0]?.body.token);

  const recoveredResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/account-token-delivery`);
  const recoveredPayload = (await recoveredResponse.json()) as {
    status: string;
    delivery: {
      queueCount: number;
      deadLetterCount: number;
      counters: {
        tokenDeliverySuccessesTotal: number;
        tokenDeliveryRetriesTotal: number;
      };
      recentAttempts: Array<{
        status: string;
      }>;
    };
  };

  assert.equal(recoveredResponse.status, 200);
  assert.equal(recoveredPayload.delivery.queueCount, 0);
  assert.equal(recoveredPayload.delivery.deadLetterCount, 0);
  assert.equal(recoveredPayload.delivery.counters.tokenDeliverySuccessesTotal, 1);
  assert.equal(recoveredPayload.delivery.counters.tokenDeliveryRetriesTotal, 1);
  assert.equal(recoveredPayload.delivery.recentAttempts[0]?.status, "delivered");
});

test("password recovery request returns 502 and dead-letters non-retryable webhook failures", { concurrency: false }, async (t) => {
  const cleanup: Array<() => void> = [];
  const webhook = await startTokenDeliveryWebhookServer({ statusCode: 400 });
  withEnvOverrides(
    {
      VEIL_PASSWORD_RECOVERY_DELIVERY_MODE: "webhook",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_URL: webhook.url,
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_MAX_ATTEMPTS: "3",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_BASE_DELAY_MS: "20",
      VEIL_AUTH_TOKEN_DELIVERY_WEBHOOK_RETRY_MAX_DELAY_MS: "20"
    },
    cleanup
  );

  const port = 44759 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  await store.ensurePlayerAccount({
    playerId: "dead-letter-recovery-player",
    displayName: "Dead Letter Recovery"
  });
  await store.bindPlayerAccountCredentials("dead-letter-recovery-player", {
    loginId: "dead-letter-recovery-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });

  t.after(async () => {
    cleanup.reverse().forEach((fn) => fn());
    await webhook.close().catch(() => undefined);
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/password-recovery/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "dead-letter-recovery-ranger"
    })
  });
  const payload = (await response.json()) as {
    error: { code: string; message: string };
    recoveryToken?: string;
  };

  assert.equal(response.status, 502);
  assert.equal(payload.error.code, "password_recovery_delivery_failed");
  assert.equal(payload.recoveryToken, undefined);
  assert.match(payload.error.message, /400/);
  assert.equal(webhook.requests.length, 1);

  const deliveryResponse = await fetch(`http://127.0.0.1:${port}/api/runtime/account-token-delivery`);
  const deliveryPayload = (await deliveryResponse.json()) as {
    status: string;
    delivery: {
      queueCount: number;
      deadLetterCount: number;
      counters: {
        tokenDeliveryFailuresTotal: number;
        tokenDeliveryDeadLettersTotal: number;
      };
      failureReasons: {
        webhook_4xx: number;
      };
      recentAttempts: Array<{
        status: string;
        failureReason?: string;
      }>;
    };
  };

  assert.equal(deliveryResponse.status, 200);
  assert.equal(deliveryPayload.status, "warn");
  assert.equal(deliveryPayload.delivery.queueCount, 0);
  assert.equal(deliveryPayload.delivery.deadLetterCount, 1);
  assert.equal(deliveryPayload.delivery.counters.tokenDeliveryFailuresTotal, 1);
  assert.equal(deliveryPayload.delivery.counters.tokenDeliveryDeadLettersTotal, 1);
  assert.equal(deliveryPayload.delivery.failureReasons.webhook_4xx, 1);
  assert.equal(deliveryPayload.delivery.recentAttempts[0]?.status, "dead-lettered");
  assert.equal(deliveryPayload.delivery.recentAttempts[0]?.failureReason, "webhook_4xx");
});

test("wechat login defaults to mock mode in NODE_ENV=test", { concurrency: false }, async (t) => {
  const port = 44750 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port);
  const previousNodeEnv = process.env.NODE_ENV;

  t.after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.NODE_ENV = "test";
  delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/wechat-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wechat-dev-code",
      playerId: "wechat-player",
      displayName: "云桥旅人",
      privacyConsentAccepted: true
    })
  });
  const payload = (await response.json()) as { session: GuestAuthSession };

  assert.equal(response.status, 200);
  assert.equal(payload.session.playerId, "wechat-player");
  assert.equal(payload.session.provider, "wechat-mini-game");
  assert.equal("session_key" in payload.session, false);
});

test("wechat login route can be explicitly disabled", { concurrency: false }, async (t) => {
  const port = 44850 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port, new MemoryAuthStore());

  t.after(async () => {
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "disabled";
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/wechat-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-dev-code",
      playerId: "wechat-player",
      displayName: "云桥旅人",
      privacyConsentAccepted: true
    })
  });
  const payload = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 501);
  assert.equal(payload.error.code, "wechat_login_not_enabled");
});

test("legacy wechat mini game route remains available as an alias", { concurrency: false }, async (t) => {
  const port = 44855 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port, new MemoryAuthStore());
  const previousNodeEnv = process.env.NODE_ENV;

  t.after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.NODE_ENV = "test";
  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "mock";
  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE = "wx-dev-code";
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/wechat-mini-game-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-dev-code",
      playerId: "wechat-player",
      displayName: "云桥旅人",
      privacyConsentAccepted: true
    })
  });
  const payload = (await response.json()) as { session: GuestAuthSession };

  assert.equal(response.status, 200);
  assert.equal(payload.session.playerId, "wechat-player");
  assert.equal(payload.session.provider, "wechat-mini-game");
  assert.equal(payload.session.authMode, "guest");
  assert.equal("session_key" in payload.session, false);
});

test("wechat mini game production exchange binds code2Session identity onto an authenticated account", { concurrency: false }, async (t) => {
  const port = 44950 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedAccept = "";

  await store.ensurePlayerAccount({
    playerId: "account-player",
    displayName: "暮潮守望"
  });
  await store.bindPlayerAccountCredentials("account-player", {
    loginId: "veil-ranger",
    passwordHash: "hashed-password"
  });

  const accountSession = issueAccountAuthSession({
    playerId: "account-player",
    displayName: "暮潮守望",
    loginId: "veil-ranger"
  });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    delete process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "production";
  process.env.WECHAT_APP_ID = "wx-prod-app";
  process.env.WECHAT_APP_SECRET = "wx-prod-secret";
  process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL = "https://wechat.example.test/code2session";
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedAccept = new Headers(init?.headers).get("Accept") ?? "";
    return new Response(
      JSON.stringify({
        openid: "wx-openid-prod",
        unionid: "wx-union-prod",
        session_key: "session-key"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  };

  const response = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accountSession.token}`
    },
    body: JSON.stringify({
      code: "wx-prod-code",
      displayName: "微信暮潮守望",
      avatarUrl: " https://cdn.example.com/avatar.png ",
      privacyConsentAccepted: true
    })
  });
  const payload = (await response.json()) as { session: GuestAuthSession };

  assert.equal(response.status, 200);
  assert.equal(payload.session.playerId, "account-player");
  assert.equal(payload.session.displayName, "微信暮潮守望");
  assert.equal(payload.session.provider, "wechat-mini-game");
  assert.equal(payload.session.authMode, "account");
  assert.equal(payload.session.loginId, "veil-ranger");
  assert.equal("session_key" in payload.session, false);

  const requestUrl = new URL(requestedUrl);
  assert.equal(requestUrl.origin + requestUrl.pathname, "https://wechat.example.test/code2session");
  assert.equal(requestUrl.searchParams.get("appid"), "wx-prod-app");
  assert.equal(requestUrl.searchParams.get("secret"), "wx-prod-secret");
  assert.equal(requestUrl.searchParams.get("js_code"), "wx-prod-code");
  assert.equal(requestUrl.searchParams.get("grant_type"), "authorization_code");
  assert.equal(requestedAccept, "application/json");

  const storedAccount = await store.loadPlayerAccount("account-player");
  assert.equal(storedAccount?.displayName, "微信暮潮守望");
  assert.equal(storedAccount?.avatarUrl, "https://cdn.example.com/avatar.png");
  assert.equal(storedAccount?.wechatMiniGameOpenId, "wx-openid-prod");
  assert.equal(storedAccount?.wechatMiniGameUnionId, "wx-union-prod");
  assert.equal(storedAccount?.loginId, "veil-ranger");
});

test("wechat mini game login stores verified minor status when age data is provided", { concurrency: false }, async (t) => {
  const port = 44980 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);
  const originalFetch = globalThis.fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    delete process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "production";
  process.env.WECHAT_APP_ID = "wx-prod-app";
  process.env.WECHAT_APP_SECRET = "wx-prod-secret";
  process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL = "https://wechat.example.test/code2session";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        openid: "wx-openid-minor",
        session_key: "session-key"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  const response = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-prod-code",
      playerId: "wechat-minor",
      displayName: "夜巡学员",
      isAdult: false,
      privacyConsentAccepted: true
    })
  });

  assert.equal(response.status, 200);
  const storedAccount = await store.loadPlayerAccount("wechat-minor");
  assert.equal(storedAccount?.ageVerified, true);
  assert.equal(storedAccount?.isMinor, true);
});

test("wechat mini game login reuses the bound player even when later requests spoof another playerId", { concurrency: false }, async (t) => {
  const port = 45050 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);
  const originalFetch = globalThis.fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.WECHAT_APP_ID;
    delete process.env.WECHAT_APP_SECRET;
    delete process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "production";
  process.env.WECHAT_APP_ID = "wx-prod-app";
  process.env.WECHAT_APP_SECRET = "wx-prod-secret";
  process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL = "https://wechat.example.test/code2session";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        openid: "wx-openid-repeat",
        session_key: "session-key"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  const firstResponse = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-prod-code",
      playerId: "wechat-player",
      displayName: "初次旅人",
      privacyConsentAccepted: true
    })
  });
  const firstPayload = (await firstResponse.json()) as { session: GuestAuthSession };

  const secondResponse = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-prod-code",
      playerId: "spoofed-player",
      displayName: "回归旅人",
      privacyConsentAccepted: true
    })
  });
  const secondPayload = (await secondResponse.json()) as { session: GuestAuthSession };

  assert.equal(firstResponse.status, 200);
  assert.equal(secondResponse.status, 200);
  assert.equal(firstPayload.session.playerId, "wechat-player");
  assert.equal(secondPayload.session.playerId, "wechat-player");
  assert.equal(secondPayload.session.displayName, "回归旅人");
  assert.equal(secondPayload.session.provider, "wechat-mini-game");
  assert.equal("session_key" in firstPayload.session, false);
  assert.equal("session_key" in secondPayload.session, false);

  const boundAccount = await store.loadPlayerAccount("wechat-player");
  const spoofedAccount = await store.loadPlayerAccount("spoofed-player");
  assert.equal(boundAccount?.wechatMiniGameOpenId, "wx-openid-repeat");
  assert.equal(boundAccount?.displayName, "回归旅人");
  assert.equal(spoofedAccount, null);
});

test("wechat session key refresh restores phone binding after cached session expiry", { concurrency: false }, async (t) => {
  const port = 45070 + Math.floor(Math.random() * 1000);
  const previousAppId = process.env.WECHAT_APP_ID;
  const previousTtl = process.env.VEIL_WECHAT_SESSION_KEY_TTL_SECONDS;
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);
  const originalFetch = globalThis.fetch;

  t.after(async () => {
    globalThis.fetch = originalFetch;
    process.env.WECHAT_APP_ID = previousAppId;
    process.env.VEIL_WECHAT_SESSION_KEY_TTL_SECONDS = previousTtl;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.WECHAT_APP_SECRET;
    delete process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL;
    resetWechatSessionKeyCache();
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "production";
  process.env.WECHAT_APP_ID = "wx-refresh-app";
  process.env.WECHAT_APP_SECRET = "wx-refresh-secret";
  process.env.VEIL_WECHAT_MINIGAME_CODE2SESSION_URL = "https://wechat.example.test/code2session";
  process.env.VEIL_WECHAT_SESSION_KEY_TTL_SECONDS = "1";
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const code = url.searchParams.get("js_code");
    const sessionKey =
      code === "wx-refresh-code"
        ? Buffer.from("fedcba0987654321", "utf8").toString("base64")
        : Buffer.from("1234567890abcdef", "utf8").toString("base64");
    return new Response(
      JSON.stringify({
        openid: "wx-openid-refresh",
        session_key: sessionKey
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  };

  const loginResponse = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-login-code",
      playerId: "wechat-refresh-player",
      displayName: "刷新旅人",
      privacyConsentAccepted: true
    })
  });
  const loginPayload = (await loginResponse.json()) as { session: GuestAuthSession };
  assert.equal(loginResponse.status, 200);

  await new Promise((resolve) => setTimeout(resolve, 1_100));

  const expiredPhoneResponse = await originalFetch(`http://127.0.0.1:${port}/api/player-accounts/me/phone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginPayload.session.token}`
    },
    body: JSON.stringify(
      createWechatPhonePayload({
        sessionKey: Buffer.from("1234567890abcdef", "utf8").toString("base64"),
        appId: "wx-refresh-app",
        phoneNumber: "+8613800138001"
      })
    )
  });
  assert.equal(expiredPhoneResponse.status, 403);

  const refreshResponse = await originalFetch(`http://127.0.0.1:${port}/api/auth/wechat-session-key/refresh`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginPayload.session.token}`
    },
    body: JSON.stringify({
      code: "wx-refresh-code"
    })
  });
  assert.equal(refreshResponse.status, 200);

  const reboundPhoneResponse = await originalFetch(`http://127.0.0.1:${port}/api/player-accounts/me/phone`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${loginPayload.session.token}`
    },
    body: JSON.stringify(
      createWechatPhonePayload({
        sessionKey: Buffer.from("fedcba0987654321", "utf8").toString("base64"),
        appId: "wx-refresh-app",
        phoneNumber: "+8613800138002"
      })
    )
  });
  const reboundPayload = (await reboundPhoneResponse.json()) as {
    account: PlayerAccountSnapshot;
  };

  assert.equal(reboundPhoneResponse.status, 200);
  assert.equal(reboundPayload.account.phoneNumber, "+8613800138002");
});

test("wechat mock mode stays disabled outside NODE_ENV=test", { concurrency: false }, async (t) => {
  const port = 45080 + Math.floor(Math.random() * 1000);
  const server = await startAuthServer(port, new MemoryAuthStore());
  const previousNodeEnv = process.env.NODE_ENV;

  t.after(async () => {
    process.env.NODE_ENV = previousNodeEnv;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE;
    delete process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE;
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  process.env.NODE_ENV = "development";
  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MODE = "mock";
  process.env.VEIL_WECHAT_MINIGAME_LOGIN_MOCK_CODE = "wx-dev-code";

  const response = await fetch(`http://127.0.0.1:${port}/api/auth/wechat-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      code: "wx-dev-code",
      playerId: "wechat-player",
      displayName: "云桥旅人"
    })
  });
  const payload = (await response.json()) as { error: { code: string } };

  assert.equal(response.status, 501);
  assert.equal(payload.error.code, "wechat_login_not_enabled");
});

test("banned accounts are blocked on account-login and subsequent session checks with reason and expiry", async (t) => {
  const port = 45120 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  await store.ensurePlayerAccount({
    playerId: "banned-player",
    displayName: "Banned Ranger"
  });
  await store.bindPlayerAccountCredentials("banned-player", {
    loginId: "banned-ranger",
    passwordHash: hashAccountPassword("secret-pass")
  });
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const initialLoginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "banned-ranger",
      password: "secret-pass",
      privacyConsentAccepted: true
    })
  });
  const initialLoginPayload = (await initialLoginResponse.json()) as { session: GuestAuthSession };
  assert.equal(initialLoginResponse.status, 200);

  await store.savePlayerBan("banned-player", {
    banStatus: "temporary",
    banExpiry: "2026-04-06T00:00:00.000Z",
    banReason: "Harassment"
  });

  const sessionResponse = await fetch(`http://127.0.0.1:${port}/api/auth/session`, {
    headers: {
      Authorization: `Bearer ${initialLoginPayload.session.token}`
    }
  });
  const sessionPayload = (await sessionResponse.json()) as {
    error: { code: string; reason: string; expiry?: string };
  };
  assert.equal(sessionResponse.status, 403);
  assert.equal(sessionPayload.error.code, "account_banned");
  assert.equal(sessionPayload.error.reason, "Harassment");
  assert.equal(sessionPayload.error.expiry, "2026-04-06T00:00:00.000Z");

  const reloginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "banned-ranger",
      password: "secret-pass",
      privacyConsentAccepted: true
    })
  });
  const reloginPayload = (await reloginResponse.json()) as {
    error: { code: string; reason: string; expiry?: string };
  };
  assert.equal(reloginResponse.status, 403);
  assert.equal(reloginPayload.error.code, "account_banned");
  assert.equal(reloginPayload.error.reason, "Harassment");
  assert.equal(reloginPayload.error.expiry, "2026-04-06T00:00:00.000Z");
});

test("guest login requires privacy consent before issuing the first session", async (t) => {
  const port = 45160 + Math.floor(Math.random() * 1000);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const rejectedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "guest-consent",
      displayName: "雾行者"
    })
  });
  const rejectedPayload = (await rejectedResponse.json()) as { error: { code: string } };
  assert.equal(rejectedResponse.status, 403);
  assert.equal(rejectedPayload.error.code, "privacy_consent_required");

  const acceptedResponse = await fetch(`http://127.0.0.1:${port}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId: "guest-consent",
      displayName: "雾行者",
      privacyConsentAccepted: true
    })
  });
  assert.equal(acceptedResponse.status, 200);
  assert.ok((await store.loadPlayerAccount("guest-consent"))?.privacyConsentAt);
});

test("account registration confirmation requires privacy consent", async (t) => {
  const port = 45180 + Math.floor(Math.random() * 1000);
  const cleanup: Array<() => void> = [];
  withEnvOverrides({ VEIL_ACCOUNT_REGISTRATION_DELIVERY_MODE: "dev-token" }, cleanup);
  const store = new MemoryAuthStore();
  const server = await startAuthServer(port, store);

  t.after(async () => {
    while (cleanup.length > 0) {
      cleanup.pop()?.();
    }
    resetGuestAuthSessions();
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const requestResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/request`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "consent-ranger",
      displayName: "同意旅人"
    })
  });
  const requestPayload = (await requestResponse.json()) as { registrationToken?: string };

  const confirmResponse = await fetch(`http://127.0.0.1:${port}/api/auth/account-registration/confirm`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      loginId: "consent-ranger",
      registrationToken: requestPayload.registrationToken,
      password: "hunter2"
    })
  });
  const confirmPayload = (await confirmResponse.json()) as { error: { code: string } };
  assert.equal(confirmResponse.status, 403);
  assert.equal(confirmPayload.error.code, "privacy_consent_required");
});
