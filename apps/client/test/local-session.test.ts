import assert from "node:assert/strict";
import test from "node:test";
import { CloseCode, type Room as ColyseusRoom } from "@colyseus/sdk";
import type { ServerMessage } from "../../../packages/shared/src/index";
import {
  getReconnectionStorageKey,
  getSessionReplayStorageKey,
  localSessionTestHooks,
  readReconnectionToken,
  readStoredSessionReplay,
  readSessionReplay,
  type ConnectionEvent,
  type SessionUpdate
} from "../src/local-session";

function createMemoryStorage(initialEntries?: Iterable<readonly [string, string]>): Storage {
  const values = new Map(initialEntries);
  return {
    get length(): number {
      return values.size;
    },
    clear(): void {
      values.clear();
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null;
    },
    key(index: number): string | null {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string): void {
      values.delete(key);
    },
    setItem(key: string, value: string): void {
      values.set(key, value);
    }
  };
}

function installWindow(sessionStorage = createMemoryStorage()): () => void {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        hostname: "127.0.0.1"
      },
      setTimeout,
      clearTimeout,
      sessionStorage
    }
  });
  return () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  };
}

function createSessionUpdate(reason = "snapshot", day = 2): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day
      },
      map: {
        width: 1,
        height: 1,
        tiles: []
      },
      ownHeroes: [],
      visibleHeroes: [],
      resources: {
        gold: 50 + day,
        wood: 3,
        ore: 1
      },
      playerId: "player-1"
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 0, y: 0 }],
    reason
  };
}

function toServerMessage(
  requestId: string,
  update: SessionUpdate,
  delivery: "reply" | "push" = "reply"
): Extract<ServerMessage, { type: "session.state" }> {
  return {
    type: "session.state",
    requestId,
    delivery,
    payload: {
      world: update.world,
      battle: update.battle,
      events: update.events,
      movementPlan: update.movementPlan,
      reachableTiles: update.reachableTiles,
      ...(update.reason ? { reason: update.reason } : {})
    }
  };
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error(message);
}

class FakeRoom {
  readonly sent: Array<{ type: string; payload: unknown }> = [];
  private onMessageHandler: ((type: unknown, payload: unknown) => void) | null = null;
  private readonly dropHandlers: Array<() => void> = [];
  private readonly reconnectHandlers: Array<() => void> = [];
  private readonly leaveHandlers: Array<(code: number) => void> = [];

  constructor(public reconnectionToken: string | null) {}

  onMessage(_type: string, handler: (type: unknown, payload: unknown) => void): void {
    this.onMessageHandler = handler;
  }

  onDrop(handler: () => void): void {
    this.dropHandlers.push(handler);
  }

  onReconnect(handler: () => void): void {
    this.reconnectHandlers.push(handler);
  }

  onLeave(handler: (code: number) => void): void {
    this.leaveHandlers.push(handler);
  }

  send(type: string, payload: unknown): void {
    this.sent.push({ type, payload });
  }

  emitMessage(message: ServerMessage): void {
    const { type, ...payload } = message;
    this.onMessageHandler?.(type, payload);
  }

  emitDrop(): void {
    for (const handler of this.dropHandlers) {
      handler();
    }
  }

  emitReconnect(): void {
    for (const handler of this.reconnectHandlers) {
      handler();
    }
  }

  emitLeave(code: number): void {
    for (const handler of this.leaveHandlers) {
      handler(code);
    }
  }
}

test("readStoredSessionReplay loads the cached browser session replay for H5 boot", { concurrency: false }, () => {
  const update = createSessionUpdate("cached", 4);
  const storage = createMemoryStorage([
    [
      getSessionReplayStorageKey("room-alpha", "player-1"),
      JSON.stringify({
        version: 1,
        storedAt: 123,
        update
      })
    ] as const
  ]);
  const restoreWindow = installWindow(storage);

  try {
    assert.deepEqual(readStoredSessionReplay("room-alpha", "player-1"), update);
  } finally {
    restoreWindow();
  }
});

test("createGameSession falls back to a local session when remote bootstrap is unavailable", { concurrency: false }, async () => {
  const events: ConnectionEvent[] = [];
  const pushed: SessionUpdate[] = [];
  const session = await localSessionTestHooks.createGameSessionWithRuntime(
    "room-alpha",
    "player-1",
    1001,
    {
      onConnectionEvent: (event) => {
        events.push(event);
      },
      onPushUpdate: (update) => {
        pushed.push(update);
      }
    },
    {
      async connectRemoteGameSession() {
        throw new Error("connect_failed");
      }
    }
  );

  const update = await session.snapshot("local-fallback");
  assert.equal(update.reason, "local-fallback");
  assert.equal(update.world.meta.roomId, "room-alpha");
  assert.equal(update.world.playerId, "player-1");
  assert.deepEqual(events, []);
  assert.deepEqual(pushed, []);
});

test("createGameSession keeps the remote bootstrap session when the initial connection succeeds", { concurrency: false }, async () => {
  const expected = createSessionUpdate("remote-live", 9);
  const remoteSession = {
    async snapshot(reason?: string) {
      return reason ? { ...expected, reason } : expected;
    },
    async moveHero() {
      throw new Error("not_implemented");
    },
    async collect() {
      throw new Error("not_implemented");
    },
    async learnSkill() {
      throw new Error("not_implemented");
    },
    async equipHeroItem() {
      throw new Error("not_implemented");
    },
    async unequipHeroItem() {
      throw new Error("not_implemented");
    },
    async recruit() {
      throw new Error("not_implemented");
    },
    async visitBuilding() {
      throw new Error("not_implemented");
    },
    async claimMine() {
      throw new Error("not_implemented");
    },
    async endDay() {
      throw new Error("not_implemented");
    },
    async actInBattle() {
      throw new Error("not_implemented");
    },
    async previewMovement() {
      throw new Error("not_implemented");
    },
    async listReachable() {
      throw new Error("not_implemented");
    }
  };

  const session = await localSessionTestHooks.createGameSessionWithRuntime("room-alpha", "player-1", 1001, undefined, {
    async connectRemoteGameSession() {
      return {
        session: remoteSession as never,
        recoveredFromStoredToken: false
      };
    },
    createLocalSession() {
      throw new Error("local_session_should_not_be_used");
    }
  });

  assert.deepEqual(await session.snapshot("boot"), { ...expected, reason: "boot" });
});

test("createGameSession falls back to a local session when remote bootstrap times out", { concurrency: false }, async () => {
  const session = await localSessionTestHooks.createGameSessionWithRuntime("room-alpha", "player-1", 1001, undefined, {
    async connectRemoteGameSession() {
      throw new Error("connect_timeout");
    }
  });

  const update = await session.snapshot("timeout-fallback");
  assert.equal(update.reason, "timeout-fallback");
  assert.equal(update.world.meta.roomId, "room-alpha");
  assert.equal(update.world.playerId, "player-1");
});

test(
  "recoverable remote sessions surface the recovered snapshot as a push update before a retried request resolves",
  { concurrency: false },
  async () => {
    const storage = createMemoryStorage([
      [getReconnectionStorageKey("room-alpha", "player-1"), "stale-token"] as const
    ]);
    const restoreWindow = installWindow(storage);
    const firstRoom = new FakeRoom("token-first");
    const secondRoom = new FakeRoom("token-second");
    const pushed: SessionUpdate[] = [];
    const events: ConnectionEvent[] = [];
    let connectAttempts = 0;

    try {
      const session = await localSessionTestHooks.createGameSessionWithRuntime(
        "room-alpha",
        "player-1",
        1001,
        {
          onPushUpdate: (update) => {
            pushed.push(update);
          },
          onConnectionEvent: (event) => {
            events.push(event);
          }
        },
        {
          async connectRemoteGameSession(roomId, playerId, seed, options) {
            connectAttempts += 1;
            const room = connectAttempts === 1 ? firstRoom : secondRoom;
            return {
              session: localSessionTestHooks.createRemoteGameSession(
                room as unknown as ColyseusRoom,
                roomId,
                playerId,
                options
              ) as never,
              recoveredFromStoredToken: false
            };
          },
          async wait() {}
        }
      );

      const snapshotPromise = session.snapshot("boot");
      await waitFor(() => firstRoom.sent.length === 1, "initial remote snapshot was not requested");
      firstRoom.emitLeave(CloseCode.FAILED_TO_RECONNECT);

      await waitFor(() => secondRoom.sent.length >= 1, "recovery snapshot was not requested");
      const recoveredUpdate = createSessionUpdate("recovered", 7);
      const recoveryRequestId = (secondRoom.sent[0]?.payload as { requestId: string }).requestId;
      secondRoom.emitMessage(toServerMessage(recoveryRequestId, recoveredUpdate));

      await waitFor(() => events.length === 2, "recovery reconnect event was not emitted");
      await waitFor(() => pushed.length === 1, "recovered snapshot push update was not emitted");
      assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
      assert.deepEqual(pushed, [recoveredUpdate]);

      await waitFor(() => secondRoom.sent.length >= 2, "retry snapshot was not requested");
      const liveUpdate = createSessionUpdate("live", 8);
      const retryRequestId = (secondRoom.sent[1]?.payload as { requestId: string }).requestId;
      secondRoom.emitMessage(toServerMessage(retryRequestId, liveUpdate));

      const update = await snapshotPromise;
      assert.equal(update.reason, "boot");
      assert.equal(update.world.meta.day, 8);
    } finally {
      restoreWindow();
    }
  }
);

test("createGameSession surfaces stored-token recovery as a successful remote resume", { concurrency: false }, async () => {
  const events: ConnectionEvent[] = [];
  const session = await localSessionTestHooks.createGameSessionWithRuntime(
    "room-alpha",
    "player-1",
    1001,
    {
      onConnectionEvent: (event) => {
        events.push(event);
      }
    },
    {
      async connectRemoteGameSession() {
        return {
          session: {
            async snapshot() {
              return createSessionUpdate("remote-live", 5);
            }
          } as Awaited<ReturnType<typeof localSessionTestHooks.createGameSessionWithRuntime>>,
          recoveredFromStoredToken: true
        };
      }
    }
  );

  const update = await session.snapshot("boot");
  assert.deepEqual(events, ["reconnected"]);
  assert.equal(update.reason, "boot");
  assert.equal(update.world.meta.day, 5);
});

test(
  "createGameSession falls back to a local session when remote bootstrap throws a non-recoverable error",
  { concurrency: false },
  async () => {
  const session = await localSessionTestHooks.createGameSessionWithRuntime("room-alpha", "player-1", 1001, undefined, {
    async connectRemoteGameSession() {
      throw new Error("unexpected_bootstrap_failure");
    }
  });

  const update = await session.snapshot("local-after-unexpected-failure");
  assert.equal(update.reason, "local-after-unexpected-failure");
  assert.equal(update.world.meta.roomId, "room-alpha");
  assert.equal(update.world.playerId, "player-1");
  }
);

test("remote game sessions persist push updates and reconnection tokens", { concurrency: false }, () => {
  const storage = createMemoryStorage();
  const restoreWindow = installWindow(storage);
  const room = new FakeRoom("token-initial");
  const pushed: SessionUpdate[] = [];
  const events: ConnectionEvent[] = [];

  try {
    localSessionTestHooks.createRemoteGameSession(room as unknown as ColyseusRoom, "room-alpha", "player-1", {
      onPushUpdate: (update) => {
        pushed.push(update);
      },
      onConnectionEvent: (event) => {
        events.push(event);
      }
    });

    assert.equal(
      readReconnectionToken(storage, "room-alpha", "player-1"),
      "token-initial"
    );

    const pushedUpdate = createSessionUpdate("push-sync", 6);
    room.emitMessage(toServerMessage("push-1", pushedUpdate, "push"));
    room.emitDrop();
    room.reconnectionToken = "token-after-reconnect";
    room.emitReconnect();

    assert.deepEqual(pushed, [pushedUpdate]);
    assert.deepEqual(events, ["reconnecting", "reconnected"]);
    assert.deepEqual(readSessionReplay(storage, "room-alpha", "player-1"), pushedUpdate);
    assert.equal(
      readReconnectionToken(storage, "room-alpha", "player-1"),
      "token-after-reconnect"
    );
  } finally {
    restoreWindow();
  }
});

test("remote game sessions clear persisted replay and reconnection token after a consented leave", { concurrency: false }, () => {
  const storage = createMemoryStorage();
  const restoreWindow = installWindow(storage);
  const room = new FakeRoom("token-initial");
  const pushed: SessionUpdate[] = [];

  try {
    localSessionTestHooks.createRemoteGameSession(room as unknown as ColyseusRoom, "room-alpha", "player-1", {
      onPushUpdate: (update) => {
        pushed.push(update);
      }
    });

    const pushedUpdate = createSessionUpdate("push-sync", 6);
    room.emitMessage(toServerMessage("push-1", pushedUpdate, "push"));
    assert.deepEqual(pushed, [pushedUpdate]);
    assert.deepEqual(readSessionReplay(storage, "room-alpha", "player-1"), pushedUpdate);
    assert.equal(readReconnectionToken(storage, "room-alpha", "player-1"), "token-initial");

    room.emitLeave(CloseCode.CONSENTED);

    assert.equal(readSessionReplay(storage, "room-alpha", "player-1"), null);
    assert.equal(readReconnectionToken(storage, "room-alpha", "player-1"), null);
  } finally {
    restoreWindow();
  }
});

test("recoverable remote sessions retry after room loss and replay the recovered snapshot", { concurrency: false }, async () => {
  const storage = createMemoryStorage([
    [getReconnectionStorageKey("room-alpha", "player-1"), "stale-token"] as const
  ]);
  const restoreWindow = installWindow(storage);
  const firstRoom = new FakeRoom("token-first");
  const secondRoom = new FakeRoom("token-second");
  const pushed: SessionUpdate[] = [];
  const events: ConnectionEvent[] = [];
  let connectAttempts = 0;

  try {
    const session = await localSessionTestHooks.createGameSessionWithRuntime(
      "room-alpha",
      "player-1",
      1001,
      {
        onPushUpdate: (update) => {
          pushed.push(update);
        },
        onConnectionEvent: (event) => {
          events.push(event);
        }
      },
      {
        async connectRemoteGameSession(roomId, playerId, seed, options) {
          connectAttempts += 1;
          const room = connectAttempts === 1 ? firstRoom : secondRoom;
          return {
            session: localSessionTestHooks.createRemoteGameSession(
              room as unknown as ColyseusRoom,
              roomId,
              playerId,
              options
            ) as unknown as never,
            recoveredFromStoredToken: false
          };
        },
        async wait() {}
      }
    );

    const snapshotPromise = session.snapshot();
    await waitFor(() => firstRoom.sent.length === 1, "initial remote snapshot was not requested");
    firstRoom.emitLeave(CloseCode.FAILED_TO_RECONNECT);

    await waitFor(() => secondRoom.sent.length >= 1, "recovery snapshot was not requested");
    const recoveredUpdate = createSessionUpdate("recovered", 7);
    const recoveryRequestId = (secondRoom.sent[0]?.payload as { requestId: string }).requestId;
    secondRoom.emitMessage(toServerMessage(recoveryRequestId, recoveredUpdate));

    await waitFor(() => secondRoom.sent.length >= 2, "retry snapshot was not requested");
    const liveUpdate = createSessionUpdate("live", 8);
    const retryRequestId = (secondRoom.sent[1]?.payload as { requestId: string }).requestId;
    secondRoom.emitMessage(toServerMessage(retryRequestId, liveUpdate));

    const update = await snapshotPromise;
    assert.equal(connectAttempts, 2);
    assert.deepEqual(events, ["reconnect_failed", "reconnected"]);
    assert.deepEqual(pushed, [recoveredUpdate]);
    assert.deepEqual(update, liveUpdate);
    assert.deepEqual(readSessionReplay(storage, "room-alpha", "player-1"), liveUpdate);
    assert.equal(readReconnectionToken(storage, "room-alpha", "player-1"), "token-second");
  } finally {
    restoreWindow();
  }
});
