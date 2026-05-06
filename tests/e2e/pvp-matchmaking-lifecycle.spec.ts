import { expect, test, type Page } from "@playwright/test";
import { applyEloMatchResult, type PlayerBattleReplaySummary } from "../../packages/shared/src/index";
import {
  buildRoomId,
  createSmokeGuestAuthSession,
  openAuthenticatedRoom,
  readStoredAuthSession,
  resolveBattleToSettlement,
  startDeterministicPvpBattle,
  type AuthenticatedRoomSession,
  type SmokeGuestAuthSession
} from "./smoke-helpers";
import { ADMIN_TOKEN, SERVER_BASE_URL } from "./runtime-targets";

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
    method: "POST",
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    }
  });
  if (!response.ok) {
    throw new Error(`reset_store_failed:${response.status}`);
  }
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

async function fetchPlayerAccount(
  playerId: string,
  token: string
): Promise<Required<PlayerAccountPayload>["account"]> {
  const response = await fetch(`${SERVER_BASE_URL}/api/player-accounts/${encodeURIComponent(playerId)}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) {
    throw new Error(`player_account_failed:${playerId}:${response.status}`);
  }
  const payload = (await response.json()) as PlayerAccountPayload;
  if (!payload.account) {
    throw new Error(`player_account_missing:${playerId}`);
  }
  return payload.account;
}

async function fetchLatestReplay(
  playerId: string,
  token: string
): Promise<Partial<PlayerBattleReplaySummary> | null> {
  const response = await fetch(
    `${SERVER_BASE_URL}/api/player-accounts/${encodeURIComponent(playerId)}/battle-replays?limit=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );
  if (!response.ok) {
    throw new Error(`player_replays_failed:${playerId}:${response.status}`);
  }
  const payload = (await response.json()) as PlayerBattleReplayListPayload;
  return payload.items?.[0] ?? null;
}

async function readCurrentAuthToken(page: Page, session: SmokeGuestAuthSession): Promise<string> {
  return (await readStoredAuthSession(page))?.token?.trim() || session.token;
}

function sortedPlayerIds(playerIds?: [string, string] | null): string[] | null {
  return playerIds ? [...playerIds].sort() : null;
}

function resolveDeterministicBattleSlots(
  first: AuthenticatedRoomSession,
  second: AuthenticatedRoomSession
): { winner: AuthenticatedRoomSession; loser: AuthenticatedRoomSession } {
  if (first.hero.x === 1 && first.hero.y === 1 && second.hero.x === 6 && second.hero.y === 6) {
    return { winner: first, loser: second };
  }
  if (second.hero.x === 1 && second.hero.y === 1 && first.hero.x === 6 && first.hero.y === 6) {
    return { winner: second, loser: first };
  }
  throw new Error(
    `unexpected_matched_room_slots:${first.playerId}@${first.hero.x},${first.hero.y}:${second.playerId}@${second.hero.x},${second.hero.y}`
  );
}

test("ranked PvP matchmaking smoke covers enqueue, match found, room join, and elo settlement", async ({
  browser,
  request
}) => {
  await resetStore();

  const playerOneSession = await createSmokeGuestAuthSession(request, "One");
  const playerTwoSession = await createSmokeGuestAuthSession(request, "Two");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();
  const seedRoomOne = buildRoomId(`seed-${playerOneSession.playerId}`);
  const seedRoomTwo = buildRoomId(`seed-${playerTwoSession.playerId}`);
  const expectedRatings = applyEloMatchResult(1000, 1000);
  const expectedMatchPlayerIds = [playerOneSession.playerId, playerTwoSession.playerId].sort();

  try {
    await Promise.all([
      openAuthenticatedRoom(playerOnePage, {
        roomId: seedRoomOne,
        session: playerOneSession,
        expectedMoveText: null
      }),
      openAuthenticatedRoom(playerTwoPage, {
        roomId: seedRoomTwo,
        session: playerTwoSession,
        expectedMoveText: null
      })
    ]);

    await expect
      .poll(async () => (await fetchPlayerAccount(playerOneSession.playerId, await readCurrentAuthToken(playerOnePage, playerOneSession))).lastRoomId)
      .toBe(seedRoomOne);
    await expect
      .poll(async () => (await fetchPlayerAccount(playerTwoSession.playerId, await readCurrentAuthToken(playerTwoPage, playerTwoSession))).lastRoomId)
      .toBe(seedRoomTwo);

    const playerOneToken = await readCurrentAuthToken(playerOnePage, playerOneSession);
    const playerTwoToken = await readCurrentAuthToken(playerTwoPage, playerTwoSession);

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
          playerIds: sortedPlayerIds(playerOneStatus.playerIds),
          mirroredRoomId: playerTwoStatus.roomId ?? null
        };
        return matchedStatus;
      })
      .toMatchObject({
        roomId: expect.stringMatching(/^pvp-match-/),
        mirroredRoomId: expect.stringMatching(/^pvp-match-/),
        playerIds: expectedMatchPlayerIds
      });

    const matchedRoomId = matchedStatus?.roomId;
    if (!matchedRoomId) {
      throw new Error("matched_room_missing");
    }

    const [playerOneMatchedRoom, playerTwoMatchedRoom] = await Promise.all([
      openAuthenticatedRoom(playerOnePage, {
        roomId: matchedRoomId,
        session: playerOneSession,
        expectedMoveText: null
      }),
      openAuthenticatedRoom(playerTwoPage, {
        roomId: matchedRoomId,
        session: playerTwoSession,
        expectedMoveText: null
      })
    ]);
    const { winner, loser } = resolveDeterministicBattleSlots(playerOneMatchedRoom, playerTwoMatchedRoom);

    await expect
      .poll(async () => (await fetchPlayerAccount(winner.playerId, await readCurrentAuthToken(winner.page, winner.session))).lastRoomId)
      .toBe(matchedRoomId);
    await expect
      .poll(async () => (await fetchPlayerAccount(loser.playerId, await readCurrentAuthToken(loser.page, loser.session))).lastRoomId)
      .toBe(matchedRoomId);

    await startDeterministicPvpBattle(winner.page, loser.page);
    await resolveBattleToSettlement(winner.page, loser.page);

    await expect(winner.page.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
    await expect(loser.page.getByTestId("battle-modal-title")).toHaveText("战斗失败");

    await expect
      .poll(async () => (await fetchPlayerAccount(winner.playerId, await readCurrentAuthToken(winner.page, winner.session))).eloRating)
      .toBe(expectedRatings.winnerRating);
    await expect
      .poll(async () => (await fetchPlayerAccount(loser.playerId, await readCurrentAuthToken(loser.page, loser.session))).eloRating)
      .toBe(expectedRatings.loserRating);

    await expect
      .poll(async () => (await fetchLatestReplay(winner.playerId, await readCurrentAuthToken(winner.page, winner.session)))?.roomId ?? null)
      .toBe(matchedRoomId);
    await expect
      .poll(async () => (await fetchLatestReplay(loser.playerId, await readCurrentAuthToken(loser.page, loser.session)))?.roomId ?? null)
      .toBe(matchedRoomId);
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
