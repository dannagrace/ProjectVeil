import { sys } from "cc";
import type { ConnectionEvent, SessionUpdate, VeilCocosSessionOptions } from "../../assets/scripts/VeilCocosSession.ts";
import {
  resetVeilCocosSessionRuntimeForTests,
  setVeilCocosSessionRuntimeForTests,
  VeilCocosSession
} from "../../assets/scripts/VeilCocosSession.ts";
import { createMemoryStorage, createSdkLoader, FakeColyseusRoom } from "./cocos-session-fixtures.ts";
import { createVeilRootHarness, installVeilRootRuntime, resetVeilRootRuntime } from "./veil-root-harness.ts";

type RootSessionDouble = {
  snapshot(): Promise<SessionUpdate>;
  dispose(): Promise<void>;
};

export function resetCocosRuntimeHarnesses(): void {
  resetVeilRootRuntime();
  resetVeilCocosSessionRuntimeForTests();
  (sys as unknown as { localStorage: Storage | null }).localStorage = null;
}

export function createVeilRootRuntimeHarness(options: {
  replayedUpdate?: SessionUpdate | null;
  liveUpdate: SessionUpdate;
  storage?: Storage;
  session?: RootSessionDouble;
  guestAuthToken?: string;
}) {
  const storage = options.storage ?? createMemoryStorage();
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  const root = createVeilRootHarness();
  const session =
    options.session ??
    ({
      async snapshot() {
        return options.liveUpdate;
      },
      async dispose() {}
    } satisfies RootSessionDouble);

  let capturedOptions: VeilCocosSessionOptions | undefined;
  installVeilRootRuntime({
    readStoredReplay: () => options.replayedUpdate ?? null,
    createSession: async (_roomId, _playerId, _seed, sessionOptions) => {
      capturedOptions = sessionOptions;
      return session as never;
    },
    ...(options.guestAuthToken
      ? {
          loginGuestAuthSession: async (_remoteUrl, playerId, displayName) => ({
            token: options.guestAuthToken,
            playerId,
            displayName,
            authMode: "guest" as const,
            provider: "guest" as const,
            source: "remote" as const
          })
        }
      : {})
  });

  return {
    root,
    storage,
    session,
    getSessionOptions(): VeilCocosSessionOptions | undefined {
      return capturedOptions;
    },
    emitConnectionEvent(event: ConnectionEvent): void {
      capturedOptions?.onConnectionEvent?.(event);
    },
    emitPushUpdate(update: SessionUpdate): void {
      capturedOptions?.onPushUpdate?.(update);
    }
  };
}

export function createVeilCocosSessionRuntimeHarness(options?: {
  storage?: Storage;
  joinRooms?: Array<FakeColyseusRoom | Error>;
  reconnectRooms?: FakeColyseusRoom[];
  wait?: (() => Promise<void>) | null;
}) {
  const storage = options?.storage ?? createMemoryStorage();
  const reconnectTokens: string[] = [];
  const endpoints: string[] = [];
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];

  setVeilCocosSessionRuntimeForTests({
    storage,
    ...(options?.wait ? { wait: options.wait } : {}),
    loadSdk: createSdkLoader({
      joinRooms: options?.joinRooms,
      reconnectRooms: options?.reconnectRooms,
      reconnectTokens,
      joinedOptions,
      endpoints
    })
  });

  return {
    storage,
    reconnectTokens,
    joinedOptions,
    endpoints,
    create(roomId = "room-alpha", playerId = "player-1", seed = 1001, sessionOptions?: VeilCocosSessionOptions) {
      return VeilCocosSession.create(roomId, playerId, seed, sessionOptions);
    }
  };
}

export function createVeilRootSessionLifecycleHarness(options?: {
  storage?: Storage;
  joinRooms?: Array<FakeColyseusRoom | Error>;
  reconnectRooms?: FakeColyseusRoom[];
  wait?: (() => Promise<void>) | null;
  guestAuthToken?: string;
  syncedAuthSession?: {
    token?: string;
    playerId: string;
    displayName: string;
    authMode: "guest" | "account";
    provider?: "guest" | "account-password" | "wechat-mini-game";
    loginId?: string;
    source: "remote" | "local";
  } | null;
}) {
  const storage = options?.storage ?? createMemoryStorage();
  const reconnectTokens: string[] = [];
  const endpoints: string[] = [];
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];

  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  setVeilCocosSessionRuntimeForTests({
    storage,
    ...(options?.wait ? { wait: options.wait } : {}),
    loadSdk: createSdkLoader({
      joinRooms: options?.joinRooms,
      reconnectRooms: options?.reconnectRooms,
      reconnectTokens,
      joinedOptions,
      endpoints
    })
  });

  installVeilRootRuntime({
    createSession: (...args) => VeilCocosSession.create(...args),
    readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args),
    ...(options?.guestAuthToken
      ? {
          loginGuestAuthSession: async (_remoteUrl, playerId, displayName) => ({
            token: options.guestAuthToken,
            playerId,
            displayName,
            authMode: "guest" as const,
            provider: "guest" as const,
            source: "remote" as const
          })
        }
      : {}),
    ...(typeof options?.syncedAuthSession !== "undefined"
      ? {
          syncAuthSession: async () => options.syncedAuthSession ?? null
        }
      : {})
  });

  return {
    root: createVeilRootHarness(),
    storage,
    reconnectTokens,
    joinedOptions,
    endpoints
  };
}
