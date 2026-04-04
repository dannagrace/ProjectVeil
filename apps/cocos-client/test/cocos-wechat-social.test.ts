import assert from "node:assert/strict";
import test from "node:test";
import {
  readCocosWechatFriendCloudEntries,
  syncCocosWechatFriendCloudStorage
} from "../assets/scripts/cocos-wechat-social.ts";

test("readCocosWechatFriendCloudEntries normalizes player ids from cloud storage", async () => {
  const entries = await readCocosWechatFriendCloudEntries({
    getFriendCloudStorage: ({ success }) => {
      success?.({
        data: [
          {
            KVDataList: [
              { key: "playerId", value: "friend-1" },
              { key: "eloRating", value: "1432" }
            ]
          },
          {
            KVDataList: [{ key: "playerId", value: "friend-2" }]
          }
        ]
      });
    }
  });

  assert.deepEqual(entries, [
    { playerId: "friend-1", eloRating: 1432 },
    { playerId: "friend-2", eloRating: 1000 }
  ]);
});

test("syncCocosWechatFriendCloudStorage no-ops cleanly outside WeChat", async () => {
  assert.equal(
    await syncCocosWechatFriendCloudStorage(null, {
      playerId: "player-7",
      eloRating: 1500
    }),
    false
  );
});
