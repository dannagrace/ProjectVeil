import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCocosWechatSharePayload,
  syncCocosWechatShareBridge
} from "../assets/scripts/cocos-wechat-share.ts";

test("buildCocosWechatSharePayload emits launch query without reusing the inviter as playerId", () => {
  const payload = buildCocosWechatSharePayload({
    roomId: "room-alpha",
    inviterPlayerId: "player-7",
    displayName: "星炬旅人",
    scene: "lobby"
  });

  assert.equal(payload.title, "星炬旅人 邀请你加入 Project Veil 房间 room-alpha");
  assert.equal(payload.query, "roomId=room-alpha&inviterId=player-7&shareScene=lobby");
});

test("buildCocosWechatSharePayload adapts copy for world and battle scenes", () => {
  const worldPayload = buildCocosWechatSharePayload({
    roomId: "room-world",
    inviterPlayerId: "player-9",
    displayName: "岚桥旅人",
    scene: "world",
    day: 3
  });
  const battlePayload = buildCocosWechatSharePayload({
    roomId: "room-battle",
    inviterPlayerId: "player-9",
    displayName: "岚桥旅人",
    scene: "battle",
    day: 3,
    battleLabel: "明雷守军战"
  });

  assert.match(worldPayload.title, /第 3 天/);
  assert.match(worldPayload.title, /room-world/);
  assert.equal(battlePayload.title, "岚桥旅人 在 明雷守军战 中等待支援，房间 room-battle");
  assert.match(battlePayload.query, /shareScene=battle/);
  assert.match(battlePayload.query, /day=3/);
});

test("syncCocosWechatShareBridge registers menu hooks and can trigger direct share", () => {
  let menuEnabled = false;
  let sharedPayloadTitle = "";
  let registeredTitle = "";

  const result = syncCocosWechatShareBridge(
    {
      showShareMenu: () => {
        menuEnabled = true;
      },
      onShareAppMessage: (handler) => {
        registeredTitle = handler().title;
      },
      shareAppMessage: (payload) => {
        sharedPayloadTitle = payload.title;
      }
    },
    buildCocosWechatSharePayload({
      roomId: "room-share",
      inviterPlayerId: "player-2",
      displayName: "暮潮守望",
      scene: "world",
      day: 5
    }),
    { immediate: true }
  );

  assert.equal(menuEnabled, true);
  assert.equal(registeredTitle, sharedPayloadTitle);
  assert.equal(result.available, true);
  assert.equal(result.immediateShared, true);
  assert.equal(result.canShareDirectly, true);
  assert.match(result.message, /转发面板/);
});

test("syncCocosWechatShareBridge reports unsupported runtimes cleanly", () => {
  const result = syncCocosWechatShareBridge(
    null,
    buildCocosWechatSharePayload({
      roomId: "room-none",
      inviterPlayerId: "player-3",
      scene: "lobby"
    })
  );

  assert.equal(result.available, false);
  assert.equal(result.handlerRegistered, false);
  assert.equal(result.menuEnabled, false);
  assert.match(result.message, /未暴露分享能力/);
});
