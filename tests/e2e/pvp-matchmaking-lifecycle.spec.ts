import { expect, test } from "@playwright/test";
import { applyEloMatchResult, type PlayerBattleReplaySummary } from "../../packages/shared/src/index";
import { attackOnce, buildRoomId, expectHeroMoveSpent, fullMoveTextPattern, openRoom, pressTile } from "./smoke-helpers";

const SERVER_BASE_URL = "http://127.0.0.1:2567";

interface GuestLoginPayload {
  session?: {
    token?: string;
  };
}

interface MatchmakingStatusPayload {
  status: string;
  roomId?: string;
  playerIds?: [string, string];
}

interface PlayerAccountPayload {
  account?: {
    playerId?: string;
    eloRating?: number;
    lastRoomId?: string;
  };
}

interface PlayerBattleReplayListPayload {
  items?: Array<Partial<PlayerBattleReplaySummary>>;
}

async function resetStore(): Promise<void> {
  const response = await fetch(`${SERVER_BASE_URL}/api/test/reset-store`, {
    method: "POST"
  });
  if (!response.ok) {
    throw new Error(`reset_store_failed:${response.status}`);
  }
}

async function loginGuest(playerId: string, displayName: string): Promise<string> {
  const response = await fetch(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      playerId,
      displayName
    })
  });
  if (!response.ok) {
    throw new Error(`guest_login_failed:${playerId}:${response.status}`);
  }

  const payload = (await response.json()) as GuestLoginPayload;
  const token = payload.session?.token?.trim();
  if (!token) {
    throw new Error(`guest_login_missing_token:${playerId}`);
  }
  return token;
}

async function enqueuePlayer(token: string): Promise<void> {
  const response = await fetch(`${SERVER_BASE_URL}/api/matchmaking/enqueue`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error(`matchmaking_enqueue_failed:${response.status}`);
  }
}

async function fetchMatchmakingStatus(token: string): Promise<MatchmakingStatusPayload> {
  const response = await fetch(`${SERVER_BASE_URL}/api/matchmaking/status`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error(`matchmaking_status_failed:${response.status}`);
  }
  return (await response.json()) as MatchmakingStatusPayload;
}

async function fetchPlayerAccount(playerId: string): Promise<Required<PlayerAccountPayload>["account"]> {
  const response = await fetch(`${SERVER_BASE_URL}/api/player-accounts/${encodeURIComponent(playerId)}`);
  if (!response.ok) {
    throw new Error(`player_account_failed:${playerId}:${response.status}`);
  }
  const payload = (await response.json()) as PlayerAccountPayload;
  if (!payload.account) {
    throw new Error(`player_account_missing:${playerId}`);
  }
  return payload.account;
}

async function fetchLatestReplay(playerId: string): Promise<Partial<PlayerBattleReplaySummary> | null> {
  const response = await fetch(
    `${SERVER_BASE_URL}/api/player-accounts/${encodeURIComponent(playerId)}/battle-replays?limit=1`
  );
  if (!response.ok) {
    throw new Error(`player_replays_failed:${playerId}:${response.status}`);
  }
  const payload = (await response.json()) as PlayerBattleReplayListPayload;
  return payload.items?.[0] ?? null;
}

test("ranked PvP matchmaking smoke covers enqueue, match found, room join, and elo settlement", async ({ browser }) => {
  await resetStore();

  const playerOneToken = await loginGuest("player-1", "One");
  const playerTwoToken = await loginGuest("player-2", "Two");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();
  const seedRoomOne = buildRoomId("seed-player-1");
  const seedRoomTwo = buildRoomId("seed-player-2");
  const expectedRatings = applyEloMatchResult(1000, 1000);

  try {
    await Promise.all([
      openRoom(playerOnePage, {
        roomId: seedRoomOne,
        playerId: "player-1",
        expectedMoveText: fullMoveTextPattern("player-1")
      }),
      openRoom(playerTwoPage, {
        roomId: seedRoomTwo,
        playerId: "player-2",
        expectedMoveText: fullMoveTextPattern("player-2")
      })
    ]);

    await expect.poll(async () => (await fetchPlayerAccount("player-1")).lastRoomId).toBe(seedRoomOne);
    await expect.poll(async () => (await fetchPlayerAccount("player-2")).lastRoomId).toBe(seedRoomTwo);

    await enqueuePlayer(playerOneToken);
    await enqueuePlayer(playerTwoToken);

    let matchedStatus:
      | {
          roomId: string | null;
          playerIds: [string, string] | null;
          mirroredRoomId: string | null;
        }
      | null = null;
    await expect
      .poll(async () => {
        const [playerOneStatus, playerTwoStatus] = await Promise.all([
          fetchMatchmakingStatus(playerOneToken),
          fetchMatchmakingStatus(playerTwoToken)
        ]);
        if (playerOneStatus.status !== "matched" || playerTwoStatus.status !== "matched") {
          return null;
        }
        matchedStatus = {
          roomId: playerOneStatus.roomId ?? null,
          playerIds: playerOneStatus.playerIds ?? null,
          mirroredRoomId: playerTwoStatus.roomId ?? null
        };
        return matchedStatus;
      })
      .toMatchObject({
        roomId: expect.stringMatching(/^pvp-match-/),
        mirroredRoomId: expect.stringMatching(/^pvp-match-/),
        playerIds: ["player-1", "player-2"]
      });

    const matchedRoomId = matchedStatus?.roomId;
    if (!matchedRoomId) {
      throw new Error("matched_room_missing");
    }

    await Promise.all([
      openRoom(playerOnePage, {
        roomId: matchedRoomId,
        playerId: "player-1",
        expectedMoveText: fullMoveTextPattern("player-1")
      }),
      openRoom(playerTwoPage, {
        roomId: matchedRoomId,
        playerId: "player-2",
        expectedMoveText: fullMoveTextPattern("player-2")
      })
    ]);

    await expect.poll(async () => (await fetchPlayerAccount("player-1")).lastRoomId).toBe(matchedRoomId);
    await expect.poll(async () => (await fetchPlayerAccount("player-2")).lastRoomId).toBe(matchedRoomId);

    await pressTile(playerOnePage, 3, 4);
    await expectHeroMoveSpent(playerOnePage, 5, "player-1");
    await pressTile(playerTwoPage, 3, 4);

    await expect(playerOnePage.getByTestId("battle-panel")).not.toContainText("No active battle");
    await expect(playerTwoPage.getByTestId("battle-panel")).not.toContainText("No active battle");

    await attackOnce(playerTwoPage);
    await attackOnce(playerOnePage);
    await attackOnce(playerTwoPage);
    await attackOnce(playerOnePage);
    await attackOnce(playerTwoPage);
    await attackOnce(playerOnePage);

    await expect(playerOnePage.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
    await expect(playerTwoPage.getByTestId("battle-modal-title")).toHaveText("战斗失败");

    await expect.poll(async () => (await fetchPlayerAccount("player-1")).eloRating).toBe(expectedRatings.winnerRating);
    await expect.poll(async () => (await fetchPlayerAccount("player-2")).eloRating).toBe(expectedRatings.loserRating);

    await expect.poll(async () => (await fetchLatestReplay("player-1"))?.roomId ?? null).toBe(matchedRoomId);
    await expect.poll(async () => (await fetchLatestReplay("player-2"))?.roomId ?? null).toBe(matchedRoomId);
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
