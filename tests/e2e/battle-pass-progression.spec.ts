import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { expect, test, type APIRequestContext } from "@playwright/test";
import {
  decodePlayerWorldView,
  type BattleState,
  type PlayerWorldView,
  type SessionStatePayload
} from "../../packages/shared/src/index";
import { ADMIN_TOKEN, SERVER_BASE_URL, SERVER_WS_URL } from "./runtime-targets";
const BATTLE_PASS_TIER = 2;
const BATTLE_PASS_TIER_XP_REQUIRED = 500;
const BATTLE_PASS_TIER_REWARD = {
  gold: 275
};
const BATTLE_WINS_REQUIRED = 5;
const BATTLE_XP_PER_WIN = 100;

interface GuestLoginPayload {
  session?: {
    token?: string;
  };
}

interface PlayerProfilePayload {
  account?: {
    globalResources?: {
      gold?: number;
    };
  };
}

interface SeasonProgressPayload {
  battlePassEnabled?: boolean;
  seasonXp?: number;
  seasonPassTier?: number;
  seasonPassPremium?: boolean;
  seasonPassClaimedTiers?: number[];
}

interface BattlePassClaimPayload {
  tier?: number;
  seasonPassPremiumApplied?: boolean;
  granted?: {
    gems?: number;
    resources?: {
      gold?: number;
    };
    equipmentIds?: string[];
  };
  account?: {
    globalResources?: {
      gold?: number;
    };
    seasonPassClaimedTiers?: number[];
  };
}

interface SessionStateMessage {
  requestId: string;
  delivery: "reply" | "push";
  payload: SessionStatePayload;
}

interface RawSession {
  room: ColyseusRoom;
  statesByRequestId: Map<string, SessionStateMessage[]>;
  getLatestUpdate(): {
    world: PlayerWorldView;
    battle: BattleState | null;
  };
  close(): Promise<void>;
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function createGuestSessionToken(request: APIRequestContext, playerId: string): Promise<string> {
  const response = await request.post(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    data: {
      playerId,
      displayName: "Battle Pass E2E",
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  expect(payload.session?.token).toBeTruthy();
  return payload.session?.token ?? "";
}

async function connectRawSession(roomId: string, playerId: string, authToken: string): Promise<RawSession> {
  const client = new Client(SERVER_WS_URL);
  const room = await client.joinOrCreate("veil", {
    logicalRoomId: roomId,
    playerId,
    seed: 1001
  });

  const statesByRequestId = new Map<string, SessionStateMessage[]>();
  let latestState: SessionStateMessage | null = null;

  room.onMessage("session.state", (message: SessionStateMessage) => {
    latestState = message;
    const bucket = statesByRequestId.get(message.requestId) ?? [];
    bucket.push(message);
    statesByRequestId.set(message.requestId, bucket);
  });

  const connectRequestId = `connect-${playerId}`;
  room.send("connect", {
    type: "connect",
    requestId: connectRequestId,
    roomId,
    playerId,
    authToken
  });

  await expect
    .poll(() => statesByRequestId.get(connectRequestId)?.length ?? 0, {
      message: `waiting for raw connect reply for ${playerId}`
    })
    .toBe(1);

  return {
    room,
    statesByRequestId,
    getLatestUpdate() {
      if (!latestState) {
        throw new Error(`missing_latest_state:${playerId}`);
      }

      return {
        world: decodePlayerWorldView(latestState.payload.world),
        battle: latestState.payload.battle
      };
    },
    async close() {
      await room.leave();
    }
  };
}

async function waitForReply(session: RawSession, requestId: string, previousCount = 0): Promise<void> {
  await expect
    .poll(() => session.statesByRequestId.get(requestId)?.length ?? 0, {
      message: `waiting for reply ${requestId}`
    })
    .toBeGreaterThan(previousCount);
}

async function settleNeutralBattle(session: RawSession, roomId: string): Promise<void> {
  const hero = session.getLatestUpdate().world.ownHeroes[0];
  expect(hero).toBeTruthy();

  for (const [index, destination] of [
    { x: 3, y: 1 },
    { x: 5, y: 1 },
    { x: 5, y: 3 },
    { x: 5, y: 4 }
  ].entries()) {
    const moveRequestId = `move-${roomId}-${index + 1}`;
    session.room.send("world.action", {
      type: "world.action",
      requestId: moveRequestId,
      action: {
        type: "hero.move",
        heroId: hero?.id,
        destination
      }
    });
    await waitForReply(session, moveRequestId);
  }

  await expect
    .poll(() => session.getLatestUpdate().battle !== null, {
      message: `waiting for neutral battle to start in ${roomId}`
    })
    .toBe(true);

  for (let step = 0; step < 20; step += 1) {
    const battle = session.getLatestUpdate().battle;
    if (!battle) {
      return;
    }

    const activeUnitId = battle.activeUnitId;
    const activeUnit = activeUnitId ? battle.units[activeUnitId] : undefined;
    const target = activeUnit
      ? Object.values(battle.units).find((unit) => unit.camp !== activeUnit.camp && unit.count > 0)
      : undefined;

    expect(activeUnitId).toBeTruthy();
    expect(target).toBeTruthy();

    const battleRequestId = `battle-${roomId}-${step + 1}`;
    session.room.send("battle.action", {
      type: "battle.action",
      requestId: battleRequestId,
      action: {
        type: "battle.attack",
        attackerId: activeUnitId,
        defenderId: target?.id
      }
    });
    await waitForReply(session, battleRequestId);
  }

  throw new Error(`expected neutral battle in ${roomId} to resolve within 20 player actions`);
}

async function fetchSeasonProgress(
  request: APIRequestContext,
  authHeaders: Record<string, string>
): Promise<SeasonProgressPayload> {
  const response = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/season/progress`, {
    headers: authHeaders
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as SeasonProgressPayload;
}

async function fetchGoldBalance(
  request: APIRequestContext,
  authHeaders: Record<string, string>
): Promise<number> {
  const response = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
    headers: authHeaders
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as PlayerProfilePayload;
  return payload.account?.globalResources?.gold ?? 0;
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    }
  });
  expect(response.ok()).toBeTruthy();
});

test("battle pass E2E progresses through neutral battle settlements, settles a tier claim, and rejects duplicate claims", async ({
  request
}) => {
  const playerId = "player-1";
  const token = await createGuestSessionToken(request, playerId);
  const authHeaders = buildAuthHeaders(token);

  await test.step("api: season progress starts at tier 1 with no claimed battle pass rewards", async () => {
    const initialProgress = await fetchSeasonProgress(request, authHeaders);
    expect(typeof initialProgress.battlePassEnabled).toBe("boolean");
    expect(initialProgress.seasonXp).toBe(0);
    expect(initialProgress.seasonPassTier).toBe(1);
    expect(initialProgress.seasonPassPremium).toBe(false);
    expect(initialProgress.seasonPassClaimedTiers ?? []).toEqual([]);
  });

  await test.step("gameplay: repeated neutral battle settlements unlock battle pass tier 2", async () => {
    for (let index = 0; index < BATTLE_WINS_REQUIRED; index += 1) {
      const roomId = `battle-pass-e2e-room-${index + 1}-${Date.now()}`;
      const session = await connectRawSession(roomId, playerId, token);

      try {
        await settleNeutralBattle(session, roomId);
      } finally {
        await session.close();
      }

      const expectedSeasonXp = (index + 1) * BATTLE_XP_PER_WIN;
      await expect
        .poll(async () => (await fetchSeasonProgress(request, authHeaders)).seasonXp ?? 0, {
          message: `waiting for season xp ${expectedSeasonXp} after room ${roomId}`
        })
        .toBe(expectedSeasonXp);
    }

    const unlockedProgress = await fetchSeasonProgress(request, authHeaders);
    expect(unlockedProgress.seasonXp).toBe(BATTLE_PASS_TIER_XP_REQUIRED);
    expect(unlockedProgress.seasonPassTier).toBe(BATTLE_PASS_TIER);
    expect(unlockedProgress.seasonPassClaimedTiers ?? []).not.toContain(BATTLE_PASS_TIER);
  });

  let goldBeforeClaim = 0;

  await test.step("api: claiming the unlocked tier settles the configured reward on the account", async () => {
    goldBeforeClaim = await fetchGoldBalance(request, authHeaders);

    const claimResponse = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/season/claim-tier`, {
      headers: {
        ...authHeaders,
        "Content-Type": "application/json"
      },
      data: {
        tier: BATTLE_PASS_TIER
      }
    });
    expect(claimResponse.status()).toBe(200);

    const claimPayload = (await claimResponse.json()) as BattlePassClaimPayload;
    expect(claimPayload.tier).toBe(BATTLE_PASS_TIER);
    expect(claimPayload.seasonPassPremiumApplied).toBe(false);
    expect(claimPayload.granted?.gems ?? 0).toBe(0);
    expect(claimPayload.granted?.resources?.gold).toBe(BATTLE_PASS_TIER_REWARD.gold);
    expect(claimPayload.granted?.equipmentIds ?? []).toEqual([]);
    expect(claimPayload.account?.seasonPassClaimedTiers ?? []).toContain(BATTLE_PASS_TIER);
    expect(claimPayload.account?.globalResources?.gold).toBe(goldBeforeClaim + BATTLE_PASS_TIER_REWARD.gold);

    const progressAfterClaim = await fetchSeasonProgress(request, authHeaders);
    expect(progressAfterClaim.seasonPassClaimedTiers ?? []).toContain(BATTLE_PASS_TIER);

    const goldAfterClaim = await fetchGoldBalance(request, authHeaders);
    expect(goldAfterClaim).toBe(goldBeforeClaim + BATTLE_PASS_TIER_REWARD.gold);
  });

  await test.step("api: duplicate tier claims are rejected without double-settling the reward", async () => {
    const duplicateClaimResponse = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/season/claim-tier`, {
      headers: {
        ...authHeaders,
        "Content-Type": "application/json"
      },
      data: {
        tier: BATTLE_PASS_TIER
      }
    });
    expect(duplicateClaimResponse.status()).toBe(409);
    await expect(duplicateClaimResponse.json()).resolves.toEqual({
      error: {
        code: "battle_pass_tier_already_claimed",
        message: "Battle pass tier has already been claimed"
      }
    });

    const progressAfterDuplicate = await fetchSeasonProgress(request, authHeaders);
    expect(progressAfterDuplicate.seasonPassClaimedTiers ?? []).toEqual([BATTLE_PASS_TIER]);

    const goldAfterDuplicate = await fetchGoldBalance(request, authHeaders);
    expect(goldAfterDuplicate).toBe(goldBeforeClaim + BATTLE_PASS_TIER_REWARD.gold);
  });
});
