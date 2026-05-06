import { expect, test, type APIRequestContext } from "@playwright/test";
import { ADMIN_TOKEN, SERVER_BASE_URL } from "./runtime-targets";
const ACTIVE_WINDOW_NOW = "2026-04-10T12:00:00.000Z";
const INACTIVE_WINDOW_NOW = "2026-05-12T12:00:00.000Z";
const ACTIVE_DUNGEON_ID = "shadow-archives";
const ACTIVE_DUNGEON_NAME = "Shadow Archives";
const FINAL_FLOOR = 3;
const FINAL_FLOOR_REWARD = {
  gems: 20,
  resources: {
    gold: 300,
    wood: 15
  }
};

interface GuestLoginPayload {
  session?: {
    token?: string;
    playerId?: string;
  };
}

interface DailyDungeonRunPayload {
  runId: string;
  dungeonId: string;
  floor: number;
  rewardClaimedAt?: string;
}

interface DailyDungeonSummaryPayload {
  dungeon?: {
    id?: string;
    name?: string;
    activeWindow?: {
      startDate?: string;
      endDate?: string;
    };
  };
  dateKey?: string;
  attemptsUsed?: number;
  attemptsRemaining?: number;
  runs?: DailyDungeonRunPayload[];
}

interface PlayerProfilePayload {
  account?: {
    gems?: number;
    globalResources?: {
      gold?: number;
      wood?: number;
      ore?: number;
    };
  };
  session?: {
    token?: string;
  };
}

function buildAuthHeaders(token: string, now?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    ...(now ? { "x-veil-test-now": now } : {})
  };
}

async function createGuestSessionToken(request: APIRequestContext, playerId: string): Promise<string> {
  const response = await request.post(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    data: {
      playerId,
      displayName: "Daily Dungeon E2E",
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  expect(payload.session?.token).toBeTruthy();
  return payload.session?.token ?? "";
}

function refreshAuthToken(payload: { session?: { token?: string } }, currentToken: string): string {
  return payload.session?.token?.trim() || currentToken;
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    }
  });
  expect(response.ok()).toBeTruthy();
});

test("daily dungeon E2E covers active-window access, floor progression, reward claim, and completed-run lockout", async ({
  request
}) => {
  let token = await createGuestSessionToken(request, `daily-dungeon-e2e-${Date.now()}`);
  const activeHeaders = () => buildAuthHeaders(token, ACTIVE_WINDOW_NOW);
  const inactiveHeaders = () => buildAuthHeaders(token, INACTIVE_WINDOW_NOW);

  let gemsBeforeClaim = 0;
  let goldBeforeClaim = 0;
  let woodBeforeClaim = 0;
  let finalRunId = "";

  await test.step("api: dungeon is available during its active window and locked outside it", async () => {
    const activeResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/daily-dungeon`, {
      headers: activeHeaders()
    });
    expect(activeResponse.status()).toBe(200);

    const activePayload = (await activeResponse.json()) as { dailyDungeon?: DailyDungeonSummaryPayload };
    expect(activePayload.dailyDungeon?.dungeon?.id).toBe(ACTIVE_DUNGEON_ID);
    expect(activePayload.dailyDungeon?.dungeon?.name).toBe(ACTIVE_DUNGEON_NAME);
    expect(activePayload.dailyDungeon?.dateKey).toBe("2026-04-10");
    expect(activePayload.dailyDungeon?.dungeon?.activeWindow).toEqual({
      startDate: "2026-04-06",
      endDate: "2026-04-12"
    });

    const inactiveResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/daily-dungeon`, {
      headers: inactiveHeaders()
    });
    expect(inactiveResponse.status()).toBe(404);
    await expect(inactiveResponse.json()).resolves.toEqual({
      error: {
        code: "daily_dungeon_not_active",
        message: "Daily dungeon is not active for the requested date"
      }
    });
  });

  await test.step("api: floor entry progresses from floor 1 through the final floor", async () => {
    const profileBeforeClaimResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
      headers: activeHeaders()
    });
    expect(profileBeforeClaimResponse.ok()).toBeTruthy();

    const profileBeforeClaim = (await profileBeforeClaimResponse.json()) as PlayerProfilePayload;
    token = refreshAuthToken(profileBeforeClaim, token);
    gemsBeforeClaim = profileBeforeClaim.account?.gems ?? 0;
    goldBeforeClaim = profileBeforeClaim.account?.globalResources?.gold ?? 0;
    woodBeforeClaim = profileBeforeClaim.account?.globalResources?.wood ?? 0;

    for (const floor of [1, 2, FINAL_FLOOR]) {
      const attemptResponse = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/daily-dungeon/attempt`, {
        headers: {
          ...activeHeaders(),
          "Content-Type": "application/json"
        },
        data: { floor }
      });
      expect(attemptResponse.status()).toBe(200);

      const attemptPayload = (await attemptResponse.json()) as {
        started?: boolean;
        run?: DailyDungeonRunPayload;
        floor?: { floor?: number };
        dailyDungeon?: DailyDungeonSummaryPayload;
      };
      expect(attemptPayload.started).toBe(true);
      expect(attemptPayload.floor?.floor).toBe(floor);
      expect(attemptPayload.run?.dungeonId).toBe(ACTIVE_DUNGEON_ID);
      expect(attemptPayload.dailyDungeon?.attemptsUsed).toBe(floor);
      expect(attemptPayload.dailyDungeon?.attemptsRemaining).toBe(FINAL_FLOOR - floor);

      if (floor === 1) {
        expect(attemptPayload.dailyDungeon?.runs?.[0]?.floor).toBe(1);
      }

      if (floor === 2) {
        expect(attemptPayload.dailyDungeon?.runs?.some((run) => run.floor === 1)).toBe(true);
        expect(attemptPayload.dailyDungeon?.runs?.[0]?.floor).toBe(2);
      }

      if (floor === FINAL_FLOOR) {
        finalRunId = attemptPayload.run?.runId ?? "";
        expect(finalRunId).toBeTruthy();
      }
    }
  });

  await test.step("api: claiming the final-floor reward updates player resources and marks the run as claimed", async () => {
    const claimResponse = await request.post(
      `${SERVER_BASE_URL}/api/player-accounts/me/daily-dungeon/runs/${encodeURIComponent(finalRunId)}/claim`,
      {
        headers: activeHeaders()
      }
    );
    expect(claimResponse.status()).toBe(200);

    const claimPayload = (await claimResponse.json()) as {
      claimed?: boolean;
      run?: DailyDungeonRunPayload;
      reward?: typeof FINAL_FLOOR_REWARD;
      dailyDungeon?: DailyDungeonSummaryPayload;
    };
    expect(claimPayload.claimed).toBe(true);
    expect(claimPayload.reward).toEqual(FINAL_FLOOR_REWARD);
    expect(claimPayload.run?.floor).toBe(FINAL_FLOOR);
    expect(claimPayload.run?.rewardClaimedAt).toBeTruthy();
    expect(claimPayload.dailyDungeon?.runs?.find((run) => run.runId === finalRunId)?.rewardClaimedAt).toBeTruthy();

    const profileAfterClaimResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
      headers: activeHeaders()
    });
    expect(profileAfterClaimResponse.ok()).toBeTruthy();

    const profileAfterClaim = (await profileAfterClaimResponse.json()) as PlayerProfilePayload;
    token = refreshAuthToken(profileAfterClaim, token);
    expect(profileAfterClaim.account?.gems).toBe(gemsBeforeClaim + FINAL_FLOOR_REWARD.gems);
    expect(profileAfterClaim.account?.globalResources?.gold).toBe(goldBeforeClaim + FINAL_FLOOR_REWARD.resources.gold);
    expect(profileAfterClaim.account?.globalResources?.wood).toBe(woodBeforeClaim + FINAL_FLOOR_REWARD.resources.wood);
  });

  await test.step("api: a completed dungeon cannot be re-entered during the same active window", async () => {
    const repeatAttemptResponse = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/daily-dungeon/attempt`, {
      headers: {
        ...activeHeaders(),
        "Content-Type": "application/json"
      },
      data: { floor: 1 }
    });
    expect(repeatAttemptResponse.status()).toBe(409);
    await expect(repeatAttemptResponse.json()).resolves.toEqual({
      error: {
        code: "daily_dungeon_already_completed",
        message: "Daily dungeon has already been completed for the current window"
      }
    });
  });
});
