import assert from "node:assert/strict";
import test from "node:test";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import type { ClientMessage, ServerMessage } from "../../../packages/shared/src/index";
import type { RoomPersistenceSnapshot } from "../src/index";
import { configureRoomSnapshotStore, VeilColyseusRoom } from "../src/colyseus-room";
import {
  createPlayerAccountsFromWorldState,
  MAX_PLAYER_DISPLAY_NAME_LENGTH,
  type PlayerAccountAuthSnapshot,
  type PlayerAccountCredentialInput,
  type PlayerAccountSnapshot,
  type PlayerHeroArchiveSnapshot,
  type RoomSnapshotStore
} from "../src/persistence";

class MemoryRoomSnapshotStore implements RoomSnapshotStore {
  private readonly snapshots = new Map<string, RoomPersistenceSnapshot>();
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly authByLoginId = new Map<string, PlayerAccountAuthSnapshot>();
  private readonly heroArchives = new Map<string, PlayerHeroArchiveSnapshot>();

  async load(roomId: string): Promise<RoomPersistenceSnapshot | null> {
    const snapshot = this.snapshots.get(roomId);
    return snapshot ? structuredClone(snapshot) : null;
  }

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    return playerIds
      .map((playerId) => this.accounts.get(playerId))
      .filter((account): account is PlayerAccountSnapshot => Boolean(account))
      .map((account) => structuredClone(account));
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    const account = this.accounts.get(playerId);
    return account ? structuredClone(account) : null;
  }

  async loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedLoginId = loginId.trim().toLowerCase();
    const account = Array.from(this.accounts.values()).find((item) => item.loginId === normalizedLoginId);
    return account ? structuredClone(account) : null;
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    const auth = this.authByLoginId.get(loginId.trim().toLowerCase());
    return auth ? structuredClone(auth) : null;
  }

  async loadPlayerHeroArchives(playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]> {
    const playerIdSet = new Set(playerIds);
    return Array.from(this.heroArchives.values())
      .filter((archive) => playerIdSet.has(archive.playerId))
      .map((archive) => structuredClone(archive));
  }

  async ensurePlayerAccount(input: { playerId: string; displayName?: string; lastRoomId?: string }): Promise<PlayerAccountSnapshot> {
    const playerId = input.playerId.trim();
    if (!playerId) {
      throw new Error("playerId must not be empty");
    }

    const existing = this.accounts.get(playerId);
    const displayName = (input.displayName?.trim() || existing?.displayName || playerId).slice(
      0,
      MAX_PLAYER_DISPLAY_NAME_LENGTH
    );
    const nextAccount: PlayerAccountSnapshot = {
      playerId,
      displayName,
      globalResources: structuredClone(existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 }),
      ...(input.lastRoomId?.trim() ? { lastRoomId: input.lastRoomId.trim() } : existing?.lastRoomId ? { lastRoomId: existing.lastRoomId } : {}),
      lastSeenAt: new Date().toISOString(),
      ...(existing?.loginId ? { loginId: existing.loginId } : {}),
      ...(existing?.credentialBoundAt ? { credentialBoundAt: existing.credentialBoundAt } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, structuredClone(nextAccount));
    return structuredClone(nextAccount);
  }

  async savePlayerAccountProfile(
    playerId: string,
    patch: { displayName?: string; lastRoomId?: string | null }
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      displayName:
        patch.displayName !== undefined
          ? (patch.displayName.trim() || playerId.trim()).slice(0, MAX_PLAYER_DISPLAY_NAME_LENGTH)
          : existing.displayName,
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId?.trim()
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {}),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId.trim(), structuredClone(nextAccount));
    if (nextAccount.loginId) {
      const auth = this.authByLoginId.get(nextAccount.loginId);
      if (auth) {
        this.authByLoginId.set(nextAccount.loginId, {
          ...auth,
          displayName: nextAccount.displayName
        });
      }
    }
    return structuredClone(nextAccount);
  }

  async bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const normalizedLoginId = input.loginId.trim().toLowerCase();
    const owner = await this.loadPlayerAccountByLoginId(normalizedLoginId);
    if (owner && owner.playerId !== playerId.trim()) {
      throw new Error("loginId is already taken");
    }

    const nextAccount: PlayerAccountSnapshot = {
      ...existing,
      loginId: normalizedLoginId,
      credentialBoundAt: existing.credentialBoundAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId.trim(), structuredClone(nextAccount));
    this.authByLoginId.set(normalizedLoginId, {
      playerId: playerId.trim(),
      displayName: nextAccount.displayName,
      loginId: normalizedLoginId,
      passwordHash: input.passwordHash,
      ...(nextAccount.credentialBoundAt ? { credentialBoundAt: nextAccount.credentialBoundAt } : {})
    });
    return structuredClone(nextAccount);
  }

  async listPlayerAccounts(options: { limit?: number; playerId?: string } = {}): Promise<PlayerAccountSnapshot[]> {
    const filtered = Array.from(this.accounts.values())
      .filter((account) => (options.playerId ? account.playerId === options.playerId : true))
      .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));
    return filtered.slice(0, Math.max(1, Math.floor(options.limit ?? 20))).map((account) => structuredClone(account));
  }

  async save(roomId: string, snapshot: RoomPersistenceSnapshot): Promise<void> {
    this.snapshots.set(roomId, structuredClone(snapshot));
    for (const account of createPlayerAccountsFromWorldState(snapshot.state)) {
      const previous = this.accounts.get(account.playerId);
      this.accounts.set(account.playerId, {
        ...structuredClone(account),
        displayName: previous?.displayName ?? account.displayName,
        ...(previous?.loginId ? { loginId: previous.loginId } : {}),
        ...(previous?.credentialBoundAt ? { credentialBoundAt: previous.credentialBoundAt } : {}),
        ...(previous?.lastRoomId ? { lastRoomId: previous.lastRoomId } : {}),
        ...(previous?.lastSeenAt ? { lastSeenAt: previous.lastSeenAt } : {}),
        createdAt: previous?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
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

  seedPlayerAccount(account: PlayerAccountSnapshot): void {
    this.accounts.set(account.playerId, {
      playerId: account.playerId,
      displayName: account.displayName,
      globalResources: structuredClone(account.globalResources),
      ...(account.lastRoomId ? { lastRoomId: account.lastRoomId } : {}),
      ...(account.lastSeenAt ? { lastSeenAt: account.lastSeenAt } : {}),
      ...(account.loginId ? { loginId: account.loginId } : {}),
      ...(account.credentialBoundAt ? { credentialBoundAt: account.credentialBoundAt } : {}),
      createdAt: account.createdAt ?? new Date().toISOString(),
      updatedAt: account.updatedAt ?? new Date().toISOString()
    });
  }

  seedHeroArchive(archive: PlayerHeroArchiveSnapshot): void {
    this.heroArchives.set(`${archive.playerId}:${archive.heroId}`, structuredClone(archive));
  }
}

let requestCounter = 0;

function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}-${requestCounter}`;
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function startServer(port: number, store: RoomSnapshotStore): Promise<Server> {
  configureRoomSnapshotStore(store);
  const server = new Server({
    transport: new WebSocketTransport()
  });

  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, "127.0.0.1");
  return server;
}

async function joinRoomWithRetry(port: number, roomId: string, playerId = "player-1"): Promise<ColyseusRoom> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const client = new Client(`http://127.0.0.1:${port}`);
      return await client.joinOrCreate("veil", {
        logicalRoomId: roomId,
        playerId,
        seed: 1001
      });
    } catch (error) {
      lastError = error;
      await wait(150);
    }
  }

  throw lastError;
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

      const incoming = { type, ...(payload as object) } as ServerMessage;
      if (!("requestId" in incoming) || incoming.requestId !== message.requestId) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();

      if (incoming.type === "error") {
        reject(new Error(incoming.reason));
        return;
      }

      if (incoming.type !== expectedType) {
        reject(new Error(`Unexpected response type: ${incoming.type}`));
        return;
      }

      resolve(incoming as Extract<ServerMessage, { type: T }>);
    });

    room.send(message.type, message);
  });
}

test("colyseus room reloads a persisted active battle after a server restart", async (t) => {
  const roomId = `persist-restart-${Date.now()}`;
  const port = 36000 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  let server = await startServer(port, store);
  let firstRoom: ColyseusRoom | null = null;
  let secondRoom: ColyseusRoom | null = null;

  t.after(async () => {
    configureRoomSnapshotStore(null);
    if (secondRoom) {
      secondRoom.removeAllListeners();
      secondRoom.connection.close();
    }
    if (firstRoom) {
      firstRoom.removeAllListeners();
      firstRoom.connection.close();
    }
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  firstRoom = await joinRoomWithRetry(port, roomId);

  const initialState = await sendRequest(
    firstRoom,
    {
      type: "connect",
      requestId: nextRequestId("connect"),
      roomId,
      playerId: "player-1"
    },
    "session.state"
  );
  assert.deepEqual(initialState.payload.world.ownHeroes[0]?.position, { x: 1, y: 1 });

  const movedIntoBattle = await sendRequest(
    firstRoom,
    {
      type: "world.action",
      requestId: nextRequestId("move"),
      action: {
        type: "hero.move",
        heroId: "hero-1",
        destination: { x: 5, y: 4 }
      }
    },
    "session.state"
  );

  assert.equal(movedIntoBattle.payload.battle?.id, "battle-neutral-1");
  assert.deepEqual(movedIntoBattle.payload.world.ownHeroes[0]?.position, { x: 4, y: 4 });

  firstRoom.removeAllListeners();
  firstRoom.connection.close();
  await server.gracefullyShutdown(false);
  server = await startServer(port, store);

  secondRoom = await joinRoomWithRetry(port, roomId);

  const restoredState = await sendRequest(
    secondRoom,
    {
      type: "connect",
      requestId: nextRequestId("restore-connect"),
      roomId,
      playerId: "player-1"
    },
    "session.state"
  );

  assert.equal(restoredState.payload.battle?.id, "battle-neutral-1");
  assert.deepEqual(restoredState.payload.world.ownHeroes[0]?.position, { x: 4, y: 4 });

  const activeUnitId = restoredState.payload.battle?.activeUnitId;
  assert.ok(activeUnitId);

  const resumedBattle = await sendRequest(
    secondRoom,
    {
      type: "battle.action",
      requestId: nextRequestId("battle"),
      action: {
        type: "battle.defend",
        unitId: activeUnitId
      }
    },
    "session.state"
  );

  assert.equal(resumedBattle.payload.battle?.round, 2);
  assert.equal(resumedBattle.payload.battle?.units[resumedBattle.payload.battle?.activeUnitId ?? ""]?.camp, "attacker");
});

test("colyseus room hydrates global player resources into fresh rooms", async (t) => {
  const primaryRoomId = `global-vault-a-${Date.now()}`;
  const secondaryRoomId = `global-vault-b-${Date.now()}`;
  const port = 37000 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  let server = await startServer(port, store);
  let firstRoom: ColyseusRoom | null = null;
  let secondRoom: ColyseusRoom | null = null;

  t.after(async () => {
    configureRoomSnapshotStore(null);
    if (secondRoom) {
      secondRoom.removeAllListeners();
      secondRoom.connection.close();
    }
    if (firstRoom) {
      firstRoom.removeAllListeners();
      firstRoom.connection.close();
    }
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  firstRoom = await joinRoomWithRetry(port, primaryRoomId);

  const initialState = await sendRequest(
    firstRoom,
    {
      type: "connect",
      requestId: nextRequestId("vault-connect"),
      roomId: primaryRoomId,
      playerId: "player-1"
    },
    "session.state"
  );
  assert.deepEqual(initialState.payload.world.resources, { gold: 0, wood: 0, ore: 0 });

  await sendRequest(
    firstRoom,
    {
      type: "world.action",
      requestId: nextRequestId("vault-move"),
      action: {
        type: "hero.move",
        heroId: "hero-1",
        destination: { x: 2, y: 1 }
      }
    },
    "session.state"
  );

  const collected = await sendRequest(
    firstRoom,
    {
      type: "world.action",
      requestId: nextRequestId("vault-collect"),
      action: {
        type: "hero.collect",
        heroId: "hero-1",
        position: { x: 2, y: 1 }
      }
    },
    "session.state"
  );

  assert.equal(collected.payload.world.resources.wood, 5);

  secondRoom = await joinRoomWithRetry(port, secondaryRoomId);

  const hydratedState = await sendRequest(
    secondRoom,
    {
      type: "connect",
      requestId: nextRequestId("vault-connect-second"),
      roomId: secondaryRoomId,
      playerId: "player-1"
    },
    "session.state"
  );

  assert.deepEqual(hydratedState.payload.world.resources, {
    gold: 0,
    wood: 5,
    ore: 0
  });
});

test("colyseus room hydrates long-term hero archives into fresh rooms", async (t) => {
  const primaryRoomId = `hero-archive-a-${Date.now()}`;
  const secondaryRoomId = `hero-archive-b-${Date.now()}`;
  const port = 38000 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  let server = await startServer(port, store);
  let firstRoom: ColyseusRoom | null = null;
  let secondRoom: ColyseusRoom | null = null;

  t.after(async () => {
    configureRoomSnapshotStore(null);
    if (secondRoom) {
      secondRoom.removeAllListeners();
      secondRoom.connection.close();
    }
    if (firstRoom) {
      firstRoom.removeAllListeners();
      firstRoom.connection.close();
    }
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  firstRoom = await joinRoomWithRetry(port, primaryRoomId);

  await sendRequest(
    firstRoom,
    {
      type: "connect",
      requestId: nextRequestId("hero-archive-connect"),
      roomId: primaryRoomId,
      playerId: "player-1"
    },
    "session.state"
  );

  await sendRequest(
    firstRoom,
    {
      type: "world.action",
      requestId: nextRequestId("hero-archive-move"),
      action: {
        type: "hero.move",
        heroId: "hero-1",
        destination: { x: 3, y: 2 }
      }
    },
    "session.state"
  );

  const visitedShrine = await sendRequest(
    firstRoom,
    {
      type: "world.action",
      requestId: nextRequestId("hero-archive-visit"),
      action: {
        type: "hero.visit",
        heroId: "hero-1",
        buildingId: "shrine-attack-1"
      }
    },
    "session.state"
  );

  assert.equal(visitedShrine.payload.world.ownHeroes[0]?.stats.attack, 3);
  assert.deepEqual(visitedShrine.payload.world.ownHeroes[0]?.position, { x: 3, y: 2 });

  const archivedHero = visitedShrine.payload.world.ownHeroes[0];
  if (!archivedHero) {
    throw new Error("Expected hydrated hero snapshot after shrine visit");
  }

  store.seedHeroArchive({
    playerId: "player-1",
    heroId: "hero-1",
    hero: {
      ...archivedHero,
      position: { x: 4, y: 4 },
      move: { total: 8, remaining: 1 },
      loadout: {
        learnedSkills: [
          { skillId: "armor_spell", rank: 1 },
          { skillId: "sundering_spear", rank: 2 }
        ],
        equipment: {
          weaponId: "archive_lance",
          armorId: "archive_plate",
          accessoryId: "archive_charm",
          trinketIds: ["ember_token"]
        }
      },
      armyCount: 19
    }
  });

  secondRoom = await joinRoomWithRetry(port, secondaryRoomId);

  const hydratedState = await sendRequest(
    secondRoom,
    {
      type: "connect",
      requestId: nextRequestId("hero-archive-connect-second"),
      roomId: secondaryRoomId,
      playerId: "player-1"
    },
    "session.state"
  );

  assert.equal(hydratedState.payload.world.ownHeroes[0]?.stats.attack, 3);
  assert.deepEqual(hydratedState.payload.world.ownHeroes[0]?.position, { x: 1, y: 1 });
  assert.equal(
    hydratedState.payload.world.ownHeroes[0]?.move.remaining,
    hydratedState.payload.world.ownHeroes[0]?.move.total
  );
  assert.equal(hydratedState.payload.world.ownHeroes[0]?.armyCount, 19);
  assert.deepEqual(hydratedState.payload.world.ownHeroes[0]?.loadout.learnedSkills, [
    { skillId: "armor_spell", rank: 1 },
    { skillId: "sundering_spear", rank: 2 }
  ]);
  assert.deepEqual(hydratedState.payload.world.ownHeroes[0]?.loadout.equipment, {
    weaponId: "archive_lance",
    armorId: "archive_plate",
    accessoryId: "archive_charm",
    trinketIds: ["ember_token"]
  });
});

test("colyseus room connect provisions player account metadata without overwriting custom display names", async (t) => {
  const roomId = `account-provision-${Date.now()}`;
  const port = 39000 + Math.floor(Math.random() * 1000);
  const store = new MemoryRoomSnapshotStore();
  store.seedPlayerAccount({
    playerId: "guest-42",
    displayName: "自定义领主",
    globalResources: {
      gold: 75,
      wood: 1,
      ore: 0
    }
  });

  let server = await startServer(port, store);
  let room: ColyseusRoom | null = null;

  t.after(async () => {
    configureRoomSnapshotStore(null);
    if (room) {
      room.removeAllListeners();
      room.connection.close();
    }
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  room = await joinRoomWithRetry(port, roomId, "guest-42");

  const connected = await sendRequest(
    room,
    {
      type: "connect",
      requestId: nextRequestId("account-connect"),
      roomId,
      playerId: "guest-42"
    },
    "session.state"
  );

  assert.deepEqual(connected.payload.world.resources, {
    gold: 0,
    wood: 0,
    ore: 0
  });

  const account = await store.loadPlayerAccount("guest-42");
  assert.equal(account?.displayName, "自定义领主");
  assert.equal(account?.lastRoomId, roomId);
  assert.ok(account?.lastSeenAt);
  assert.equal(account?.globalResources.gold, 75);
});
