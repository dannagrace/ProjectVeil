import assert from "node:assert/strict";
import test from "node:test";
import { Server, WebSocketTransport } from "colyseus";
import { issueGuestAuthSession } from "../src/auth";
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
import { type BattleReplayPlaybackState, createEmptyBattleState, type PlayerBattleReplaySummary } from "@veil/shared/battle";
import { queryEventLogEntries } from "@veil/shared/event-log";

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

  async closeSeason() {
    return { seasonId: "", playersRewarded: 0, totalGemsGranted: 0 };
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

async function startAccountRouteServer(port: number, store: RoomSnapshotStore | null): Promise<Server> {
  const transport = new WebSocketTransport();
  registerPlayerAccountRoutes(transport.getExpressApp() as never, store);
  const server = new Server({ transport });
  await server.listen(port, "127.0.0.1");
  return server;
}

function createReplaySummary(id: string): PlayerBattleReplaySummary {
  const initialState = createEmptyBattleState();
  initialState.id = "battle-playback";

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
      },
      {
        index: 2,
        source: "automated",
        action: {
          type: "battle.defend",
          unitId: "neutral-1-stack"
        }
      }
    ],
    result: "attacker_victory"
  };
}

test("player account battle replay playback routes derive stateless playback controls", async (t) => {
  const port = 43030 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-1",
    displayName: "回声骑士",
    globalResources: { gold: 10, wood: 1, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [createReplaySummary(" replay-playback ")],
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

  const playerResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/replay-playback/playback?action=tick&repeat=2`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const playerPayload = (await playerResponse.json()) as { playback: BattleReplayPlaybackState };
  assert.equal(playerResponse.status, 200);
  assert.equal(playerPayload.playback.replay.id, "replay-playback");
  assert.equal(playerPayload.playback.currentStepIndex, 2);
  assert.equal(playerPayload.playback.status, "completed");
  assert.equal(playerPayload.playback.currentStep?.index, 2);

  const meResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/me/battle-replays/replay-playback/playback?currentStepIndex=1&status=playing&action=pause`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  const mePayload = (await meResponse.json()) as { playback: BattleReplayPlaybackState };
  assert.equal(meResponse.status, 200);
  assert.equal(mePayload.playback.currentStepIndex, 1);
  assert.equal(mePayload.playback.status, "paused");
  assert.equal(mePayload.playback.nextStep?.index, 2);

  const postResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/me/battle-replays/battle-1/playback`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        command: "step-forward"
      })
    }
  );
  const postPayload = (await postResponse.json()) as { playback: BattleReplayPlaybackState };
  assert.equal(postResponse.status, 200);
  assert.equal(postPayload.playback.replay.id, "replay-playback");
  assert.equal(postPayload.playback.replay.battleId, "battle-1");
  assert.equal(postPayload.playback.currentStepIndex, 1);
  assert.equal(postPayload.playback.currentStep?.index, 1);

  const crossAccountResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/replay-playback/playback`,
    {
      headers: {
        Authorization: `Bearer ${otherSession.token}`
      }
    }
  );
  assert.equal(crossAccountResponse.status, 403);
});

test("player account battle replay playback routes require auth before exposing account-scoped data", async (t) => {
  const port = 43040 + Math.floor(Math.random() * 1000);
  const store = new MemoryPlayerAccountStore();
  store.seedAccount({
    playerId: "player-1",
    displayName: "回声骑士",
    globalResources: { gold: 10, wood: 1, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [createReplaySummary("replay-playback")],
    createdAt: "2026-03-27T10:00:00.000Z",
    updatedAt: "2026-03-27T10:05:00.000Z"
  });
  const server = await startAccountRouteServer(port, store);

  t.after(async () => {
    await server.gracefullyShutdown(false).catch(() => undefined);
  });

  const unauthorizedResponse = await fetch(`http://127.0.0.1:${port}/api/player-accounts/me/battle-replays/replay-playback/playback`);
  assert.equal(unauthorizedResponse.status, 401);

  const protectedUnauthorizedResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/replay-playback/playback`
  );
  assert.equal(protectedUnauthorizedResponse.status, 401);

  const session = issueGuestAuthSession({
    playerId: "player-1",
    displayName: "回声骑士"
  });

  const missingReplayResponse = await fetch(
    `http://127.0.0.1:${port}/api/player-accounts/player-1/battle-replays/missing-replay/playback`,
    {
      headers: {
        Authorization: `Bearer ${session.token}`
      }
    }
  );
  assert.equal(missingReplayResponse.status, 404);
});
