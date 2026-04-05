import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCocosFriendLeaderboardSummary,
  createCocosGroupChallenge,
  normalizeCocosNotificationPreferences,
  readCocosWechatFriendCloudEntries,
  redeemCocosGroupChallenge,
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

test("buildCocosFriendLeaderboardSummary falls back cleanly when no friends are available", () => {
  assert.deepEqual(buildCocosFriendLeaderboardSummary([], 0), {
    headline: "暂无可展示的微信好友战绩",
    detail: "当前账号还没有同步好友云存档，已自动回退到常规天梯视图。",
    isFallback: true
  });
});

test("createCocosGroupChallenge and redeemCocosGroupChallenge use the social routes", async () => {
  const requests: Array<{ url: string; method: string; body?: string; auth?: string | null }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : undefined,
      auth:
        init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
          ? (init.headers as Record<string, string>).Authorization ?? null
          : null
    });

    if (requests.length === 1) {
      return new Response(
        JSON.stringify({
          challenge: {
            challengeId: "challenge-1",
            creatorPlayerId: "player-7",
            creatorDisplayName: "雾林司灯",
            roomId: "room-social",
            challengeType: "victory",
            scoreTarget: 2,
            createdAt: "2026-04-05T00:00:00.000Z",
            expiresAt: "2026-04-06T00:00:00.000Z"
          },
          token: "social-token"
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        challenge: {
          challengeId: "challenge-1",
          creatorPlayerId: "player-7",
          creatorDisplayName: "雾林司灯",
          roomId: "room-social",
          challengeType: "victory",
          scoreTarget: 2,
          createdAt: "2026-04-05T00:00:00.000Z",
          expiresAt: "2026-04-06T00:00:00.000Z"
        }
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  };

  const created = await createCocosGroupChallenge(
    "https://veil.example.com",
    {
      roomId: "room-social",
      challengeType: "victory",
      scoreTarget: 2
    },
    {
      authToken: "token-1",
      fetchImpl
    }
  );
  const redeemed = await redeemCocosGroupChallenge("https://veil.example.com", created.token, {
    authToken: "token-1",
    fetchImpl
  });

  assert.equal(created.token, "social-token");
  assert.equal(redeemed.challengeId, "challenge-1");
  assert.equal(requests.length, 2);
  assert.equal(requests[0]?.method, "POST");
  assert.match(requests[0]?.url ?? "", /\/api\/social\/group-challenge$/);
  assert.match(requests[0]?.body ?? "", /"action":"create"/);
  assert.match(requests[1]?.body ?? "", /"action":"redeem"/);
});

test("normalizeCocosNotificationPreferences defaults missing categories to enabled", () => {
  assert.deepEqual(normalizeCocosNotificationPreferences({ matchFound: false }, "2026-04-05T08:00:00.000Z"), {
    matchFound: false,
    turnReminder: true,
    groupChallenge: true,
    friendLeaderboard: true,
    updatedAt: "2026-04-05T08:00:00.000Z"
  });
});
