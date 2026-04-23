import type { APIRequestContext, Page } from "@playwright/test";
import { loadDailyQuestConfig } from "../../apps/server/src/domain/economy/daily-quest-config.ts";
import { rotateDailyQuests } from "../../apps/server/src/domain/battle/event-engine.ts";
import { expect, test } from "./fixtures";
import {
  acceptLobbyPrivacyConsent,
  attackOnce,
  buildRoomId,
  dismissBattleModal,
  pressTile,
  waitForLobbyReady,
  withSmokeDiagnostics
} from "./smoke-helpers";
import { ADMIN_TOKEN, SERVER_BASE_URL } from "./runtime-targets";

interface AuthSessionSnapshot {
  playerId?: string;
  displayName?: string;
  token?: string;
  authMode?: string;
  provider?: string;
  sessionId?: string;
  refreshToken?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
  source?: string;
}

interface PlayerAccountPayload {
  account?: {
    playerId?: string;
    displayName?: string;
    tutorialStep?: number | null;
    lastRoomId?: string;
    gems?: number;
    globalResources?: {
      gold?: number;
      wood?: number;
      ore?: number;
    };
    dailyQuestBoard?: {
      enabled?: boolean;
      availableClaims?: number;
      quests?: Array<{
        id?: string;
        completed?: boolean;
        claimed?: boolean;
      }>;
    };
  };
  session?: AuthSessionSnapshot;
}

interface TutorialProgressPayload {
  action?: {
    step?: number | null;
    reason?: string;
  };
  account?: PlayerAccountPayload["account"];
  session?: AuthSessionSnapshot;
}

interface CampaignSummaryPayload {
  campaign?: {
    completedCount?: number;
    totalMissions?: number;
    nextMissionId?: string | null;
    missions?: Array<{
      id?: string;
      chapterId?: string;
      mapId?: string;
      name?: string;
      status?: string;
      introDialogue?: Array<{ id?: string; text?: string }>;
      objectives?: Array<{ id?: string; description?: string }>;
    }>;
  };
  session?: AuthSessionSnapshot;
}

interface CampaignStartPayload {
  started?: boolean;
  mission?: {
    id?: string;
    chapterId?: string;
    status?: string;
  };
  session?: AuthSessionSnapshot;
}

interface CampaignCompletePayload {
  completed?: boolean;
  mission?: {
    id?: string;
    chapterId?: string;
    name?: string;
    status?: string;
  };
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
    missions?: Array<{
      id?: string;
      status?: string;
    }>;
  };
  session?: AuthSessionSnapshot;
}

interface DailyQuestClaimPayload {
  claimed?: boolean;
  reward?: {
    gems?: number;
    gold?: number;
  };
  dailyQuestBoard?: {
    availableClaims?: number;
    quests?: Array<{
      id?: string;
      claimed?: boolean;
    }>;
  };
  session?: AuthSessionSnapshot;
}

interface BrowserApiResult<T> {
  status: number;
  payload: T;
}

function resolveFirstClaimableOnboardingPlayerId(prefix = "onboarding-main-seed"): string {
  const dateKey = new Date().toISOString().slice(0, 10);
  const questPool = loadDailyQuestConfig().quests;

  for (let index = 0; index < 256; index += 1) {
    const playerId = `${prefix}-${index}`;
    const { quests } = rotateDailyQuests({
      playerId,
      dateKey,
      questPool
    });
    const canReachFirstClaimOnMainPath = quests.some(
      (quest) =>
        (quest.metric === "hero_moves" && quest.target <= 4) || (quest.metric === "battle_wins" && quest.target <= 1)
    );
    if (canReachFirstClaimOnMainPath) {
      return playerId;
    }
  }

  throw new Error("unable_to_find_claimable_onboarding_player_id");
}

async function enterRoomThroughLobby(page: Page, roomId: string, playerId: string, displayName: string): Promise<void> {
  await waitForLobbyReady(page);
  await page.locator("[data-lobby-room-id]").fill(roomId);
  await page.locator("[data-lobby-player-id]").fill(playerId);
  await page.locator("[data-lobby-display-name]").fill(displayName);
  await acceptLobbyPrivacyConsent(page);
  await page.locator("[data-enter-room]").click();

  await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
  await expect(page.getByTestId("account-card")).toContainText(displayName);
  await expect(page.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(page.getByTestId("session-meta")).toContainText(`Player: ${playerId}`);
  await expect(page.getByTestId("room-connection-summary")).toContainText("已连接");
}

async function readAuthSession(page: Page): Promise<Required<Pick<AuthSessionSnapshot, "playerId" | "token">>> {
  const session = await page.evaluate(() => {
    const raw = window.localStorage.getItem("project-veil:auth-session");
    return raw ? (JSON.parse(raw) as AuthSessionSnapshot) : null;
  });

  expect(session?.playerId).toBeTruthy();
  expect(session?.token).toBeTruthy();

  return {
    playerId: session?.playerId ?? "",
    token: session?.token ?? ""
  };
}

async function fetchAuthedJson<T>(
  page: Page,
  path: string,
  init?: {
    method?: "GET" | "POST";
    body?: unknown;
  }
): Promise<BrowserApiResult<T>> {
  return await page.evaluate(
    async ({ path, init }) => {
      const raw = window.localStorage.getItem("project-veil:auth-session");
      const session = raw ? (JSON.parse(raw) as AuthSessionSnapshot) : null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const headers: Record<string, string> = {};
        if (session?.token) {
          headers.Authorization = `Bearer ${session.token}`;
        }
        if (init?.body !== undefined) {
          headers["Content-Type"] = "application/json";
        }

        const response = await fetch(path, {
          method: init?.method ?? "GET",
          headers,
          ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });

        if (response.status === 429 && attempt < 4) {
          const retryAfterSeconds = Math.max(1, Number(response.headers.get("Retry-After") ?? "1"));
          await new Promise((resolve) => window.setTimeout(resolve, retryAfterSeconds * 1000));
          continue;
        }

        const text = await response.text();
        const payload = text ? (JSON.parse(text) as T) : ({} as T);
        const nextSession = (payload as { session?: AuthSessionSnapshot } | null | undefined)?.session;
        if (nextSession?.token) {
          window.localStorage.setItem(
            "project-veil:auth-session",
            JSON.stringify({
              ...(session ?? {}),
              ...nextSession,
              playerId: nextSession.playerId ?? session?.playerId,
              displayName: nextSession.displayName ?? session?.displayName,
              source: "remote"
            })
          );
        }

        return {
          status: response.status,
          payload
        };
      }

      return {
        status: 429,
        payload: {} as T
      };
    },
    { path, init }
  );
}

async function waitForStableAuthSession(
  page: Page,
  expectedPlayerId: string
): Promise<{
  session: Required<Pick<AuthSessionSnapshot, "playerId" | "token">>;
  account: NonNullable<PlayerAccountPayload["account"]>;
}> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = await readAuthSession(page).catch(() => null);
    if (!session || session.playerId !== expectedPlayerId) {
      await page.waitForTimeout(250);
      continue;
    }

    const result = await fetchAuthedJson<PlayerAccountPayload>(page, "/api/player-accounts/me");
    if (result.status !== 200 || !result.payload.account) {
      await page.waitForTimeout(250);
      continue;
    }

    return {
      session: await readAuthSession(page),
      account: result.payload.account
    };
  }

  throw new Error(`auth_session_never_became_usable:${expectedPlayerId}`);
}

async function fetchPlayerProfile(page: Page): Promise<NonNullable<PlayerAccountPayload["account"]>> {
  const result = await fetchAuthedJson<PlayerAccountPayload>(page, "/api/player-accounts/me");
  expect(result.status, "fetchPlayerProfile should succeed").toBe(200);
  expect(result.payload.account).toBeTruthy();
  return result.payload.account as NonNullable<PlayerAccountPayload["account"]>;
}

async function fetchCampaignSummary(page: Page): Promise<NonNullable<CampaignSummaryPayload["campaign"]>> {
  const result = await fetchAuthedJson<CampaignSummaryPayload>(page, "/api/player-accounts/me/campaign");
  expect(result.status, "fetchCampaignSummary should succeed").toBe(200);
  expect(result.payload.campaign).toBeTruthy();
  return result.payload.campaign as NonNullable<CampaignSummaryPayload["campaign"]>;
}

async function startCampaignMission(page: Page, campaignId: string, missionId: string): Promise<CampaignStartPayload> {
  const result = await fetchAuthedJson<CampaignStartPayload>(page, `/api/campaigns/${campaignId}/missions/${missionId}/start`, {
    method: "POST"
  });
  expect(result.status, `startCampaignMission failed for ${missionId}`).toBe(200);
  return result.payload;
}

async function seedVerifiedCampaignReplay(
  request: APIRequestContext,
  missionId: string,
  proofContext: {
    playerId: string;
    mapId: string;
  }
): Promise<void> {
  const { mapId, playerId } = proofContext;
  expect(playerId, `completeCampaignMission requires a player id for ${missionId}`).toBeTruthy();
  expect(mapId, `completeCampaignMission requires a campaign map id for ${missionId}`).toBeTruthy();

  const response = await request.post(`${SERVER_BASE_URL}/api/test/player-accounts/${encodeURIComponent(playerId)}/action-proofs`, {
    headers: {
      "x-veil-admin-token": ADMIN_TOKEN
    },
    data: {
      campaignReplays: [
        {
          roomId: mapId,
          battleId: `${missionId}-onboarding-smoke`
        }
      ]
    }
  });
  expect(response.status(), `seed verified campaign replay failed: ${await response.text()}`).toBe(200);
}

async function completeCampaignMission(
  page: Page,
  request: APIRequestContext,
  missionId: string,
  proofContext: {
    playerId: string;
    mapId: string;
  }
): Promise<CampaignCompletePayload> {
  await seedVerifiedCampaignReplay(request, missionId, proofContext);
  const result = await fetchAuthedJson<CampaignCompletePayload>(page, `/api/player-accounts/me/campaign/${missionId}/complete`, {
    method: "POST"
  });
  expect(result.status, `completeCampaignMission failed for ${missionId}`).toBe(200);
  return result.payload;
}

async function claimDailyQuest(page: Page, questId: string): Promise<DailyQuestClaimPayload> {
  const result = await fetchAuthedJson<DailyQuestClaimPayload>(page, `/api/player-accounts/me/daily-quests/${questId}/claim`, {
    method: "POST"
  });
  expect(result.status, `claimDailyQuest failed for ${questId}`).toBe(200);
  return result.payload;
}

async function advanceTutorial(
  page: Page,
  step: number | null,
  reason: "advance" | "complete" | "skip"
): Promise<TutorialProgressPayload> {
  const result = await fetchAuthedJson<TutorialProgressPayload>(page, "/api/player-accounts/me/tutorial-progress", {
    method: "POST",
    body: {
      step,
      reason
    }
  });
  expect(result.status, `advanceTutorial failed for ${reason}:${step ?? "null"}`).toBe(200);
  return result.payload;
}

async function advanceToNextDay(page: Page, expectedDay: number): Promise<void> {
  await page.waitForTimeout(250);
  await page.evaluate(() => {
    const button = document.querySelector<HTMLButtonElement>('[data-end-day="true"]');
    if (!button) {
      throw new Error("advance_day_button_missing");
    }
    button.click();
  });
  await expect(page.getByTestId("stat-day")).toHaveText(new RegExp(`${expectedDay}`), { timeout: 10_000 });
}

async function settleFirstBattle(page: Page): Promise<void> {
  await pressTile(page, 3, 1);
  await pressTile(page, 2, 2);
  await pressTile(page, 4, 2);
  await advanceToNextDay(page, 2);
  await pressTile(page, 5, 3);
  await pressTile(page, 4, 3);
  await expect(page.getByTestId("battle-attack")).toBeVisible({ timeout: 10_000 });

  for (let index = 0; index < 12; index += 1) {
    if (await page.getByTestId("battle-modal").isVisible().catch(() => false)) {
      break;
    }

    if (await page.getByTestId("battle-attack").isVisible().catch(() => false)) {
      await attackOnce(page);
      continue;
    }

    await page.waitForTimeout(500);
  }

  await expect(page.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
  await dismissBattleModal(page);
}

test("onboarding funnel: fresh session enters onboarding and keeps daily quests locked", async ({ page }, testInfo) => {
  const roomId = buildRoomId("onb-start");
  const playerId = `onboarding-start-${Date.now()}`;

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, "Onboarding Fresh Start");

    const authSession = await waitForStableAuthSession(page, playerId);
    expect(authSession.account.playerId).toBe(playerId);
    expect(authSession.account.lastRoomId).toBe(roomId);
    expect(authSession.account.tutorialStep).toBe(1);
    expect(authSession.account.dailyQuestBoard?.enabled).toBe(false);
    await expect(page.getByTestId("event-log")).toContainText("会话已连接", { timeout: 10_000 });
  });
});

test("onboarding funnel: tutorial progression advances step 1 to step 3 in order", async ({ page }, testInfo) => {
  const roomId = buildRoomId("onb-progress");
  const playerId = `onboarding-progress-${Date.now()}`;
  const displayName = "Onboarding Stepper";

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, displayName);

    const authSession = await waitForStableAuthSession(page, playerId);
    expect(authSession.account.tutorialStep).toBe(1);

    const stepTwoPayload = await advanceTutorial(page, 2, "advance");
    expect(stepTwoPayload.action).toMatchObject({
      step: 2,
      reason: "advance"
    });
    expect(stepTwoPayload.account?.tutorialStep).toBe(2);
    expect(stepTwoPayload.account?.dailyQuestBoard?.enabled).toBe(false);

    const stepThreePayload = await advanceTutorial(page, 3, "advance");
    expect(stepThreePayload.action).toMatchObject({
      step: 3,
      reason: "advance"
    });
    expect(stepThreePayload.account?.tutorialStep).toBe(3);
    expect(stepThreePayload.account?.dailyQuestBoard?.enabled).toBe(false);

    const refreshedProfile = await fetchPlayerProfile(page);
    expect(refreshedProfile.tutorialStep).toBe(3);
    expect(refreshedProfile.dailyQuestBoard?.enabled).toBe(false);
  });
});

test("onboarding funnel: tutorial completion hands off to chapter 1, settles the first battle, and unlocks the first claim", async ({
  page,
  request
}, testInfo) => {
  test.setTimeout(60_000);
  const roomId = buildRoomId("onb-main");
  const playerId = resolveFirstClaimableOnboardingPlayerId(`onboarding-main-seed-${roomId.slice(-6)}`);
  const displayName = "Route Alpha";
  const campaignId = "chapter1";
  const firstMissionId = "chapter1-ember-watch";

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, displayName);

    const authSession = await waitForStableAuthSession(page, playerId);
    expect(authSession.account.tutorialStep).toBe(1);
    expect(authSession.account.dailyQuestBoard?.enabled).toBe(false);

    await advanceTutorial(page, 2, "advance");
    await advanceTutorial(page, 3, "advance");
    const completionPayload = await advanceTutorial(page, null, "complete");
    expect(completionPayload.action).toMatchObject({
      step: null,
      reason: "complete"
    });
    expect(completionPayload.account?.tutorialStep ?? null).toBeNull();
    expect(completionPayload.account?.dailyQuestBoard?.enabled).toBe(true);

    const postTutorialProfile = await fetchPlayerProfile(page);
    expect(postTutorialProfile.tutorialStep ?? null).toBeNull();
    expect(postTutorialProfile.dailyQuestBoard?.enabled).toBe(true);

    const campaignSummary = await fetchCampaignSummary(page);
    expect(campaignSummary.nextMissionId).toBe(firstMissionId);
    const firstMission = campaignSummary.missions?.find((mission) => mission.id === firstMissionId);
    expect(firstMission?.status).toBe("available");
    const firstMissionMapId = firstMission?.mapId ?? "";
    expect(firstMissionMapId).toBeTruthy();
    expect(campaignSummary.missions?.find((mission) => mission.id === "chapter1-thornwall-road")?.status).toBe("locked");

    const missionDetail = await fetchAuthedJson<{ mission?: CampaignSummaryPayload["campaign"]["missions"][number] }>(
      page,
      `/api/campaigns/missions/${firstMissionId}`
    );
    expect(missionDetail.status).toBe(200);
    expect(missionDetail.payload.mission?.id).toBe(firstMissionId);
    expect(missionDetail.payload.mission?.chapterId).toBe(campaignId);
    expect(missionDetail.payload.mission?.introDialogue?.length ?? 0).toBeGreaterThan(0);
    expect(missionDetail.payload.mission?.objectives?.length ?? 0).toBeGreaterThan(0);

    const startPayload = await startCampaignMission(page, campaignId, firstMissionId);
    expect(startPayload.started).toBe(true);
    expect(startPayload.mission?.id).toBe(firstMissionId);
    expect(startPayload.mission?.status).toBe("available");

    const completePayload = await completeCampaignMission(page, request, firstMissionId, {
      playerId,
      mapId: firstMissionMapId
    });
    expect(completePayload.completed).toBe(true);
    expect(completePayload.mission?.id).toBe(firstMissionId);
    expect(completePayload.mission?.status).toBe("completed");
    expect(completePayload.reward).toEqual({
      gems: 12,
      resources: {
        gold: 140
      }
    });
    expect(completePayload.campaign?.completedCount).toBe(1);
    expect(completePayload.campaign?.nextMissionId).toBe("chapter1-thornwall-road");

    await settleFirstBattle(page);

    const questProfile = await fetchPlayerProfile(page);
    expect(questProfile.dailyQuestBoard?.availableClaims ?? 0).toBeGreaterThanOrEqual(1);
    const claimableQuest = questProfile.dailyQuestBoard?.quests?.find((quest) => quest?.id && quest.completed && !quest.claimed);
    const claimableQuestId = claimableQuest?.id ?? "";
    expect(claimableQuestId).toBeTruthy();

    const questClaimPayload = await claimDailyQuest(page, claimableQuestId);
    expect(questClaimPayload.claimed).toBe(true);
    expect(questClaimPayload.dailyQuestBoard?.availableClaims).toBeGreaterThanOrEqual(0);
    expect(questClaimPayload.dailyQuestBoard?.quests?.find((quest) => quest.id === claimableQuestId)?.claimed).toBe(true);
  });
});

test("onboarding funnel: tutorial completion unlocks the normal account session", async ({ page }, testInfo) => {
  const roomId = buildRoomId("onb-complete");
  const playerId = `onboarding-complete-${Date.now()}`;

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, "Onboarding Complete");

    await waitForStableAuthSession(page, playerId);
    await advanceTutorial(page, 2, "advance");
    await advanceTutorial(page, 3, "advance");
    const completionPayload = await advanceTutorial(page, null, "complete");

    expect(completionPayload.action).toMatchObject({
      step: null,
      reason: "complete"
    });
    expect(completionPayload.account?.tutorialStep ?? null).toBeNull();
    expect(completionPayload.account?.dailyQuestBoard?.enabled).toBe(true);

    const profile = await fetchPlayerProfile(page);
    expect(profile.tutorialStep ?? null).toBeNull();
    expect(profile.dailyQuestBoard?.enabled).toBe(true);
    expect(profile.dailyQuestBoard?.availableClaims).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId("stat-day")).toHaveText(/1/);
    await expect(page.getByTestId("hero-card")).toBeVisible();
  });
});

test("onboarding funnel: returning players do not re-enter the tutorial after completion", async ({ page }, testInfo) => {
  const roomId = buildRoomId("onb-return");
  const playerId = `onboarding-return-${Date.now()}`;
  const displayName = "Onboarding Return";

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, displayName);

    await waitForStableAuthSession(page, playerId);
    await advanceTutorial(page, 2, "advance");
    await advanceTutorial(page, 3, "advance");
    await advanceTutorial(page, null, "complete");

    await page.locator("[data-return-lobby]").evaluate((button: HTMLButtonElement) => {
      button.click();
    });
    await expect(page.getByRole("heading", { name: "大厅 / 登录入口" })).toBeVisible();
    await expect(page.getByText(`已缓存云端会话：${playerId}`)).toBeVisible();

    const secondRoomId = buildRoomId("onb-return-second");
    await page.locator("[data-lobby-room-id]").fill(secondRoomId);
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-enter-room]").click();

    await expect(page).toHaveURL(new RegExp(`roomId=${secondRoomId}`));
    await expect(page.getByTestId("account-card")).toContainText(displayName);

    const returningSession = await waitForStableAuthSession(page, playerId);
    const returningProfile = returningSession.account;
    expect(returningProfile.lastRoomId).toBe(secondRoomId);
    expect(returningProfile.tutorialStep ?? null).toBeNull();
    expect(returningProfile.dailyQuestBoard?.enabled).toBe(true);
  });
});
