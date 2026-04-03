import {
  normalizeEloRating,
  normalizeEventLogEntries,
  normalizeEventLogQuery,
  type EventLogEntry
} from "../../../packages/shared/src/index";
import {
  createPlayerAccountsFromWorldState,
  MAX_PLAYER_AVATAR_URL_LENGTH,
  MAX_PLAYER_DISPLAY_NAME_LENGTH,
  type RoomSnapshotStore,
  type PlayerAccountBanHistoryListOptions,
  type PlayerAccountBanInput,
  type PlayerAccountBanSnapshot,
  type PlayerAccountAuthSnapshot,
  type PlayerAccountAuthRevokeInput,
  type PlayerAccountAuthSessionInput,
  type PlayerAccountDeviceSessionSnapshot,
  type PlayerAccountCredentialInput,
  type PlayerAccountEnsureInput,
  type PlayerAccountListOptions,
  type PlayerAccountUnbanInput,
  type PlayerBanHistoryRecord,
  type PlayerAccountWechatMiniGameIdentityInput,
  type PlayerAccountProfilePatch,
  type PlayerAccountProgressPatch,
  type PlayerAccountSnapshot,
  type PlayerHeroArchiveSnapshot,
  type PlayerEventHistoryQuery,
  type PlayerEventHistorySnapshot
} from "./persistence";
import type { RoomPersistenceSnapshot } from "./index";

function cloneAccount(account: PlayerAccountSnapshot): PlayerAccountSnapshot {
  return structuredClone(account);
}

function cloneArchive(archive: PlayerHeroArchiveSnapshot): PlayerHeroArchiveSnapshot {
  return structuredClone(archive);
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

export class MemoryRoomSnapshotStore implements RoomSnapshotStore {
  private readonly snapshots = new Map<string, RoomPersistenceSnapshot>();
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly banHistoryByPlayerId = new Map<string, PlayerBanHistoryRecord[]>();
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();
  private readonly authSessionsByPlayerId = new Map<string, Map<string, PlayerAccountDeviceSessionSnapshot>>();
  private readonly playerIdByWechatOpenId = new Map<string, string>();
  private readonly heroArchives = new Map<string, PlayerHeroArchiveSnapshot>();

  async load(roomId: string): Promise<RoomPersistenceSnapshot | null> {
    const snapshot = this.snapshots.get(roomId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    const account = this.accounts.get(normalizePlayerId(playerId));
    return account ? cloneAccount(account) : null;
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

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(normalizePlayerId(playerId)))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account))
      .map((account) => cloneAccount(account));
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
    const nextAccount: PlayerAccountSnapshot = {
      playerId,
      displayName: normalizeDisplayName(playerId, input.displayName ?? existing?.displayName),
      ...(existing?.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      eloRating: normalizeEloRating(existing?.eloRating),
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: existing?.achievements ?? [],
      recentEventLog: existing?.recentEventLog ?? [],
      recentBattleReplays: existing?.recentBattleReplays ?? [],
      ...(input.lastRoomId?.trim()
        ? { lastRoomId: input.lastRoomId.trim() }
        : existing?.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.banStatus ? { banStatus: existing.banStatus } : {}),
      ...(existing?.banExpiry ? { banExpiry: existing.banExpiry } : {}),
      ...(existing?.banReason ? { banReason: existing.banReason } : {}),
      ...(existing?.accountSessionVersion != null ? { accountSessionVersion: existing.accountSessionVersion } : {}),
      ...(existing?.refreshSessionId ? { refreshSessionId: existing.refreshSessionId } : {}),
      ...(existing?.refreshTokenExpiresAt ? { refreshTokenExpiresAt: existing.refreshTokenExpiresAt } : {}),
      ...(existing?.wechatMiniGameOpenId ? { wechatMiniGameOpenId: existing.wechatMiniGameOpenId } : {}),
      ...(existing?.wechatMiniGameUnionId ? { wechatMiniGameUnionId: existing.wechatMiniGameUnionId } : {}),
      ...(existing?.wechatMiniGameBoundAt ? { wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt } : {}),
      ...(existing?.credentialBoundAt ? { credentialBoundAt: existing.credentialBoundAt } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const stored = structuredClone(nextAccount);
    this.accounts.set(playerId, stored);
    return structuredClone(stored);
  }

  async listPlayerBanHistory(
    playerId: string,
    options: PlayerAccountBanHistoryListOptions = {}
  ): Promise<PlayerBanHistoryRecord[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    return structuredClone((this.banHistoryByPlayerId.get(normalizedPlayerId) ?? []).slice(0, safeLimit));
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
    const normalizedAvatarUrl = normalizeAvatarUrl(input.avatarUrl);
    const normalizedUnionId = input.unionId?.trim() || existing.wechatMiniGameUnionId;

    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      displayName: nextDisplayName,
      ...(normalizedAvatarUrl ? { avatarUrl: normalizedAvatarUrl } : existing.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      wechatMiniGameOpenId: normalizedOpenId,
      ...(normalizedUnionId ? { wechatMiniGameUnionId: normalizedUnionId } : {}),
      wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(normalizedPlayerId, cloneAccount(nextAccount));
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

  async savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const normalizedAvatarUrl =
      patch.avatarUrl !== undefined ? normalizeAvatarUrl(patch.avatarUrl) : existing.avatarUrl;
    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      displayName:
        patch.displayName !== undefined
          ? normalizeDisplayName(normalizedPlayerId, patch.displayName)
          : existing.displayName,
      ...(normalizedAvatarUrl ? { avatarUrl: normalizedAvatarUrl } : {}),
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
    const existing = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      globalResources: structuredClone(
        (patch.globalResources as PlayerAccountSnapshot["globalResources"] | undefined) ?? existing.globalResources
      ),
      achievements: structuredClone((patch.achievements as PlayerAccountSnapshot["achievements"] | undefined) ?? existing.achievements),
      recentEventLog: structuredClone((patch.recentEventLog as PlayerAccountSnapshot["recentEventLog"] | undefined) ?? existing.recentEventLog),
      recentBattleReplays: structuredClone(
        (patch.recentBattleReplays as PlayerAccountSnapshot["recentBattleReplays"] | undefined) ??
          existing.recentBattleReplays ??
          []
      ),
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

  async listPlayerAccounts(options: PlayerAccountListOptions = {}): Promise<PlayerAccountSnapshot[]> {
    const filtered = Array.from(this.accounts.values())
      .filter((account) => (options.playerId ? account.playerId === options.playerId : true))
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
    return filtered.slice(0, Math.max(1, Math.floor(options.limit ?? 20))).map((account) => cloneAccount(account));
  }

  async save(roomId: string, snapshot: RoomPersistenceSnapshot): Promise<void> {
    this.snapshots.set(roomId, structuredClone(snapshot));
    for (const account of createPlayerAccountsFromWorldState(snapshot.state)) {
      const previous = this.accounts.get(account.playerId);
      this.accounts.set(account.playerId, {
        ...cloneAccount(account),
        displayName: previous?.displayName ?? account.displayName,
        ...(previous?.avatarUrl ? { avatarUrl: previous.avatarUrl } : {}),
        eloRating: normalizeEloRating(previous?.eloRating ?? account.eloRating),
        achievements: structuredClone(previous?.achievements ?? account.achievements),
        recentEventLog: structuredClone(previous?.recentEventLog ?? account.recentEventLog),
        recentBattleReplays: structuredClone(previous?.recentBattleReplays ?? account.recentBattleReplays ?? []),
        ...(previous?.loginId ? { loginId: previous.loginId } : {}),
        ...(previous?.accountSessionVersion != null ? { accountSessionVersion: previous.accountSessionVersion } : {}),
        ...(previous?.refreshSessionId ? { refreshSessionId: previous.refreshSessionId } : {}),
        ...(previous?.refreshTokenExpiresAt ? { refreshTokenExpiresAt: previous.refreshTokenExpiresAt } : {}),
        ...(previous?.wechatMiniGameOpenId ? { wechatMiniGameOpenId: previous.wechatMiniGameOpenId } : {}),
        ...(previous?.wechatMiniGameUnionId ? { wechatMiniGameUnionId: previous.wechatMiniGameUnionId } : {}),
        ...(previous?.wechatMiniGameBoundAt ? { wechatMiniGameBoundAt: previous.wechatMiniGameBoundAt } : {}),
        ...(previous?.credentialBoundAt ? { credentialBoundAt: previous.credentialBoundAt } : {}),
        ...(previous?.lastRoomId ? { lastRoomId: previous.lastRoomId } : {}),
        ...(previous?.lastSeenAt ? { lastSeenAt: previous.lastSeenAt } : {}),
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

  async delete(roomId: string): Promise<void> {
    this.snapshots.delete(roomId);
  }

  async pruneExpired(): Promise<number> {
    return 0;
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
  }
}

export function createMemoryRoomSnapshotStore(): RoomSnapshotStore {
  return new MemoryRoomSnapshotStore();
}
