import { expect, test, type APIRequestContext } from "@playwright/test";
import { pollForAnalyticsEvent } from "./analytics-helpers";
import { SERVER_BASE_URL } from "./runtime-targets";
const ADMIN_TOKEN = process.env.VEIL_ADMIN_TOKEN ?? "dev-admin-token";
const EVENT_ID = "defend-the-bridge";
const OBJECTIVE_ACTION_TYPE = "daily_dungeon_reward_claimed";
const OBJECTIVE_DUNGEON_ID = "shadow-archives";
const GEMS_REWARD_ID = "bridge-relief-fund";
const BADGE_REWARD_ID = "bridge-vanguard-badge";
const BADGE_ID = "bridge_vanguard_2026";
const GEMS_REWARD_AMOUNT = 35;

interface GuestLoginPayload {
  session?: {
    playerId?: string;
    token?: string;
  };
}

interface PlayerProfilePayload {
  account?: {
    gems?: number;
    seasonBadges?: string[];
  };
  session?: {
    token?: string;
  };
}

interface SeasonalEventResponse {
  id?: string;
  player?: {
    points?: number;
    claimedRewardIds?: string[];
    claimableRewardIds?: string[];
  };
  leaderboard?: {
    entries?: Array<{
      rank?: number;
      playerId?: string;
      points?: number;
    }>;
  };
}

interface ActiveEventsPayload {
  events?: SeasonalEventResponse[];
}

interface ProgressPayload {
  applied?: boolean;
  eventProgress?: {
    eventId?: string;
    delta?: number;
    points?: number;
    objectiveId?: string;
  };
  event?: SeasonalEventResponse;
}

interface ClaimPayload {
  claimed?: boolean;
  reward?: {
    id?: string;
    gems?: number;
    badge?: string;
  };
  event?: SeasonalEventResponse;
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function createGuestSession(
  request: APIRequestContext,
  playerId: string
): Promise<{ playerId: string; token: string }> {
  const response = await request.post(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    data: {
      playerId,
      displayName: "Seasonal Event E2E",
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  expect(payload.session?.token).toBeTruthy();
  expect(payload.session?.playerId).toBeTruthy();
  return {
    playerId: payload.session?.playerId ?? "",
    token: payload.session?.token ?? ""
  };
}

async function patchEventActiveWindow(request: APIRequestContext): Promise<void> {
  const now = Date.now();
  const response = await request.patch(`${SERVER_BASE_URL}/api/admin/seasonal-events/${EVENT_ID}`, {
    headers: {
      "Content-Type": "application/json",
      "x-veil-admin-token": ADMIN_TOKEN
    },
    data: {
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
      isActive: true
    }
  });
  expect(response.status()).toBe(200);
}

async function fetchActiveEvent(request: APIRequestContext, token: string): Promise<SeasonalEventResponse> {
  const response = await request.get(`${SERVER_BASE_URL}/api/events/active`, {
    headers: buildAuthHeaders(token)
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as ActiveEventsPayload;
  const event = payload.events?.find((entry) => entry.id === EVENT_ID);
  expect(event).toBeTruthy();
  return event as SeasonalEventResponse;
}

async function seedVerifiedDailyDungeonClaim(request: APIRequestContext, playerId: string, runId: string): Promise<void> {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/player-accounts/${encodeURIComponent(playerId)}/action-proofs`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    },
    data: {
      dailyDungeonClaims: [
        {
          runId,
          dungeonId: OBJECTIVE_DUNGEON_ID,
          floor: 1
        }
      ]
    }
  });
  expect(response.status(), `expected ${runId} daily dungeon claim proof seeding to succeed`).toBe(200);
}

async function submitProgress(request: APIRequestContext, token: string, playerId: string, actionId: string): Promise<ProgressPayload> {
  await seedVerifiedDailyDungeonClaim(request, playerId, actionId);
  const response = await request.post(`${SERVER_BASE_URL}/api/events/${EVENT_ID}/progress`, {
    headers: buildAuthHeaders(token),
    data: {
      actionId,
      actionType: OBJECTIVE_ACTION_TYPE,
      dungeonId: OBJECTIVE_DUNGEON_ID
    }
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as ProgressPayload;
}

async function claimReward(request: APIRequestContext, token: string, rewardId: string): Promise<ClaimPayload> {
  const response = await request.post(`${SERVER_BASE_URL}/api/events/claim`, {
    headers: buildAuthHeaders(token),
    data: {
      eventId: EVENT_ID,
      rewardId
    }
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as ClaimPayload;
}

async function fetchProfile(
  request: APIRequestContext,
  token: string
): Promise<{ account: NonNullable<PlayerProfilePayload["account"]>; token: string }> {
  const response = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
    headers: buildAuthHeaders(token)
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as PlayerProfilePayload;
  expect(payload.account).toBeTruthy();
  expect(payload.session?.token).toBeTruthy();
  return {
    account: payload.account as NonNullable<PlayerProfilePayload["account"]>,
    token: payload.session?.token ?? token
  };
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    }
  });
  expect(response.ok()).toBeTruthy();
});

test("seasonal event smoke covers progress submission, reward claim settlement, and leaderboard visibility", async ({ request }) => {
  const requestedPlayerId = `seasonal-e2e-${Date.now()}`;
  const guestSession = await createGuestSession(request, requestedPlayerId);
  const playerId = guestSession.playerId;
  let token = guestSession.token;
  await patchEventActiveWindow(request);

  const profileBeforeClaim = await fetchProfile(request, token);
  token = profileBeforeClaim.token;

  await test.step("api: active event is visible before progress", async () => {
    const event = await fetchActiveEvent(request, token);
    expect(event.player?.points).toBe(0);
    expect(event.player?.claimedRewardIds ?? []).toEqual([]);
    expect(event.player?.claimableRewardIds ?? []).toEqual([]);
  });

  await test.step("api: repeated progress submissions unlock the event rewards and place the player on the leaderboard", async () => {
    for (let index = 1; index <= 5; index += 1) {
      const payload = await submitProgress(request, token, playerId, `seasonal-progress-${index}`);
      expect(payload.applied).toBe(true);
      expect(payload.eventProgress).toEqual({
        eventId: EVENT_ID,
        delta: 40,
        points: index * 40,
        objectiveId: "bridge-dungeon-clear"
      });
    }

    const event = await fetchActiveEvent(request, token);
    expect(event.player?.points).toBe(200);
    expect(event.player?.claimableRewardIds ?? []).toEqual(
      expect.arrayContaining(["bridge-ration-cache", GEMS_REWARD_ID, BADGE_REWARD_ID])
    );
    expect(event.leaderboard?.entries?.[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        playerId,
        points: 200
      })
    );
  });

  await test.step("api: reward claims settle gems and badge credits and keep the leaderboard visible", async () => {
    const gemsClaim = await claimReward(request, token, GEMS_REWARD_ID);
    expect(gemsClaim.claimed).toBe(true);
    expect(gemsClaim.reward?.id).toBe(GEMS_REWARD_ID);
    expect(gemsClaim.reward?.gems).toBe(GEMS_REWARD_AMOUNT);

    const badgeClaim = await claimReward(request, token, BADGE_REWARD_ID);
    expect(badgeClaim.claimed).toBe(true);
    expect(badgeClaim.reward?.id).toBe(BADGE_REWARD_ID);
    expect(badgeClaim.reward?.badge).toBe(BADGE_ID);

    const profileAfterClaim = await fetchProfile(request, token);
    token = profileAfterClaim.token;
    expect(profileAfterClaim.account.gems).toBe((profileBeforeClaim.account.gems ?? 0) + GEMS_REWARD_AMOUNT);
    expect(profileAfterClaim.account.seasonBadges ?? []).toContain(BADGE_ID);

    const eventAfterClaim = await fetchActiveEvent(request, token);
    expect(eventAfterClaim.player?.claimedRewardIds ?? []).toEqual(expect.arrayContaining([GEMS_REWARD_ID, BADGE_REWARD_ID]));
    expect(eventAfterClaim.leaderboard?.entries?.[0]).toEqual(
      expect.objectContaining({
        rank: 1,
        playerId,
        points: 200
      })
    );
  });

  await test.step("api: seasonal claim emits analytics", async () => {
    const claimEvent = await pollForAnalyticsEvent(
      request,
      "seasonal_event_reward_claimed",
      (event) => event.payload.eventId === EVENT_ID && event.payload.rewardId === GEMS_REWARD_ID
    );
    expect(claimEvent.payload.rewardKind).toBe("gems");
    expect(claimEvent.payload.pointsRequired).toBe(120);
  });
});
