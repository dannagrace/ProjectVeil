import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { issueAccountAuthSession, issueGuestAuthSession, issueWechatMiniGameAuthSession, hashAccountPassword } from "../src/auth";
import { applyPlayerEventLogAndAchievements } from "../src/player-achievements";
import { registerPlayerAccountRoutes } from "../src/player-accounts";
import type {
  PlayerAccountProgressPatch,
  PlayerAccountAuthSnapshot,
  PlayerAccountDeviceSessionSnapshot,
  PlayerAccountCredentialInput,
  PlayerAccountEnsureInput,
  PlayerEventHistoryQuery,
  PlayerEventHistorySnapshot,
  PlayerAccountListOptions,
  PlayerAccountProfilePatch,
  PlayerAccountSnapshot,
  PlayerHeroArchiveSnapshot,
  RoomSnapshotStore
} from "../src/persistence";
import type { RoomPersistenceSnapshot } from "../src/index";
import {
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  queryEventLogEntries,
  type PlayerAchievementProgress,
  type PlayerProgressionSnapshot,
  type PlayerBattleReplaySummary,
  type WorldState
} from "../../../packages/shared/src/index";

class MemoryPlayerAccountStore implements RoomSnapshotStore {
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();
  private readonly authSessionsByPlayerId = new Map<string, Map<string, PlayerAccountDeviceSessionSnapshot>>();
  private readonly playerIdByWechatOpenId = new Map<string, string>();
  private readonly eventHistoryByPlayerId = new Map<string, PlayerAccountSnapshot["recentEventLog"]>();

  async load(_roomId: string): Promise<RoomPersistenceSnapshot | null> {
    return null;
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    return this.accounts.get(playerId) ?? null;
  }

  async loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedLoginId = loginId.trim().toLowerCase();
    return (
      Array.from(this.accounts.values()).find((account) => account.loginId === normalizedLoginId) ?? null
    );
  }

  async loadPlayerAccountByWechatMiniGameOpenId(openId: string): Promise<PlayerAccountSnapshot | null> {
    const playerId = this.playerIdByWechatOpenId.get(openId.trim());
    return playerId ? this.accounts.get(playerId) ?? null : null;
  }

  async loadPlayerEventHistory(
    playerId: string,
    query: PlayerEventHistoryQuery = {}
  ): Promise<PlayerEventHistorySnapshot> {
    const items = queryEventLogEntries(this.eventHistoryByPlayerId.get(playerId) ?? [], query);
    const total = queryEventLogEntries(this.eventHistoryByPlayerId.get(playerId) ?? [], {
      ...query,
      limit: undefined,
      offset: undefined
    }).length;

    return {
      items,
      total
    };
  }

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(playerId))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account));
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
    const existing = this.accounts.get(input.playerId);
    const account: PlayerAccountSnapshot = {
      playerId: input.playerId,
      displayName: input.displayName?.trim() || existing?.displayName || input.playerId,
      ...(existing?.avatarUrl ? { avatarUrl: existing.avatarUrl } : {}),
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: structuredClone(existing?.achievements ?? []),
      recentEventLog: structuredClone(existing?.recentEventLog ?? []),
      recentBattleReplays: structuredClone(existing?.recentBattleReplays ?? []),
      ...(input.lastRoomId?.trim() ? { lastRoomId: input.lastRoomId.trim() } : existing?.lastRoomId ? { lastRoomId: existing.lastRoomId } : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.wechatMiniGameOpenId ? { wechatMiniGameOpenId: existing.wechatMiniGameOpenId } : {}),
      ...(existing?.wechatMiniGameUnionId ? { wechatMiniGameUnionId: existing.wechatMiniGameUnionId } : {}),
      ...(existing?.wechatMiniGameBoundAt ? { wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt } : {}),
      ...(existing?.credentialBoundAt ? { credentialBoundAt: existing.credentialBoundAt } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(account.playerId, account);
    return account;
  }

  async bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const normalizedLoginId = input.loginId.trim().toLowerCase();
    const owner = await this.loadPlayerAccountByLoginId(normalizedLoginId);
    if (owner && owner.playerId !== playerId) {
      throw new Error("loginId is already taken");
    }

    const credentialBoundAt = existing.credentialBoundAt ?? new Date().toISOString();
    const account: PlayerAccountSnapshot = {
      ...existing,
      loginId: normalizedLoginId,
      credentialBoundAt,
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, account);
    this.authByLoginId.set(normalizedLoginId, {
      playerId,
      displayName: account.displayName,
      loginId: normalizedLoginId,
      passwordHash: input.passwordHash,
      accountSessionVersion: existing.accountSessionVersion ?? 0,
      credentialBoundAt
    });
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
    input: { openId: string; unionId?: string; displayName?: string; avatarUrl?: string | null }
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({
      playerId,
      ...(input.displayName?.trim() ? { displayName: input.displayName } : {})
    });
    const normalizedOpenId = input.openId.trim();
    const owner = await this.loadPlayerAccountByWechatMiniGameOpenId(normalizedOpenId);
    if (owner && owner.playerId !== playerId) {
      throw new Error("wechatMiniGameOpenId is already taken");
    }

    const account: PlayerAccountSnapshot = {
      ...existing,
      ...(input.displayName?.trim() ? { displayName: input.displayName.trim() } : {}),
      ...(input.avatarUrl !== undefined
        ? input.avatarUrl?.trim()
          ? { avatarUrl: input.avatarUrl.trim() }
          : {}
        : existing.avatarUrl
          ? { avatarUrl: existing.avatarUrl }
          : {}),
      wechatMiniGameOpenId: normalizedOpenId,
      ...(input.unionId?.trim() ? { wechatMiniGameUnionId: input.unionId.trim() } : existing.wechatMiniGameUnionId ? { wechatMiniGameUnionId: existing.wechatMiniGameUnionId } : {}),
      wechatMiniGameBoundAt: existing.wechatMiniGameBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, account);
    this.playerIdByWechatOpenId.set(normalizedOpenId, playerId);
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
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, account);
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
      achievements: structuredClone((patch.achievements as PlayerAccountSnapshot["achievements"] | undefined) ?? existing.achievements),
      recentEventLog: structuredClone((patch.recentEventLog as PlayerAccountSnapshot["recentEventLog"] | undefined) ?? existing.recentEventLog),
      recentBattleReplays: structuredClone(
        (patch.recentBattleReplays as PlayerAccountSnapshot["recentBattleReplays"] | undefined) ?? existing.recentBattleReplays
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
    this.accounts.set(playerId, account);
    return account;
  }

  async listPlayerAccounts(options: PlayerAccountListOptions = {}): Promise<PlayerAccountSnapshot[]> {
    const accounts = Array.from(this.accounts.values()).filter((account) =>
      options.playerId ? account.playerId === options.playerId : true
    );
    return accounts.slice(0, Math.max(1, Math.floor(options.limit ?? 20)));
  }

  async save(_roomId: string, _snapshot: RoomPersistenceSnapshot): Promise<void> {}

  async delete(_roomId: string): Promise<void> {}

  async pruneExpired(): Promise<number> {
    return 0;
  }

  async close(): Promise<void> {}

  seedAccount(account: PlayerAccountSnapshot): void {
    this.accounts.set(account.playerId, account);
    if (!this.eventHistoryByPlayerId.has(account.playerId)) {
      this.eventHistoryByPlayerId.set(account.playerId, structuredClone(account.recentEventLog ?? []));
    }
  }

  seedEventHistory(playerId: string, entries: PlayerAccountSnapshot["recentEventLog"]): void {
    this.eventHistoryByPlayerId.set(playerId, structuredClone(entries));
  }
}

async function startAccountRouteServer(port: number, store: RoomSnapshotStore | null): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

function createAccountTrackingWorldState(): WorldState {
  return {
    meta: {
      roomId: "room-achievement",
      seed: 1001,
      day: 1
    },
    map: {
      width: 1,
      height: 1,
      tiles: [
        {
          position: { x: 0, y: 0 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        }
      ]
    },
    heroes: [
      {
        id: "hero-1",
        playerId: "player-1",
        name: "暮火侦骑",
        position: { x: 0, y: 0 },
        vision: 2,
        move: { total: 6, remaining: 6 },
        stats: { attack: 2, defense: 2, power: 1, knowledge: 1, hp: 20, maxHp: 20 },
        progression: createDefaultHeroProgression(),
        loadout: createDefaultHeroLoadout(),
        armyTemplateId: "hero_guard_basic",
        armyCount: 12,
        learnedSkills: []
      }
    ],
    neutralArmies: {},
    buildings: {},
    resources: {
      "player-1": { gold: 0, wood: 0, ore: 0 }
    },
    visibilityByPlayer: {}
  };
}

function createEpicEquipmentTrackingWorldState(): WorldState {
  const base = createAccountTrackingWorldState();
  return {
    ...base,
    heroes: [
      {
        ...base.heroes[0]!,
        loadout: {
          ...createDefaultHeroLoadout(),
          equipment: {
            weaponId: "sunforged_spear",
            armorId: "warden_aegis",
            accessoryId: "sun_medallion",
            trinketIds: []
          },
          inventory: []
        }
      }
    ]
  };
}

function createFullyExploredTrackingWorldState(): WorldState {
  const base = createAccountTrackingWorldState();
  return {
    ...base,
    map: {
      width: 2,
      height: 2,
      tiles: [
        {
          position: { x: 0, y: 0 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 1, y: 0 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 0, y: 1 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 1, y: 1 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        }
      ]
    },
    visibilityByPlayer: {
      "player-1": ["visible", "explored", "visible", "explored"]
    }
  };
}

function createReplaySummary(
  id: string,
  completedAt: string,
  overrides: Partial<PlayerBattleReplaySummary> = {}
): PlayerBattleReplaySummary {
  return {
    id,
    roomId: overrides.roomId ?? "room-replay",
    playerId: overrides.playerId ?? "player-1",
    battleId: overrides.battleId ?? `${id}-battle`,
    battleKind: overrides.battleKind ?? "hero",
    playerCamp: overrides.playerCamp ?? "attacker",
    heroId: overrides.heroId ?? "hero-1",
    ...(overrides.opponentHeroId !== undefined ? { opponentHeroId: overrides.opponentHeroId } : { opponentHeroId: "hero-2" }),
    ...(overrides.neutralArmyId !== undefined ? { neutralArmyId: overrides.neutralArmyId } : {}),
    startedAt: overrides.startedAt ?? "2026-03-27T11:55:00.000Z",
    completedAt,
    initialState: overrides.initialState ?? {
      id: `${id}-battle`,
      round: 1,
      lanes: 2,
      activeUnitId: "unit-1",
      turnOrder: ["unit-1", "unit-2"],
      units: {
        "unit-1": {
          id: "unit-1",
          camp: "attacker",
          templateId: "hero_guard_basic",
          lane: 0,
          stackName: "暮火侦骑",
          initiative: 4,
          attack: 2,
          defense: 2,
          minDamage: 1,
          maxDamage: 2,
          currentHp: 10,
          count: 12,
          maxHp: 10,
          hasRetaliated: false,
          defending: false
        },
        "unit-2": {
          id: "unit-2",
          camp: "defender",
          templateId: "hero_guard_basic",
          lane: 1,
          stackName: "守军",
          initiative: 4,
          attack: 2,
          defense: 2,
          minDamage: 1,
          maxDamage: 2,
          currentHp: 10,
          count: 12,
          maxHp: 10,
          hasRetaliated: false,
          defending: false
        }
      },
      environment: [],
      log: [],
      rng: { seed: 7, cursor: 0 }
    },
    steps: overrides.steps ?? [],
    result: overrides.result ?? "attacker_victory"
  };
}

test("player account routes list and fetch stored accounts", async (t) => {
  const port = 40000 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-1",
    displayName: "灰烬领主",
    globalResources: { gold: 320, wood: 5, ore: 1 },
    achievements: [],
    recentEventLog: [],
    lastRoomId: "room-alpha",
    lastSeenAt: new Date("2026-03-25T09:00:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const listResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts`);
  const listPayload = (await listResponse.json()) as { items: PlayerAccountSnapshot[] };
  assert.equal(listResponse.status, 200);
  assert.equal(listPayload.items[0]?.displayName, "灰烬领主");

  const detailResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-1`);
  const detailPayload = (await detailResponse.json()) as { account: PlayerAccountSnapshot };
  assert.equal(detailResponse.status, 200);
  assert.equal(detailPayload.account.playerId, "player-1");
  assert.equal(detailPayload.account.lastRoomId, "room-alpha");
});

test("player account public routes redact credential and WeChat identity bindings while owner access keeps them", async (t) => {
  const port = 40012 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  await store.ensurePlayerAccount({
    playerId: "player-bound",
    displayName: "云岚信使"
  });
  await store.bindPlayerAccountCredentials("player-bound", {
    loginId: "veil-ranger",
    passwordHash: "hashed-password"
  });
  await store.bindPlayerAccountWechatMiniGameIdentity("player-bound", {
    openId: "wx-openid-bound",
    unionId: "wx-union-bound",
    displayName: "云岚信使",
    avatarUrl: "https://cdn.example.test/avatar.png"
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueWechatMiniGameAuthSession({
    playerId: "player-bound",
    displayName: "云岚信使",
    loginId: "veil-ranger"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const listResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts`);
  const listPayload = (await listResponse.json()) as { items: PlayerAccountSnapshot[] };
  assert.equal(listResponse.status, 200);
  assert.equal(listPayload.items[0]?.playerId, "player-bound");
  assert.equal("loginId" in (listPayload.items[0] ?? {}), false);
  assert.equal("credentialBoundAt" in (listPayload.items[0] ?? {}), false);
  assert.equal("wechatMiniGameOpenId" in (listPayload.items[0] ?? {}), false);
  assert.equal("wechatMiniGameUnionId" in (listPayload.items[0] ?? {}), false);

  const detailResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-bound`);
  const detailPayload = (await detailResponse.json()) as { account: PlayerAccountSnapshot };
  assert.equal(detailResponse.status, 200);
  assert.equal("loginId" in detailPayload.account, false);
  assert.equal("credentialBoundAt" in detailPayload.account, false);
  assert.equal("wechatMiniGameOpenId" in detailPayload.account, false);
  assert.equal("wechatMiniGameUnionId" in detailPayload.account, false);
  assert.match(detailPayload.account.wechatMiniGameBoundAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: {
      token: string;
      authMode: "guest" | "account";
      provider?: string;
      loginId?: string;
    };
  };

  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.account.loginId, "veil-ranger");
  assert.match(mePayload.account.credentialBoundAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(mePayload.account.wechatMiniGameOpenId, "wx-openid-bound");
  assert.equal(mePayload.account.wechatMiniGameUnionId, "wx-union-bound");
  assert.equal(mePayload.session.authMode, "account");
  assert.equal(mePayload.session.provider, "wechat-mini-game");
  assert.equal(mePayload.session.loginId, "veil-ranger");
});

test("player account routes degrade to local-mode responses when persistence is unavailable", async (t) => {
  const port = 40025 + Math.floor(Math.random() * 1000);
  const server = await startAccountRouteServer(port, null);
  const session = issueGuestAuthSession({
    playerId: "player-local",
    displayName: "本地侦骑"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const listResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts`);
  const listPayload = (await listResponse.json()) as { items: PlayerAccountSnapshot[] };
  assert.equal(listResponse.status, 200);
  assert.deepEqual(listPayload.items, []);

  const detailResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-local`);
  const detailPayload = (await detailResponse.json()) as { account: PlayerAccountSnapshot };
  assert.equal(detailResponse.status, 200);
  assert.equal(detailPayload.account.playerId, "player-local");
  assert.equal(detailPayload.account.displayName, "player-local");
  assert.deepEqual(detailPayload.account.globalResources, { gold: 0, wood: 0, ore: 0 });

  const publicReplayResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-local/battle-replays`);
  const publicReplayPayload = (await publicReplayResponse.json()) as { items: PlayerBattleReplaySummary[] };
  assert.equal(publicReplayResponse.status, 200);
  assert.deepEqual(publicReplayPayload.items, []);

  const publicAchievementResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-local/achievements`);
  const publicAchievementPayload = (await publicAchievementResponse.json()) as { items: PlayerAchievementProgress[] };
  assert.equal(publicAchievementResponse.status, 200);
  assert.equal(publicAchievementPayload.items.length, 5);
  assert.equal(publicAchievementPayload.items[0]?.id, "first_battle");

  const publicProgressResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-local/progression`);
  const publicProgressPayload = (await publicProgressResponse.json()) as PlayerProgressionSnapshot;
  assert.equal(publicProgressResponse.status, 200);
  assert.equal(publicProgressPayload.summary.totalAchievements, 5);
  assert.equal(publicProgressPayload.summary.unlockedAchievements, 0);

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: { token: string; playerId: string; displayName: string };
  };
  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.account.playerId, "player-local");
  assert.equal(mePayload.account.displayName, "本地侦骑");
  assert.equal(mePayload.session.playerId, "player-local");

  const meReplayResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/battle-replays`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const meReplayPayload = (await meReplayResponse.json()) as { items: PlayerBattleReplaySummary[] };
  assert.equal(meReplayResponse.status, 200);
  assert.deepEqual(meReplayPayload.items, []);

  const meAchievementResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/achievements?unlocked=false&limit=2`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const meAchievementPayload = (await meAchievementResponse.json()) as { items: PlayerAchievementProgress[] };
  assert.equal(meAchievementResponse.status, 200);
  assert.deepEqual(meAchievementPayload.items.map((entry) => entry.id), ["first_battle", "enemy_slayer"]);

  const meProgressResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/progression`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const meProgressPayload = (await meProgressResponse.json()) as PlayerProgressionSnapshot;
  assert.equal(meProgressResponse.status, 200);
  assert.equal(meProgressPayload.summary.totalAchievements, 5);
  assert.equal(meProgressPayload.summary.unlockedAchievements, 0);
});

test("public guest player routes return empty fallback payloads instead of 404 noise", async (t) => {
  const port = 40045 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const accountResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/guest-preview`);
  const accountPayload = (await accountResponse.json()) as { account: PlayerAccountSnapshot };
  assert.equal(accountResponse.status, 200);
  assert.equal(accountPayload.account.playerId, "guest-preview");
  assert.equal(accountPayload.account.displayName, "guest-preview");
  assert.deepEqual(accountPayload.account.globalResources, { gold: 0, wood: 0, ore: 0 });

  const replayResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/guest-preview/battle-replays`);
  const replayPayload = (await replayResponse.json()) as { items: PlayerBattleReplaySummary[] };
  assert.equal(replayResponse.status, 200);
  assert.deepEqual(replayPayload.items, []);

  const eventLogResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/guest-preview/event-log?limit=2`);
  const eventLogPayload = (await eventLogResponse.json()) as { items: PlayerAccountSnapshot["recentEventLog"] };
  assert.equal(eventLogResponse.status, 200);
  assert.deepEqual(eventLogPayload.items ?? [], []);

  const achievementResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/guest-preview/achievements?limit=2`);
  const achievementPayload = (await achievementResponse.json()) as { items: PlayerAchievementProgress[] };
  assert.equal(achievementResponse.status, 200);
  assert.deepEqual(achievementPayload.items.map((entry) => entry.id), ["first_battle", "enemy_slayer"]);

  const progressionResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/guest-preview/progression?limit=1`);
  const progressionPayload = (await progressionResponse.json()) as PlayerProgressionSnapshot;
  assert.equal(progressionResponse.status, 200);
  assert.equal(progressionPayload.summary.totalAchievements, 5);
  assert.equal(progressionPayload.summary.unlockedAchievements, 0);
});

test("player account battle replay routes return normalized replay summaries with optional limit and offset", async (t) => {
  const port = 40050 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-1",
    displayName: "灰烬领主",
    globalResources: { gold: 320, wood: 5, ore: 1 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [
      createReplaySummary("replay-older", "2026-03-27T11:58:00.000Z"),
      createReplaySummary("replay-newer", "2026-03-27T12:02:00.000Z")
    ],
    lastRoomId: "room-alpha",
    lastSeenAt: new Date("2026-03-25T09:00:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const detailResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays?limit=1`
  );
  const detailPayload = (await detailResponse.json()) as { items: PlayerBattleReplaySummary[] };
  assert.equal(detailResponse.status, 200);
  assert.deepEqual(detailPayload.items.map((replay) => replay.id), ["replay-newer"]);

  const pagedResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays?limit=1&offset=1`
  );
  const pagedPayload = (await pagedResponse.json()) as { items: PlayerBattleReplaySummary[] };
  assert.equal(pagedResponse.status, 200);
  assert.deepEqual(pagedPayload.items.map((replay) => replay.id), ["replay-older"]);

  const missingResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/missing/battle-replays`);
  assert.equal(missingResponse.status, 404);
});

test("player account battle replay routes filter replay summaries by battle metadata", async (t) => {
  const port = 42040 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-filtered",
    displayName: "灰烬书记",
    globalResources: { gold: 40, wood: 5, ore: 2 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [
      createReplaySummary("replay-hero-loss", "2026-03-27T12:05:00.000Z", {
        roomId: "room-hero",
        battleId: "battle-hero-loss",
        battleKind: "hero",
        playerCamp: "defender",
        heroId: "hero-3",
        opponentHeroId: "hero-9",
        result: "defender_victory"
      }),
      createReplaySummary("replay-neutral-win", "2026-03-27T12:06:00.000Z", {
        roomId: "room-neutral",
        battleId: "battle-neutral-win",
        battleKind: "neutral",
        heroId: "hero-1",
        neutralArmyId: "neutral-1",
        opponentHeroId: undefined,
        result: "attacker_victory"
      })
    ],
    lastRoomId: "room-neutral",
    lastSeenAt: new Date("2026-03-27T12:06:30.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-filtered",
    displayName: "灰烬书记"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const publicResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-filtered/battle-replays?battleKind=neutral&heroId=hero-1&neutralArmyId=neutral-1`
  );
  const publicPayload = (await publicResponse.json()) as { items: PlayerBattleReplaySummary[] };
  assert.equal(publicResponse.status, 200);
  assert.deepEqual(publicPayload.items.map((replay) => replay.id), ["replay-neutral-win"]);

  const meResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/me/battle-replays?roomId=room-hero&battleId=battle-hero-loss&playerCamp=defender&result=defender_victory&opponentHeroId=hero-9`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const mePayload = (await meResponse.json()) as { items: PlayerBattleReplaySummary[] };
  assert.equal(meResponse.status, 200);
  assert.deepEqual(mePayload.items.map((replay) => replay.id), ["replay-hero-loss"]);
});

test("player account me battle replay route resolves the current authenticated account", async (t) => {
  const port = 42050 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-me",
    displayName: "苍穹侦骑",
    globalResources: { gold: 12, wood: 3, ore: 4 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [
      createReplaySummary("replay-me-1", "2026-03-27T12:03:00.000Z"),
      createReplaySummary("replay-me-2", "2026-03-27T12:04:00.000Z")
    ],
    lastRoomId: "room-old",
    lastSeenAt: new Date("2026-03-25T11:00:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-me",
    displayName: "苍穹侦骑"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/battle-replays`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as { items: PlayerBattleReplaySummary[] };

  assert.equal(meResponse.status, 200);
  assert.deepEqual(mePayload.items.map((replay) => replay.id), ["replay-me-2", "replay-me-1"]);
});

test("player account event-log routes filter recent entries without loading progression payloads", async (t) => {
  const port = 42065 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-events",
    displayName: "星炬记录官",
    globalResources: { gold: 22, wood: 7, ore: 1 },
    achievements: [],
    recentEventLog: [
      {
        id: "event-skill",
        timestamp: "2026-03-27T12:01:00.000Z",
        roomId: "room-alpha",
        playerId: "player-events",
        category: "skill",
        description: "skill",
        heroId: "hero-2",
        worldEventType: "hero.skillLearned",
        rewards: []
      },
      {
        id: "event-achievement",
        timestamp: "2026-03-27T12:03:00.000Z",
        roomId: "room-alpha",
        playerId: "player-events",
        category: "achievement",
        description: "achievement",
        heroId: "hero-1",
        achievementId: "first_battle",
        rewards: [{ type: "badge", label: "初次交锋" }]
      },
      {
        id: "event-combat",
        timestamp: "2026-03-27T12:02:00.000Z",
        roomId: "room-alpha",
        playerId: "player-events",
        category: "combat",
        description: "combat",
        heroId: "hero-1",
        worldEventType: "battle.started",
        rewards: []
      }
    ],
    recentBattleReplays: [],
    lastRoomId: "room-alpha",
    lastSeenAt: new Date("2026-03-27T12:04:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-events",
    displayName: "星炬记录官"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const publicResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-events/event-log?category=achievement&achievementId=first_battle&heroId=hero-1`
  );
  const publicPayload = (await publicResponse.json()) as { items: PlayerAccountSnapshot["recentEventLog"] };
  assert.equal(publicResponse.status, 200);
  assert.deepEqual(publicPayload.items.map((entry) => entry.id), ["event-achievement"]);

  const meResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/me/event-log?heroId=hero-1&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const mePayload = (await meResponse.json()) as { items: PlayerAccountSnapshot["recentEventLog"] };
  assert.equal(meResponse.status, 200);
  assert.deepEqual(mePayload.items.map((entry) => entry.id), ["event-achievement"]);
});

test("player account event-history routes page dedicated history entries beyond the recent snapshot", async (t) => {
  const port = 42069 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-history",
    displayName: "霜灯抄录员",
    globalResources: { gold: 22, wood: 7, ore: 1 },
    achievements: [],
    recentEventLog: [
      {
        id: "event-recent",
        timestamp: "2026-03-27T12:05:00.000Z",
        roomId: "room-alpha",
        playerId: "player-history",
        category: "achievement",
        description: "recent snapshot entry",
        heroId: "hero-1",
        achievementId: "first_battle",
        rewards: [{ type: "badge", label: "初次交锋" }]
      }
    ],
    recentBattleReplays: [],
    lastRoomId: "room-alpha",
    lastSeenAt: new Date("2026-03-27T12:06:00.000Z").toISOString()
  });
  store.seedEventHistory("player-history", [
    {
      id: "event-history-3",
      timestamp: "2026-03-27T12:05:00.000Z",
      roomId: "room-alpha",
      playerId: "player-history",
      category: "achievement",
      description: "history newest",
      heroId: "hero-1",
      achievementId: "first_battle",
      rewards: [{ type: "badge", label: "初次交锋" }]
    },
    {
      id: "event-history-2",
      timestamp: "2026-03-27T12:03:00.000Z",
      roomId: "room-alpha",
      playerId: "player-history",
      category: "combat",
      description: "history middle",
      heroId: "hero-1",
      worldEventType: "battle.started",
      rewards: []
    },
    {
      id: "event-history-1",
      timestamp: "2026-03-27T12:01:00.000Z",
      roomId: "room-alpha",
      playerId: "player-history",
      category: "combat",
      description: "history oldest",
      heroId: "hero-1",
      worldEventType: "battle.resolved",
      rewards: []
    }
  ]);
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-history",
    displayName: "霜灯抄录员"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const publicResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-history/event-history?heroId=hero-1&offset=1&limit=1`
  );
  const publicPayload = (await publicResponse.json()) as {
    items: PlayerAccountSnapshot["recentEventLog"];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  assert.equal(publicResponse.status, 200);
  assert.equal(publicPayload.total, 3);
  assert.equal(publicPayload.offset, 1);
  assert.equal(publicPayload.limit, 1);
  assert.equal(publicPayload.hasMore, true);
  assert.deepEqual(publicPayload.items.map((entry) => entry.id), ["event-history-2"]);

  const meResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/me/event-history?category=combat`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const mePayload = (await meResponse.json()) as {
    items: PlayerAccountSnapshot["recentEventLog"];
    total: number;
    hasMore: boolean;
  };
  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.total, 2);
  assert.equal(mePayload.hasMore, false);
  assert.deepEqual(mePayload.items.map((entry) => entry.id), ["event-history-2", "event-history-1"]);

  const rangedResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-history/event-history?since=2026-03-27T12:02:00.000Z&until=2026-03-27T12:04:00.000Z`
  );
  const rangedPayload = (await rangedResponse.json()) as {
    items: PlayerAccountSnapshot["recentEventLog"];
    total: number;
    offset: number;
    limit: number;
    hasMore: boolean;
  };
  assert.equal(rangedResponse.status, 200);
  assert.equal(rangedPayload.total, 1);
  assert.deepEqual(rangedPayload.items.map((entry) => entry.id), ["event-history-2"]);
});

test("player account achievement routes filter normalized progress without loading event history", async (t) => {
  const port = 42072 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-achievements",
    displayName: "星冠检阅官",
    globalResources: { gold: 22, wood: 7, ore: 1 },
    achievements: [
      {
        id: "first_battle",
        current: 1,
        unlockedAt: "2026-03-27T12:00:00.000Z"
      },
      {
        id: "enemy_slayer",
        current: 2,
        progressUpdatedAt: "2026-03-27T12:02:00.000Z"
      },
      {
        id: "skill_scholar",
        current: 5,
        unlockedAt: "2026-03-27T12:03:00.000Z"
      }
    ],
    recentEventLog: [
      {
        id: "event-achievement",
        timestamp: "2026-03-27T12:03:00.000Z",
        roomId: "room-alpha",
        playerId: "player-achievements",
        category: "achievement",
        description: "achievement",
        rewards: []
      }
    ],
    recentBattleReplays: [],
    lastRoomId: "room-alpha",
    lastSeenAt: new Date("2026-03-27T12:04:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-achievements",
    displayName: "星冠检阅官"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const publicResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-achievements/achievements?unlocked=true&metric=skills_learned`
  );
  const publicPayload = (await publicResponse.json()) as { items: PlayerAchievementProgress[] };
  assert.equal(publicResponse.status, 200);
  assert.deepEqual(publicPayload.items.map((entry) => entry.id), ["skill_scholar"]);

  const meResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/me/achievements?achievementId=enemy_slayer`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const mePayload = (await meResponse.json()) as { items: PlayerAchievementProgress[] };
  assert.equal(meResponse.status, 200);
  assert.deepEqual(mePayload.items.map((entry) => entry.id), ["enemy_slayer"]);
  assert.equal(mePayload.items[0]?.title, "猎敌者");
});

test("player account progression routes return a compact achievement and event read model", async (t) => {
  const port = 42080 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-progress",
    displayName: "雾林司灯",
    globalResources: { gold: 120, wood: 6, ore: 2 },
    achievements: [
      {
        id: "first_battle",
        title: "ignored",
        description: "ignored",
        metric: "battles_started",
        current: 1,
        target: 99,
        unlocked: true,
        progressUpdatedAt: "2026-03-27T12:00:00.000Z",
        unlockedAt: "2026-03-27T12:00:00.000Z"
      },
      {
        id: "enemy_slayer",
        title: "ignored",
        description: "ignored",
        metric: "battles_won",
        current: 2,
        target: 99,
        unlocked: false,
        progressUpdatedAt: "2026-03-27T12:02:00.000Z"
      }
    ],
    recentEventLog: [
      {
        id: "event-older",
        timestamp: "2026-03-27T12:01:00.000Z",
        roomId: "room-alpha",
        playerId: "player-progress",
        category: "combat",
        description: "older",
        rewards: []
      },
      {
        id: "event-newer",
        timestamp: "2026-03-27T12:03:00.000Z",
        roomId: "room-alpha",
        playerId: "player-progress",
        category: "achievement",
        description: "newer",
        rewards: [{ type: "badge", label: "初次交锋" }]
      }
    ],
    lastRoomId: "room-alpha",
    lastSeenAt: new Date("2026-03-27T12:04:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-progress",
    displayName: "雾林司灯"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const publicResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-progress/progression?limit=1`);
  const publicPayload = (await publicResponse.json()) as PlayerProgressionSnapshot;
  assert.equal(publicResponse.status, 200);
  assert.deepEqual(publicPayload.summary, {
    totalAchievements: 5,
    unlockedAchievements: 1,
    inProgressAchievements: 1,
    latestProgressAchievementId: "enemy_slayer",
    latestProgressAchievementTitle: "猎敌者",
    latestProgressAt: "2026-03-27T12:02:00.000Z",
    latestUnlockedAchievementId: "first_battle",
    latestUnlockedAchievementTitle: "初次交锋",
    latestUnlockedAt: "2026-03-27T12:00:00.000Z",
    recentEventCount: 1,
    latestEventAt: "2026-03-27T12:03:00.000Z"
  });
  assert.deepEqual(publicPayload.recentEventLog.map((entry) => entry.id), ["event-newer"]);

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/progression`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as PlayerProgressionSnapshot;
  assert.equal(meResponse.status, 200);
  assert.deepEqual(mePayload.recentEventLog.map((entry) => entry.id), ["event-newer", "event-older"]);
  assert.equal(mePayload.achievements[1]?.id, "enemy_slayer");
  assert.equal(mePayload.achievements[1]?.current, 2);
  assert.equal(mePayload.achievements[1]?.progressUpdatedAt, "2026-03-27T12:02:00.000Z");
});

test("player achievement tracker appends logs and unlocks milestones", () => {
  const updated = applyPlayerEventLogAndAchievements(
    {
      playerId: "player-1",
      displayName: "暮火侦骑",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentEventLog: []
    },
    createAccountTrackingWorldState(),
    [
      {
        type: "battle.started",
        heroId: "hero-1",
        encounterKind: "neutral",
        battleId: "battle-1",
        neutralArmyId: "neutral-1",
        path: [{ x: 0, y: 0 }],
        moveCost: 2
      },
      {
        type: "hero.skillLearned",
        heroId: "hero-1",
        skillId: "skill-1",
        branchId: "branch-1",
        skillName: "远见",
        branchName: "战略",
        newRank: 1,
        spentPoint: 1,
        remainingSkillPoints: 0,
        newlyGrantedBattleSkillIds: []
      }
    ],
    "2026-03-27T12:00:00.000Z"
  );

  assert.equal(updated.achievements.find((achievement) => achievement.id === "first_battle")?.unlocked, true);
  assert.equal(
    updated.achievements.find((achievement) => achievement.id === "first_battle")?.progressUpdatedAt,
    "2026-03-27T12:00:00.000Z"
  );
  assert.equal(updated.recentEventLog[0]?.category, "achievement");
  assert.match(updated.recentEventLog.map((entry) => entry.description).join(" "), /解锁成就：初次交锋/);
});

test("player achievement tracker can award battle wins from explicit participant metadata", () => {
  const state = {
    ...createAccountTrackingWorldState(),
    heroes: []
  };
  const updated = applyPlayerEventLogAndAchievements(
    {
      playerId: "player-1",
      displayName: "暮火侦骑",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [
        {
          id: "enemy_slayer",
          title: "ignored",
          description: "ignored",
          metric: "battles_won",
          current: 2,
          target: 3,
          unlocked: false,
          progressUpdatedAt: "2026-03-27T11:59:00.000Z"
        }
      ],
      recentEventLog: []
    },
    state,
    [
      {
        type: "battle.resolved",
        heroId: "hero-1",
        attackerPlayerId: "player-1",
        defenderHeroId: "hero-2",
        defenderPlayerId: "player-2",
        battleId: "battle-hero-1-vs-hero-2",
        result: "attacker_victory"
      }
    ],
    "2026-03-27T12:00:00.000Z"
  );

  assert.equal(updated.achievements.find((achievement) => achievement.id === "enemy_slayer")?.current, 3);
  assert.equal(updated.achievements.find((achievement) => achievement.id === "enemy_slayer")?.unlocked, true);
  assert.match(updated.recentEventLog.map((entry) => entry.description).join(" "), /解锁成就：猎敌者/);
});

test("player achievement tracker records equipment drop entries for hero victories", () => {
  const updated = applyPlayerEventLogAndAchievements(
    {
      playerId: "player-1",
      displayName: "暮火侦骑",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentEventLog: []
    },
    createAccountTrackingWorldState(),
    [
      {
        type: "hero.equipmentFound",
        heroId: "hero-1",
        battleId: "battle-neutral-1",
        battleKind: "neutral",
        equipmentId: "tower_shield_mail",
        equipmentName: "塔盾链甲",
        rarity: "common"
      }
    ],
    "2026-03-27T12:05:00.000Z"
  );

  assert.equal(updated.recentEventLog[0]?.worldEventType, "hero.equipmentFound");
  assert.match(updated.recentEventLog[0]?.description ?? "", /塔盾链甲/);
});

test("player achievement tracker syncs epic equipment loadout progress from world state", () => {
  const updated = applyPlayerEventLogAndAchievements(
    {
      playerId: "player-1",
      displayName: "暮火侦骑",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentEventLog: []
    },
    createEpicEquipmentTrackingWorldState(),
    [],
    "2026-03-27T12:10:00.000Z"
  );

  assert.equal(updated.achievements.find((achievement) => achievement.id === "epic_collector")?.current, 3);
  assert.equal(updated.achievements.find((achievement) => achievement.id === "epic_collector")?.unlocked, true);
  assert.equal(
    updated.achievements.find((achievement) => achievement.id === "epic_collector")?.progressUpdatedAt,
    "2026-03-27T12:10:00.000Z"
  );
  assert.match(updated.recentEventLog[0]?.description ?? "", /解锁成就：史诗武装/);

  const regressed = applyPlayerEventLogAndAchievements(
    updated,
    createAccountTrackingWorldState(),
    [],
    "2026-03-27T12:11:00.000Z"
  );

  assert.equal(regressed.achievements.find((achievement) => achievement.id === "epic_collector")?.current, 3);
  assert.equal(regressed.achievements.find((achievement) => achievement.id === "epic_collector")?.unlocked, true);
  assert.equal(
    regressed.achievements.find((achievement) => achievement.id === "epic_collector")?.progressUpdatedAt,
    "2026-03-27T12:10:00.000Z"
  );
  assert.equal(
    regressed.recentEventLog.filter((entry) => entry.achievementId === "epic_collector").length,
    1
  );
});

test("player achievement tracker syncs full map exploration progress from world visibility", () => {
  const updated = applyPlayerEventLogAndAchievements(
    {
      playerId: "player-1",
      displayName: "暮火侦骑",
      globalResources: { gold: 0, wood: 0, ore: 0 },
      achievements: [],
      recentEventLog: []
    },
    createFullyExploredTrackingWorldState(),
    [],
    "2026-03-27T12:12:00.000Z"
  );

  assert.equal(updated.achievements.find((achievement) => achievement.id === "world_explorer")?.current, 1);
  assert.equal(updated.achievements.find((achievement) => achievement.id === "world_explorer")?.unlocked, true);
  assert.equal(
    updated.achievements.find((achievement) => achievement.id === "world_explorer")?.progressUpdatedAt,
    "2026-03-27T12:12:00.000Z"
  );
  assert.match(updated.recentEventLog[0]?.description ?? "", /解锁成就：踏勘全境/);
});

test("player account profile updates by player id require auth and allow self-service only", async (t) => {
  const port = 41000 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const unauthenticatedResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-2`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      displayName: "未授权写入",
      lastRoomId: "room-unauth"
    })
  });
  const unauthenticatedPayload = (await unauthenticatedResponse.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(unauthenticatedResponse.status, 401);
  assert.equal(unauthenticatedPayload.error.code, "unauthorized");

  const selfSession = issueGuestAuthSession({
    playerId: "player-2",
    displayName: "远帆旅人"
  });
  const updateResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-2`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${selfSession.token}`
    },
    body: JSON.stringify({
      displayName: "北境执旗官",
      lastRoomId: "room-bravo"
    })
  });
  const updatePayload = (await updateResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: { token: string; playerId: string; displayName: string };
  };

  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.account.displayName, "北境执旗官");
  assert.equal(updatePayload.account.lastRoomId, "room-bravo");
  assert.equal(updatePayload.session.playerId, "player-2");
  assert.equal(updatePayload.session.displayName, "北境执旗官");

  const stored = await store.loadPlayerAccount("player-2");
  assert.equal(stored?.displayName, "北境执旗官");
  assert.equal(stored?.lastRoomId, "room-bravo");

  const otherSession = issueGuestAuthSession({
    playerId: "player-3",
    displayName: "陌路信使"
  });
  const crossPlayerResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-2`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${otherSession.token}`
    },
    body: JSON.stringify({
      displayName: "越权篡改",
      lastRoomId: "room-gamma"
    })
  });
  const crossPlayerPayload = (await crossPlayerResponse.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(crossPlayerResponse.status, 403);
  assert.equal(crossPlayerPayload.error.code, "forbidden");

  const unchanged = await store.loadPlayerAccount("player-2");
  assert.equal(unchanged?.displayName, "北境执旗官");
  assert.equal(unchanged?.lastRoomId, "room-bravo");
});

test("player account update routes echo local-mode payloads when persistence is unavailable", async (t) => {
  const port = 41030 + Math.floor(Math.random() * 1000);
  const server = await startAccountRouteServer(port, null);
  const session = issueGuestAuthSession({
    playerId: "player-local",
    displayName: "本地旅人"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const byIdResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-local`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      displayName: "本地改名",
      lastRoomId: "room-local"
    })
  });
  const byIdPayload = (await byIdResponse.json()) as {
    account: PlayerAccountSnapshot;
    session?: { token: string; playerId: string; displayName: string };
  };

  assert.equal(byIdResponse.status, 200);
  assert.equal(byIdPayload.account.playerId, "player-local");
  assert.equal(byIdPayload.account.displayName, "本地改名");
  assert.equal(byIdPayload.account.lastRoomId, "room-local");
  assert.equal(byIdPayload.session, undefined);

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      displayName: "本地守望",
      lastRoomId: "room-auth"
    })
  });
  const mePayload = (await meResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: { token: string; playerId: string; displayName: string };
  };

  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.account.playerId, "player-local");
  assert.equal(mePayload.account.displayName, "本地守望");
  assert.equal(mePayload.account.lastRoomId, "room-auth");
  assert.equal(mePayload.session.playerId, "player-local");
  assert.equal(mePayload.session.displayName, "本地守望");

  const crossPlayerResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/other-player`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      displayName: "越权篡改"
    })
  });
  const crossPlayerPayload = (await crossPlayerResponse.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(crossPlayerResponse.status, 403);
  assert.equal(crossPlayerPayload.error.code, "forbidden");
});

test("player account me routes resolve and update the current authenticated account", async (t) => {
  const port = 42000 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-me",
    displayName: "苍穹侦骑",
    globalResources: { gold: 12, wood: 3, ore: 4 },
    achievements: [],
    recentEventLog: [],
    lastRoomId: "room-old",
    lastSeenAt: new Date("2026-03-25T11:00:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-me",
    displayName: "苍穹侦骑"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: { token: string; playerId: string; displayName: string };
  };

  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.account.playerId, "player-me");
  assert.equal(mePayload.account.displayName, "苍穹侦骑");
  assert.equal(mePayload.session.playerId, "player-me");

  const updateResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      displayName: "风暴司灯人",
      lastRoomId: "room-next"
    })
  });
  const updatePayload = (await updateResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: { token: string; playerId: string; displayName: string };
  };

  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.account.displayName, "风暴司灯人");
  assert.equal(updatePayload.account.lastRoomId, "room-next");
  assert.equal(updatePayload.session.displayName, "风暴司灯人");

  const stored = await store.loadPlayerAccount("player-me");
  assert.equal(stored?.displayName, "风暴司灯人");
  assert.equal(stored?.lastRoomId, "room-next");
});

test("player account me route preserves account-mode sessions and returns the global vault", async (t) => {
  const port = 42100 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "account-player",
    displayName: "暮潮守望",
    globalResources: { gold: 320, wood: 5, ore: 2 },
    achievements: [],
    recentEventLog: [],
    loginId: "veil-ranger",
    credentialBoundAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
    lastRoomId: "room-vault",
    lastSeenAt: new Date("2026-03-25T12:30:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueAccountAuthSession({
    playerId: "account-player",
    displayName: "暮潮守望",
    loginId: "veil-ranger"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as {
    account: PlayerAccountSnapshot;
    session: {
      token: string;
      playerId: string;
      displayName: string;
      authMode: "guest" | "account";
      loginId?: string;
    };
  };

  assert.equal(meResponse.status, 200);
  assert.deepEqual(mePayload.account.globalResources, {
    gold: 320,
    wood: 5,
    ore: 2
  });
  assert.equal(mePayload.session.authMode, "account");
  assert.equal(mePayload.session.loginId, "veil-ranger");
});

test("player account session routes list active devices and revoke a selected non-current session", async (t) => {
  const port = 42125 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  await store.ensurePlayerAccount({
    playerId: "account-player",
    displayName: "暮潮守望"
  });
  await store.bindPlayerAccountCredentials("account-player", {
    loginId: "veil-ranger",
    passwordHash: "hashed-password"
  });
  await store.savePlayerAccountAuthSession("account-player", {
    refreshSessionId: "session-current",
    refreshTokenHash: "hash-current",
    refreshTokenExpiresAt: "2026-04-29T08:00:00.000Z",
    deviceLabel: "Current Browser",
    lastUsedAt: "2025-03-29T08:00:00.000Z"
  });
  await store.savePlayerAccountAuthSession("account-player", {
    refreshSessionId: "session-other",
    refreshTokenHash: "hash-other",
    refreshTokenExpiresAt: "2026-04-28T08:00:00.000Z",
    provider: "wechat-mini-game",
    deviceLabel: "WeChat DevTools",
    lastUsedAt: "2025-03-29T07:00:00.000Z"
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueAccountAuthSession({
    playerId: "account-player",
    displayName: "暮潮守望",
    loginId: "veil-ranger",
    sessionId: "session-current",
    sessionVersion: 0
  });
  const otherSession = issueAccountAuthSession({
    playerId: "account-player",
    displayName: "暮潮守望",
    loginId: "veil-ranger",
    sessionId: "session-other",
    sessionVersion: 0
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const listResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/sessions`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const listPayload = (await listResponse.json()) as {
    items: Array<{ sessionId: string; deviceLabel: string; current: boolean }>;
  };

  assert.equal(listResponse.status, 200);
  assert.deepEqual(
    listPayload.items.map((item) => [item.sessionId, item.current, item.deviceLabel]),
    [
      ["session-current", true, "Current Browser"],
      ["session-other", false, "WeChat DevTools"]
    ]
  );

  const revokeResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/sessions/session-other`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const revokePayload = (await revokeResponse.json()) as {
    items: Array<{ sessionId: string }>;
  };

  assert.equal(revokeResponse.status, 200);
  assert.deepEqual(revokePayload.items.map((item) => item.sessionId), ["session-current"]);
  assert.equal(await store.loadPlayerAccountAuthSession("account-player", "session-other"), null);

  const revokedSessionMeResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${otherSession.token}`
    }
  });
  const revokedSessionMePayload = (await revokedSessionMeResponse.json()) as {
    error: { code: string };
  };

  assert.equal(revokedSessionMeResponse.status, 401);
  assert.equal(revokedSessionMePayload.error.code, "session_revoked");

  const revokeCurrentResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/sessions/session-current`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const revokeCurrentPayload = (await revokeCurrentResponse.json()) as {
    error: { code: string };
  };

  assert.equal(revokeCurrentResponse.status, 400);
  assert.equal(revokeCurrentPayload.error.code, "current_session_revoke_forbidden");
});

test("player account password changes revoke the current access session family", async (t) => {
  const port = 42140 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  await store.ensurePlayerAccount({
    playerId: "password-player",
    displayName: "暮潮守望"
  });
  await store.bindPlayerAccountCredentials("password-player", {
    loginId: "veil-ranger",
    passwordHash: hashAccountPassword("hunter2")
  });
  await store.savePlayerAccountAuthSession("password-player", {
    refreshSessionId: "session-password",
    refreshTokenHash: "hash-password",
    refreshTokenExpiresAt: "2026-04-28T08:00:00.000Z",
    deviceLabel: "Current Browser",
    lastUsedAt: "2026-03-29T08:00:00.000Z"
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueAccountAuthSession({
    playerId: "password-player",
    displayName: "暮潮守望",
    loginId: "veil-ranger",
    sessionId: "session-password",
    sessionVersion: 0
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const updateResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: JSON.stringify({
      currentPassword: "hunter2",
      newPassword: "hunter3"
    })
  });
  const updatePayload = (await updateResponse.json()) as { account: PlayerAccountSnapshot };

  assert.equal(updateResponse.status, 200);
  assert.equal(updatePayload.account.playerId, "password-player");
  assert.match(updatePayload.account.credentialBoundAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

  const authState = await store.loadPlayerAccountAuthByPlayerId("password-player");
  assert.equal(authState?.accountSessionVersion, 1);
  assert.equal(await store.loadPlayerAccountAuthSession("password-player", "session-password"), null);

  const revokedMeResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const revokedMePayload = (await revokedMeResponse.json()) as {
    error: { code: string };
  };

  assert.equal(revokedMeResponse.status, 401);
  assert.equal(revokedMePayload.error.code, "session_revoked");
});

test("player account update routes reject oversized JSON bodies with 413", async (t) => {
  const port = 42150 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-oversized",
    displayName: "起始名册",
    globalResources: { gold: 0, wood: 0, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [],
    lastRoomId: "room-start",
    lastSeenAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
    createdAt: new Date("2026-03-25T12:00:00.000Z").toISOString(),
    updatedAt: new Date("2026-03-25T12:00:00.000Z").toISOString()
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-oversized",
    displayName: "起始名册"
  });
  const oversizedBody = JSON.stringify({
    displayName: "x".repeat(70_000)
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: oversizedBody
  });
  const mePayload = (await meResponse.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(meResponse.status, 413);
  assert.equal(mePayload.error.code, "payload_too_large");
  assert.match(mePayload.error.message, /65536 bytes/);

  const byIdResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-oversized`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.token}`
    },
    body: oversizedBody
  });
  const byIdPayload = (await byIdResponse.json()) as {
    error: { code: string; message: string };
  };

  assert.equal(byIdResponse.status, 413);
  assert.equal(byIdPayload.error.code, "payload_too_large");
  assert.match(byIdPayload.error.message, /65536 bytes/);

  const stored = await store.loadPlayerAccount("player-oversized");
  assert.equal(stored?.displayName, "起始名册");
  assert.equal(stored?.lastRoomId, "room-start");
});
