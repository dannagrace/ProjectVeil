import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Node, sys } from "cc";
import { resetVeilCocosSessionRuntimeForTests, setVeilCocosSessionRuntimeForTests, VeilCocosSession } from "../assets/scripts/VeilCocosSession.ts";
import { resetPixelSpriteRuntimeForTests } from "../assets/scripts/cocos-pixel-sprites.ts";
import { writeStoredCocosAuthSession } from "../assets/scripts/cocos-session-launch.ts";
import { resetVeilRootRuntimeForTests, setVeilRootRuntimeForTests, VeilRoot } from "../assets/scripts/VeilRoot.ts";
import { createMemoryStorage, createSdkLoader, createSessionUpdate, FakeColyseusRoom } from "./helpers/cocos-session-fixtures.ts";

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitFor(assertion: () => boolean, onTimeout: () => string, attempts = 20): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) {
      return;
    }
    await flushMicrotasks();
  }

  assert.fail(onTimeout());
}

function seedStoredReplay(storage: Storage, update: ReturnType<typeof createSessionUpdate>): void {
  storage.setItem(
    `project-veil:cocos:session-replay:${update.world.meta.roomId}:${update.world.playerId}`,
    JSON.stringify({
      version: 1,
      storedAt: Date.now(),
      update
    })
  );
}

afterEach(() => {
  resetVeilRootRuntimeForTests();
  resetVeilCocosSessionRuntimeForTests();
  resetPixelSpriteRuntimeForTests();
  (sys as unknown as { localStorage: Storage | null }).localStorage = null;
  delete (globalThis as { history?: History }).history;
  delete (globalThis as { location?: Location }).location;
});

test("primary cocos runtime smoke boots VeilRoot from cached replay into the first live snapshot", async () => {
  const storage = createMemoryStorage();
  const replayedUpdate = createSessionUpdate(2, "room-smoke", "player-smoke");
  const liveUpdate = createSessionUpdate(3, "room-smoke", "player-smoke");
  const room = new FakeColyseusRoom([liveUpdate], "smoke-reconnect-token");
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];

  writeStoredCocosAuthSession(storage, {
    token: "smoke.auth.token",
    playerId: "player-smoke",
    displayName: "Smoke Player",
    authMode: "account",
    provider: "account-password",
    loginId: "smoke-player",
    source: "remote"
  });
  seedStoredReplay(storage, replayedUpdate);
  (sys as unknown as { localStorage: Storage }).localStorage = storage;

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room],
      joinedOptions
    })
  });
  setVeilRootRuntimeForTests({
    createSession: (...args) => VeilCocosSession.create(...args),
    readStoredReplay: (...args) => VeilCocosSession.readStoredReplay(...args)
  });

  (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
    search: "?roomId=room-smoke",
    href: "http://127.0.0.1:4173/?roomId=room-smoke"
  };
  (globalThis as { history?: Pick<History, "replaceState"> }).history = {
    replaceState() {}
  };

  const sceneNode = new Node("RuntimeSmokeScene");
  const rootNode = new Node("VeilRootSmoke");
  rootNode.parent = sceneNode;
  const root = rootNode.addComponent(VeilRoot) as VeilRoot & Record<string, unknown>;
  const applyReplayedSessionUpdate = root.applyReplayedSessionUpdate.bind(root);
  const applySessionUpdate = root.applySessionUpdate.bind(root);
  const order: string[] = [];

  root.applyReplayedSessionUpdate = (update) => {
    order.push(`replay:${update.world.meta.day}`);
    applyReplayedSessionUpdate(update);
  };
  root.applySessionUpdate = async (update) => {
    order.push(`live:${update.world.meta.day}`);
    await applySessionUpdate(update);
  };

  root.onLoad();
  root.autoConnect = true;
  root.start();
  await waitFor(
    () => root.lastUpdate?.world.meta.day === 3,
    () =>
      JSON.stringify({
        showLobby: root.showLobby,
        autoConnect: root.autoConnect,
        sessionSource: root.sessionSource,
        lastUpdateDay: root.lastUpdate?.world.meta.day ?? null,
        logLines: root.logLines,
        sentMessages: room.sentMessages
      })
  );

  assert.equal(root.showLobby, false);
  assert.equal(root.sessionSource, "remote");
  assert.equal(root.authToken, "smoke.auth.token");
  assert.equal(root.lastUpdate?.world.meta.day, 3);
  assert.deepEqual(order, ["replay:2", "live:3"]);
  assert.deepEqual(joinedOptions, [
    {
      logicalRoomId: "room-smoke",
      playerId: "player-smoke",
      seed: 1001
    }
  ]);
  assert.deepEqual(room.sentMessages, [
    {
      type: "connect",
      payload: {
        type: "connect",
        requestId: "cocos-req-1",
        roomId: "room-smoke",
        playerId: "player-smoke",
        clientChannel: "h5",
        clientVersion: "1.0.3",
        displayName: "Smoke Player",
        authToken: "smoke.auth.token"
      }
    }
  ]);
  assert.deepEqual(
    rootNode.children.map((child) => child.name),
    [
      "ProjectVeilMusicAudio",
      "ProjectVeilCueAudio",
      "ProjectVeilHud",
      "ProjectVeilLobbyPanel",
      "ProjectVeilTutorialOverlay",
      "ProjectVeilMap",
      "ProjectVeilBattlePanel",
      "ProjectVeilTimelinePanel",
      "ProjectVeilAccountReviewPanel",
      "ProjectVeilEquipmentPanel",
      "ProjectVeilCampaignPanel",
      "ProjectVeilSettingsPanel",
      "ProjectVeilSettingsButton"
    ]
  );

  root.onDestroy();
  await flushMicrotasks();
});
