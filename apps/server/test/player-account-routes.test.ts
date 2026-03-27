import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { issueAccountAuthSession, issueGuestAuthSession } from "../src/auth";
import { applyPlayerEventLogAndAchievements } from "../src/player-achievements";
import { registerPlayerAccountRoutes } from "../src/player-accounts";
import type {
  PlayerAccountProgressPatch,
  PlayerAccountAuthSnapshot,
  PlayerAccountCredentialInput,
  PlayerAccountEnsureInput,
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
  type PlayerProgressionSnapshot,
  type PlayerBattleReplaySummary,
  type WorldState
} from "../../../packages/shared/src/index";

class MemoryPlayerAccountStore implements RoomSnapshotStore {
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();

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

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(playerId))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account));
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return this.authByLoginId.get(loginId.trim().toLowerCase()) ?? null;
  }

  async loadPlayerHeroArchives(_playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]> {
    return [];
  }

  async ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    const existing = this.accounts.get(input.playerId);
    const account: PlayerAccountSnapshot = {
      playerId: input.playerId,
      displayName: input.displayName?.trim() || existing?.displayName || input.playerId,
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: structuredClone(existing?.achievements ?? []),
      recentEventLog: structuredClone(existing?.recentEventLog ?? []),
      recentBattleReplays: structuredClone(existing?.recentBattleReplays ?? []),
      ...(input.lastRoomId?.trim() ? { lastRoomId: input.lastRoomId.trim() } : existing?.lastRoomId ? { lastRoomId: existing.lastRoomId } : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
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
      credentialBoundAt
    });
    return account;
  }

  async savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      displayName: patch.displayName?.trim() || existing.displayName,
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

function createReplaySummary(id: string, completedAt: string): PlayerBattleReplaySummary {
  return {
    id,
    roomId: "room-replay",
    playerId: "player-1",
    battleId: `${id}-battle`,
    battleKind: "hero",
    playerCamp: "attacker",
    heroId: "hero-1",
    opponentHeroId: "hero-2",
    startedAt: "2026-03-27T11:55:00.000Z",
    completedAt,
    initialState: {
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
    steps: [],
    result: "attacker_victory"
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

test("player account battle replay routes return normalized replay summaries with optional limit", async (t) => {
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

  const missingResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/missing/battle-replays`);
  assert.equal(missingResponse.status, 404);
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
        unlockedAt: "2026-03-27T12:00:00.000Z"
      },
      {
        id: "enemy_slayer",
        title: "ignored",
        description: "ignored",
        metric: "battles_won",
        current: 2,
        target: 99,
        unlocked: false
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
    totalAchievements: 3,
    unlockedAchievements: 1,
    inProgressAchievements: 1,
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
  assert.equal(updated.recentEventLog[0]?.category, "achievement");
  assert.match(updated.recentEventLog.map((entry) => entry.description).join(" "), /解锁成就：初次交锋/);
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
