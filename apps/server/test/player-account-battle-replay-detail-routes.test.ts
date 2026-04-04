import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { ClientState, matchMaker } from "colyseus";
import type { Client } from "colyseus";
import { issueGuestAuthSession } from "../src/auth";
import { VeilColyseusRoom, configureRoomSnapshotStore, resetLobbyRoomRegistry } from "../src/colyseus-room";
import { MemoryRoomSnapshotStore } from "../src/memory-room-snapshot-store";
import { registerPlayerAccountRoutes } from "../src/player-accounts";
import type {
  PlayerAccountBanHistoryListOptions,
  PlayerAccountBanInput,
  PlayerAccountBanSnapshot,
  PlayerAccountAuthSnapshot,
  PlayerAccountCredentialInput,
  PlayerAccountEnsureInput,
  PlayerEventHistoryQuery,
  PlayerEventHistorySnapshot,
  PlayerAccountListOptions,
  PlayerAccountProfilePatch,
  PlayerAccountProgressPatch,
  PlayerAccountSnapshot,
  PlayerHeroArchiveSnapshot,
  PlayerAccountUnbanInput,
  PlayerBanHistoryRecord,
  RoomSnapshotStore
} from "../src/persistence";
import type { RoomPersistenceSnapshot } from "../src/index";
import {
  createEmptyBattleState,
  queryEventLogEntries,
  type BattleState,
  type PlayerBattleReplaySummary,
  type ServerMessage
} from "../../../packages/shared/src/index";

interface FakeClient extends Client {
  sent: ServerMessage[];
}

class MemoryPlayerAccountStore implements RoomSnapshotStore {
  private readonly accounts = new Map<string, PlayerAccountSnapshot>();
  private readonly banHistoryByPlayerId = new Map<string, PlayerBanHistoryRecord[]>();

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

  async loadPlayerAccountByLoginId(_loginId: string): Promise<PlayerAccountSnapshot | null> {
    return null;
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

  async loadPlayerAccountAuthByLoginId(_loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    return null;
  }

  async loadPlayerAccountAuthSession(): Promise<null> {
    return null;
  }

  async listPlayerAccountAuthSessions(): Promise<[]> {
    return [];
  }

  async touchPlayerAccountAuthSession(): Promise<void> {}

  async revokePlayerAccountAuthSession(): Promise<boolean> {
    return false;
  }

  async loadPlayerHeroArchives(_playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]> {
    return [];
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

  async closeSeason(): Promise<void> {}

  async ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    const existing = this.accounts.get(input.playerId);
    const account: PlayerAccountSnapshot = {
      playerId: input.playerId,
      displayName: input.displayName?.trim() || existing?.displayName || input.playerId,
      globalResources: existing?.globalResources ?? { gold: 0, wood: 0, ore: 0 },
      achievements: structuredClone(existing?.achievements ?? []),
      recentEventLog: structuredClone(existing?.recentEventLog ?? []),
      recentBattleReplays: structuredClone(existing?.recentBattleReplays ?? []),
      ...(existing?.banStatus ? { banStatus: existing.banStatus } : {}),
      ...(existing?.banExpiry ? { banExpiry: existing.banExpiry } : {}),
      ...(existing?.banReason ? { banReason: existing.banReason } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(account.playerId, account);
    return account;
  }

  async bindPlayerAccountCredentials(_playerId: string, _input: PlayerAccountCredentialInput): Promise<PlayerAccountSnapshot> {
    throw new Error("not implemented");
  }

  async listPlayerBanHistory(
    playerId: string,
    options: PlayerAccountBanHistoryListOptions = {}
  ): Promise<PlayerBanHistoryRecord[]> {
    return (this.banHistoryByPlayerId.get(playerId) ?? []).slice(0, Math.max(1, Math.floor(options.limit ?? 20)));
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
    this.accounts.set(playerId, account);
    return account;
  }

  async clearPlayerBan(playerId: string, _input: PlayerAccountUnbanInput = {}): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      banStatus: "none",
      updatedAt: new Date().toISOString()
    };
    delete account.banExpiry;
    delete account.banReason;
    this.accounts.set(playerId, account);
    return account;
  }

  async savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot> {
    const existing = await this.ensurePlayerAccount({ playerId });
    const account: PlayerAccountSnapshot = {
      ...existing,
      displayName: patch.displayName?.trim() || existing.displayName,
      updatedAt: new Date().toISOString()
    };
    this.accounts.set(playerId, account);
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
      recentBattleReplays: structuredClone(
        (patch.recentBattleReplays as PlayerAccountSnapshot["recentBattleReplays"] | undefined) ?? existing.recentBattleReplays
      ),
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

function createFakeClient(sessionId: string): FakeClient {
  return {
    sessionId,
    state: ClientState.JOINED,
    sent: [],
    ref: {
      removeAllListeners() {},
      removeListener() {},
      once() {}
    },
    send(type: string | number, payload?: unknown) {
      this.sent.push({ type, ...(payload as object) } as ServerMessage);
    },
    leave() {},
    enqueueRaw() {},
    raw() {}
  } as FakeClient;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

async function createTestRoom(logicalRoomId: string, seed = 1001): Promise<VeilColyseusRoom> {
  await matchMaker.setup(
    undefined,
    {
      async update() {},
      async remove() {},
      async persist() {}
    } as never,
    "http://127.0.0.1"
  );

  const room = new VeilColyseusRoom();
  const internalRoom = room as VeilColyseusRoom & {
    __init(): void;
    _listing: Record<string, unknown>;
    _internalState: number;
  };

  internalRoom.roomId = logicalRoomId;
  internalRoom.roomName = "veil";
  internalRoom._listing = {
    roomId: logicalRoomId,
    clients: 0,
    locked: false,
    private: false,
    unlisted: false,
    metadata: {}
  };

  internalRoom.__init();
  await room.onCreate({ logicalRoomId, seed });
  internalRoom._internalState = 1;
  return room;
}

function cleanupRoom(room: VeilColyseusRoom): void {
  const internalRoom = room as VeilColyseusRoom & {
    _autoDisposeTimeout?: NodeJS.Timeout;
    _events: {
      emit(event: string): void;
    };
  };

  if (internalRoom._autoDisposeTimeout) {
    clearTimeout(internalRoom._autoDisposeTimeout);
    internalRoom._autoDisposeTimeout = undefined;
  }

  internalRoom._events.emit("dispose");
  room.clock.clear();
  room.clock.stop();
}

async function emitRoomMessage(room: VeilColyseusRoom, type: string, client: FakeClient, payload: object): Promise<void> {
  const internalRoom = room as VeilColyseusRoom & {
    onMessageEvents: {
      emit(event: string, ...args: unknown[]): void;
    };
  };

  internalRoom.onMessageEvents.emit(type, client, payload);
  await flushAsyncWork();
}

async function connectPlayer(
  room: VeilColyseusRoom,
  client: FakeClient,
  playerId: string,
  requestId: string
): Promise<void> {
  room.clients.push(client);
  room.onJoin(client, { playerId });
  await emitRoomMessage(room, "connect", client, {
    type: "connect",
    requestId,
    roomId: room.roomId,
    playerId
  });
}

function getBattleForPlayer(room: VeilColyseusRoom, playerId: string): BattleState | null {
  const internalRoom = room as VeilColyseusRoom & {
    worldRoom: {
      getBattleForPlayer(playerId: string): BattleState | null;
    };
  };

  return internalRoom.worldRoom.getBattleForPlayer(playerId);
}

async function resolveBattleThroughRoom(room: VeilColyseusRoom, client: FakeClient, playerId: string): Promise<number> {
  let steps = 0;
  while (steps < 20) {
    const battle = getBattleForPlayer(room, playerId);
    if (!battle) {
      return steps;
    }

    const activeUnitId = battle.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const target = activeUnit
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0)
      : undefined;

    assert.ok(activeUnitId, "expected an active unit while battle is in progress");
    assert.ok(target, "expected a valid battle target while battle is in progress");

    await emitRoomMessage(room, "battle.action", client, {
      type: "battle.action",
      requestId: `battle-route-step-${steps + 1}`,
      action: {
        type: "battle.attack",
        attackerId: activeUnitId,
        defenderId: target.id
      }
    });
    steps += 1;
  }

  assert.fail(`expected battle for ${playerId} to resolve within 20 player actions`);
}

async function startAccountRouteServer(port: number, store: RoomSnapshotStore | null): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

function createReplaySummary(id: string): PlayerBattleReplaySummary {
  const initialState = createEmptyBattleState();
  initialState.id = "battle-1";

  return {
    id,
    roomId: "room-replay",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-03-27T10:00:00.000Z",
    completedAt: "2026-03-27T10:01:00.000Z",
    initialState,
    steps: [
      {
        index: 1,
        source: "player",
        action: {
          type: "battle.wait",
          unitId: "hero-1-stack"
        }
      }
    ],
    result: "attacker_victory"
  };
}

test("player account battle replay detail routes return a normalized replay payload", async (t) => {
  const port = 43010 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-1",
    displayName: "回声骑士",
    globalResources: { gold: 10, wood: 1, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [createReplaySummary(" replay-detail ")],
    createdAt: "2026-03-27T10:00:00.000Z",
    updatedAt: "2026-03-27T10:05:00.000Z"
  });
  const server = await startAccountRouteServer(port, store);
  const session = issueGuestAuthSession({
    playerId: "player-1",
    displayName: "回声骑士"
  });
  const otherSession = issueGuestAuthSession({
    playerId: "player-2",
    displayName: "异乡旅人"
  });

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const playerResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/replay-detail`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const playerPayload = (await playerResponse.json()) as { replay: PlayerBattleReplaySummary };
  assert.equal(playerResponse.status, 200);
  assert.equal(playerPayload.replay.id, "replay-detail");
  assert.equal(playerPayload.replay.steps[0]?.index, 1);

  const meResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/battle-replays/replay-detail`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const mePayload = (await meResponse.json()) as { replay: PlayerBattleReplaySummary };
  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.replay.id, "replay-detail");

  const crossAccountResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/replay-detail`, {
    headers: {
      Authorization: `Bearer ${otherSession.token}`
    }
  });
  assert.equal(crossAccountResponse.status, 403);
});

test("player account battle replay detail routes require auth before exposing account-scoped data", async (t) => {
  const port = 43020 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-1",
    displayName: "回声骑士",
    globalResources: { gold: 10, wood: 1, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [createReplaySummary("replay-detail")],
    createdAt: "2026-03-27T10:00:00.000Z",
    updatedAt: "2026-03-27T10:05:00.000Z"
  });
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const unauthorizedResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/battle-replays/replay-detail`);
  assert.equal(unauthorizedResponse.status, 401);

  const protectedUnauthorizedResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/replay-detail`
  );
  assert.equal(protectedUnauthorizedResponse.status, 401);

  const session = issueGuestAuthSession({
    playerId: "player-1",
    displayName: "回声骑士"
  });

  const missingReplayResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/missing-replay`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  assert.equal(missingReplayResponse.status, 404);
});

test("player account battle replay detail routes read a replay captured and persisted from a live room lifecycle", async (t) => {
  resetLobbyRoomRegistry();
  const store = new MemoryRoomSnapshotStore();
  configureRoomSnapshotStore(store);
  const logicalRoomId = `replay-detail-lifecycle-${Date.now()}`;
  const room = await createTestRoom(logicalRoomId);
  const client = createFakeClient("session-replay-detail-route");
  const port = 43050 + Math.floor(Math.random() * 1000);
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    cleanupRoom(room);
    await server.gracefullyShutdown(false).catch(() => undefined);
    resetLobbyRoomRegistry();
    configureRoomSnapshotStore(null);
  });

  await connectPlayer(room, client, "player-1", "connect-replay-detail-route");
  await emitRoomMessage(room, "world.action", client, {
    type: "world.action",
    requestId: "move-replay-detail-route",
    action: {
      type: "hero.move",
      heroId: "hero-1",
      destination: { x: 5, y: 4 }
    }
  });
  const playerSteps = await resolveBattleThroughRoom(room, client, "player-1");
  assert.ok(playerSteps > 0);

  const account = await store.loadPlayerAccount("player-1");
  const replay = account?.recentBattleReplays?.[0];
  assert.ok(replay, "expected a persisted replay to be saved for player-1");

  const session = issueGuestAuthSession({
    playerId: "player-1",
    displayName: "player-1"
  });
  const response = await fetch(`http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/${replay.id}`, {
    headers: {
      Authorization: `Bearer ${session.token}`
    }
  });
  const payload = (await response.json()) as { replay: PlayerBattleReplaySummary };

  assert.equal(response.status, 200);
  assert.equal(payload.replay.id, replay.id);
  assert.equal(payload.replay.roomId, logicalRoomId);
  assert.equal(payload.replay.steps.filter((step) => step.source === "player").length, playerSteps);
  assert.ok(payload.replay.steps.some((step) => step.source === "automated"));
});
