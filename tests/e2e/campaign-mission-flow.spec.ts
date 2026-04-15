import { expect, test, type APIRequestContext } from "@playwright/test";
import { pollForAnalyticsEvent } from "./analytics-helpers";

const SERVER_BASE_URL = "http://127.0.0.1:2567";
const FIRST_MISSION_ID = "chapter1-ember-watch";
const FIRST_MISSION_MAP_ID = "amber-fields";
const FIRST_CHAPTER_ID = "chapter1";
const CHAPTER_TWO_FIRST_MISSION_ID = "chapter2-highland-muster";
const CHAPTER_ONE_MISSION_IDS = [
  "chapter1-ember-watch",
  "chapter1-thornwall-road",
  "chapter1-stonewatch",
  "chapter1-ridgeway",
  "chapter1-ironpass",
  "chapter1-defend-bridge"
] as const;

interface GuestLoginPayload {
  session?: {
    token?: string;
  };
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

interface CampaignMissionPayload {
  id: string;
  chapterId: string;
  name?: string;
  status?: string;
  introDialogue?: Array<{ id?: string; text?: string }>;
  objectives?: Array<{ id?: string; description?: string }>;
  unlockRequirements?: Array<{
    type?: string;
    missionId?: string;
    satisfied?: boolean;
  }>;
}

interface CampaignSummaryPayload {
  campaign?: {
    completedCount?: number;
    totalMissions?: number;
    nextMissionId?: string | null;
    missions?: CampaignMissionPayload[];
  };
}

interface CampaignMissionDetailPayload {
  mission?: CampaignMissionPayload;
}

interface CampaignMissionStartPayload {
  started?: boolean;
  mission?: CampaignMissionPayload;
  error?: {
    code?: string;
  };
}

interface CampaignMissionCompletePayload {
  completed?: boolean;
  mission?: CampaignMissionPayload;
  reward?: {
    gems?: number;
    resources?: {
      gold?: number;
      wood?: number;
      ore?: number;
    };
  };
  campaign?: {
    completedCount?: number;
    nextMissionId?: string | null;
    missions?: CampaignMissionPayload[];
  };
  error?: {
    code?: string;
  };
}

function refreshAuthStateFromProfile(
  payload: PlayerProfilePayload,
  currentToken: string
): { token: string; authHeaders: Record<string, string> } {
  const nextToken = payload.session?.token?.trim() || currentToken;
  return {
    token: nextToken,
    authHeaders: buildAuthHeaders(nextToken)
  };
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
      displayName: "Campaign Mission E2E",
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  expect(payload.session?.token).toBeTruthy();
  return payload.session?.token ?? "";
}

async function completeMission(request: APIRequestContext, token: string, missionId: string): Promise<CampaignMissionCompletePayload> {
  const response = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/campaign/${missionId}/complete`, {
    headers: buildAuthHeaders(token)
  });
  expect(response.status(), `expected ${missionId} completion to succeed`).toBe(200);
  return (await response.json()) as CampaignMissionCompletePayload;
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${SERVER_BASE_URL}/api/test/reset-store`);
  expect(response.ok()).toBeTruthy();
});

test("campaign mission smoke covers mission start, reward settlement, unlock progression, and completed replay guards", async ({
  request
}) => {
  const playerId = `campaign-mission-e2e-${Date.now()}`;
  let token = await createGuestSessionToken(request, playerId);
  let authHeaders = buildAuthHeaders(token);

  let gemsBeforeCompletion = 0;
  let goldBeforeCompletion = 0;

  await test.step("api: campaign summary exposes chapter 1 start and chapter 2 remains locked", async () => {
    const profileResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
      headers: authHeaders
    });
    expect(profileResponse.ok()).toBeTruthy();
    const profilePayload = (await profileResponse.json()) as PlayerProfilePayload;
    ({ token, authHeaders } = refreshAuthStateFromProfile(profilePayload, token));
    gemsBeforeCompletion = profilePayload.account?.gems ?? 0;
    goldBeforeCompletion = profilePayload.account?.globalResources?.gold ?? 0;

    const summaryResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/campaign`, {
      headers: authHeaders
    });
    expect(summaryResponse.status()).toBe(200);

    const summaryPayload = (await summaryResponse.json()) as CampaignSummaryPayload;
    expect(summaryPayload.campaign?.totalMissions).toBeGreaterThanOrEqual(27);
    expect(summaryPayload.campaign?.nextMissionId).toBe(FIRST_MISSION_ID);
    expect(summaryPayload.campaign?.missions?.find((mission) => mission.id === FIRST_MISSION_ID)?.status).toBe("available");
    expect(summaryPayload.campaign?.missions?.find((mission) => mission.id === CHAPTER_TWO_FIRST_MISSION_ID)?.status).toBe("locked");
    expect(
      summaryPayload.campaign?.missions
        ?.find((mission) => mission.id === CHAPTER_TWO_FIRST_MISSION_ID)
        ?.unlockRequirements?.some(
          (requirement) => requirement.type === "mission_complete" && requirement.missionId === "chapter1-defend-bridge"
        )
    ).toBe(true);
  });

  await test.step("api: mission detail exposes dialogue and objective content for the first chapter 1 mission", async () => {
    const detailResponse = await request.get(`${SERVER_BASE_URL}/api/campaigns/missions/${FIRST_MISSION_ID}`, {
      headers: authHeaders
    });
    expect(detailResponse.status()).toBe(200);

    const detailPayload = (await detailResponse.json()) as CampaignMissionDetailPayload;
    expect(detailPayload.mission?.id).toBe(FIRST_MISSION_ID);
    expect(detailPayload.mission?.chapterId).toBe(FIRST_CHAPTER_ID);
    expect(detailPayload.mission?.introDialogue?.length ?? 0).toBeGreaterThan(0);
    expect(detailPayload.mission?.introDialogue?.[0]?.text).toBeTruthy();
    expect(detailPayload.mission?.objectives?.length ?? 0).toBeGreaterThan(0);
    expect(detailPayload.mission?.objectives?.[0]?.description).toBeTruthy();
  });

  await test.step("api: starting and completing the first mission settles rewards and advances campaign state", async () => {
    const startResponse = await request.post(
      `${SERVER_BASE_URL}/api/campaigns/${FIRST_CHAPTER_ID}/missions/${FIRST_MISSION_ID}/start`,
      {
        headers: authHeaders
      }
    );
    expect(startResponse.status()).toBe(200);

    const startPayload = (await startResponse.json()) as CampaignMissionStartPayload;
    expect(startPayload.started).toBe(true);
    expect(startPayload.mission?.id).toBe(FIRST_MISSION_ID);
    expect(startPayload.mission?.status).toBe("available");

    const completePayload = await completeMission(request, token, FIRST_MISSION_ID);
    expect(completePayload.completed).toBe(true);
    expect(completePayload.mission?.id).toBe(FIRST_MISSION_ID);
    expect(completePayload.mission?.status).toBe("completed");
    expect(completePayload.reward).toEqual({
      gems: 12,
      resources: {
        gold: 140
      }
    });
    expect(completePayload.campaign?.completedCount).toBe(1);
    expect(completePayload.campaign?.nextMissionId).toBe("chapter1-thornwall-road");
    expect(
      completePayload.campaign?.missions?.find((mission) => mission.id === "chapter1-thornwall-road")?.status
    ).toBe("available");

    const profileAfterCompletionResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
      headers: authHeaders
    });
    expect(profileAfterCompletionResponse.ok()).toBeTruthy();
    const profileAfterCompletion = (await profileAfterCompletionResponse.json()) as PlayerProfilePayload;
    ({ token, authHeaders } = refreshAuthStateFromProfile(profileAfterCompletion, token));
    expect(profileAfterCompletion.account?.gems).toBe(gemsBeforeCompletion + 12);
    expect(profileAfterCompletion.account?.globalResources?.gold).toBe(goldBeforeCompletion + 140);

    const missionCompleteEvent = await pollForAnalyticsEvent(
      request,
      "mission_complete",
      (event) => event.payload.missionId === FIRST_MISSION_ID
    );
    expect(missionCompleteEvent.payload.campaignId).toBe(FIRST_CHAPTER_ID);
    expect(missionCompleteEvent.payload.reward).toEqual({
      gems: 12,
      resources: {
        gold: 140
      }
    });
    // Verify attribution uses the mission's mapId, not the stale account.lastRoomId
    expect(missionCompleteEvent.roomId).toBe(FIRST_MISSION_MAP_ID);
  });

  await test.step("api: completed missions reject both restart and re-completion attempts", async () => {
    const repeatStartResponse = await request.post(
      `${SERVER_BASE_URL}/api/campaigns/${FIRST_CHAPTER_ID}/missions/${FIRST_MISSION_ID}/start`,
      {
        headers: authHeaders
      }
    );
    expect(repeatStartResponse.status()).toBe(409);
    const repeatStartPayload = (await repeatStartResponse.json()) as CampaignMissionStartPayload;
    expect(repeatStartPayload.error?.code).toBe("campaign_mission_already_completed");

    const repeatCompleteResponse = await request.post(
      `${SERVER_BASE_URL}/api/player-accounts/me/campaign/${FIRST_MISSION_ID}/complete`,
      {
        headers: authHeaders
      }
    );
    expect(repeatCompleteResponse.status()).toBe(409);
    const repeatCompletePayload = (await repeatCompleteResponse.json()) as CampaignMissionCompletePayload;
    expect(repeatCompletePayload.error?.code).toBe("campaign_mission_already_completed");
  });

  await test.step("api: clearing the rest of chapter 1 unlocks chapter 2", async () => {
    for (const missionId of CHAPTER_ONE_MISSION_IDS.slice(1)) {
      await completeMission(request, token, missionId);
    }

    const chapterUnlockResponse = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me/campaign`, {
      headers: authHeaders
    });
    expect(chapterUnlockResponse.status()).toBe(200);

    const chapterUnlockPayload = (await chapterUnlockResponse.json()) as CampaignSummaryPayload;
    expect(chapterUnlockPayload.campaign?.completedCount).toBe(CHAPTER_ONE_MISSION_IDS.length);
    expect(chapterUnlockPayload.campaign?.nextMissionId).toBe(CHAPTER_TWO_FIRST_MISSION_ID);
    expect(
      chapterUnlockPayload.campaign?.missions?.find((mission) => mission.id === CHAPTER_TWO_FIRST_MISSION_ID)?.status
    ).toBe("available");
  });
});
