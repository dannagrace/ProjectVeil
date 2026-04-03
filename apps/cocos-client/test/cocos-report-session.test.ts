import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  resetVeilCocosSessionRuntimeForTests,
  setVeilCocosSessionRuntimeForTests,
  VeilCocosSession
} from "../assets/scripts/VeilCocosSession.ts";
import {
  createMemoryStorage,
  createReportReply,
  createSdkLoader,
  createSessionUpdate,
  FakeColyseusRoom
} from "./helpers/cocos-session-fixtures.ts";

afterEach(() => {
  resetVeilCocosSessionRuntimeForTests();
});

test("VeilCocosSession sends player reports through the websocket protocol", async () => {
  const storage = createMemoryStorage();
  const room = new FakeColyseusRoom(
    [createSessionUpdate(2)],
    "report-token",
    {
      "report.player": [
        createReportReply({
          reportId: "report-1",
          targetPlayerId: "player-2",
          reason: "harassment",
          createdAt: "2026-04-04T08:00:00.000Z"
        })
      ]
    }
  );

  setVeilCocosSessionRuntimeForTests({
    storage,
    loadSdk: createSdkLoader({
      joinRooms: [room]
    })
  });

  const session = await VeilCocosSession.create("room-alpha", "player-1", 1001);
  await session.snapshot();

  const receipt = await session.reportPlayer("player-2", "harassment", "Repeated abuse in PvP.");

  assert.deepEqual(room.sentMessages.at(-1), {
    type: "report.player",
    payload: {
      type: "report.player",
      requestId: "cocos-req-2",
      targetPlayerId: "player-2",
      reason: "harassment",
      description: "Repeated abuse in PvP."
    }
  });
  assert.deepEqual(receipt, {
    reportId: "report-1",
    targetPlayerId: "player-2",
    reason: "harassment",
    status: "pending",
    createdAt: "2026-04-04T08:00:00.000Z"
  });

  await session.dispose();
});
