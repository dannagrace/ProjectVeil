import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { buildRoomId, waitForLobbyReady, withSmokeDiagnostics } from "./smoke-helpers";

const SERVER_BASE_URL = "http://127.0.0.1:2567";

interface AuthSessionSnapshot {
  playerId?: string;
  token?: string;
}

interface PlayerAccountPayload {
  account?: {
    playerId?: string;
    displayName?: string;
    tutorialStep?: number | null;
    lastRoomId?: string;
    dailyQuestBoard?: {
      enabled?: boolean;
      availableClaims?: number;
    };
  };
}

interface TutorialProgressPayload {
  action?: {
    step?: number | null;
    reason?: string;
  };
  account?: PlayerAccountPayload["account"];
}

async function enterRoomThroughLobby(page: Page, roomId: string, playerId: string, displayName: string): Promise<void> {
  await waitForLobbyReady(page);
  await page.locator("[data-lobby-room-id]").fill(roomId);
  await page.locator("[data-lobby-player-id]").fill(playerId);
  await page.locator("[data-lobby-display-name]").fill(displayName);
  await page.locator("[data-enter-room]").click();

  await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
  await expect(page.getByTestId("account-card")).toContainText(displayName);
  await expect(page.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(page.getByTestId("session-meta")).toContainText(`Player: ${playerId}`);
}

async function readAuthSession(page: Page): Promise<Required<AuthSessionSnapshot>> {
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

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

async function fetchPlayerProfile(request: APIRequestContext, token: string): Promise<Required<PlayerAccountPayload>["account"]> {
  const response = await request.get(`${SERVER_BASE_URL}/api/player-accounts/me`, {
    headers: buildAuthHeaders(token)
  });
  expect(response.ok()).toBeTruthy();

  const payload = (await response.json()) as PlayerAccountPayload;
  expect(payload.account).toBeTruthy();
  return payload.account as Required<PlayerAccountPayload>["account"];
}

async function advanceTutorial(
  request: APIRequestContext,
  token: string,
  step: number | null,
  reason: "advance" | "complete" | "skip"
): Promise<TutorialProgressPayload> {
  const response = await request.post(`${SERVER_BASE_URL}/api/player-accounts/me/tutorial-progress`, {
    headers: {
      ...buildAuthHeaders(token),
      "Content-Type": "application/json"
    },
    data: {
      step,
      reason
    }
  });
  expect(response.ok()).toBeTruthy();

  return (await response.json()) as TutorialProgressPayload;
}

test("onboarding funnel: fresh session enters onboarding and keeps daily quests locked", async ({ page, request }, testInfo) => {
  const roomId = buildRoomId("e2e-onboarding-start");
  const playerId = `onboarding-start-${Date.now()}`;

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, "Onboarding Fresh Start");

    const authSession = await readAuthSession(page);
    expect(authSession.playerId).toBe(playerId);

    const profile = await fetchPlayerProfile(request, authSession.token);
    expect(profile.playerId).toBe(playerId);
    expect(profile.lastRoomId).toBe(roomId);
    expect(profile.tutorialStep).toBe(1);
    expect(profile.dailyQuestBoard?.enabled).toBe(false);
    await expect(page.getByTestId("event-log")).toContainText("已加入房间", { timeout: 10_000 });
  });
});

test("onboarding funnel: tutorial progression advances step 1 to step 3 in order", async ({ page, request }, testInfo) => {
  const roomId = buildRoomId("e2e-onboarding-progress");
  const playerId = `onboarding-progress-${Date.now()}`;

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, "Onboarding Stepper");

    const authSession = await readAuthSession(page);
    const initialProfile = await fetchPlayerProfile(request, authSession.token);
    expect(initialProfile.tutorialStep).toBe(1);

    const stepTwoPayload = await advanceTutorial(request, authSession.token, 2, "advance");
    expect(stepTwoPayload.action).toMatchObject({
      step: 2,
      reason: "advance"
    });
    expect(stepTwoPayload.account?.tutorialStep).toBe(2);
    expect(stepTwoPayload.account?.dailyQuestBoard?.enabled).toBe(false);

    const stepThreePayload = await advanceTutorial(request, authSession.token, 3, "advance");
    expect(stepThreePayload.action).toMatchObject({
      step: 3,
      reason: "advance"
    });
    expect(stepThreePayload.account?.tutorialStep).toBe(3);
    expect(stepThreePayload.account?.dailyQuestBoard?.enabled).toBe(false);

    const refreshedProfile = await fetchPlayerProfile(request, authSession.token);
    expect(refreshedProfile.tutorialStep).toBe(3);
    expect(refreshedProfile.dailyQuestBoard?.enabled).toBe(false);
  });
});

test("onboarding funnel: tutorial completion unlocks the normal account session", async ({ page, request }, testInfo) => {
  const roomId = buildRoomId("e2e-onboarding-complete");
  const playerId = `onboarding-complete-${Date.now()}`;

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, "Onboarding Complete");

    const authSession = await readAuthSession(page);
    await advanceTutorial(request, authSession.token, 2, "advance");
    await advanceTutorial(request, authSession.token, 3, "advance");
    const completionPayload = await advanceTutorial(request, authSession.token, null, "complete");

    expect(completionPayload.action).toMatchObject({
      step: null,
      reason: "complete"
    });
    expect(completionPayload.account?.tutorialStep ?? null).toBeNull();
    expect(completionPayload.account?.dailyQuestBoard?.enabled).toBe(true);

    const profile = await fetchPlayerProfile(request, authSession.token);
    expect(profile.tutorialStep ?? null).toBeNull();
    expect(profile.dailyQuestBoard?.enabled).toBe(true);
    expect(profile.dailyQuestBoard?.availableClaims).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId("stat-day")).toHaveText(/1/);
    await expect(page.getByTestId("hero-card")).toBeVisible();
  });
});

test("onboarding funnel: returning players do not re-enter the tutorial after completion", async ({ page, request }, testInfo) => {
  const roomId = buildRoomId("e2e-onboarding-return");
  const playerId = `onboarding-return-${Date.now()}`;
  const displayName = "Onboarding Return";

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await enterRoomThroughLobby(page, roomId, playerId, displayName);

    const authSession = await readAuthSession(page);
    await advanceTutorial(request, authSession.token, 2, "advance");
    await advanceTutorial(request, authSession.token, 3, "advance");
    await advanceTutorial(request, authSession.token, null, "complete");

    await page.locator("[data-return-lobby]").click();
    await expect(page.getByRole("heading", { name: "大厅 / 登录入口" })).toBeVisible();
    await expect(page.getByText(`已缓存云端会话：${playerId}`)).toBeVisible();

    const secondRoomId = buildRoomId("e2e-onboarding-return-second");
    await page.locator("[data-lobby-room-id]").fill(secondRoomId);
    await page.locator("[data-enter-room]").click();

    await expect(page).toHaveURL(new RegExp(`roomId=${secondRoomId}`));
    await expect(page.getByTestId("account-card")).toContainText(displayName);

    const returningProfile = await fetchPlayerProfile(request, authSession.token);
    expect(returningProfile.lastRoomId).toBe(secondRoomId);
    expect(returningProfile.tutorialStep ?? null).toBeNull();
    expect(returningProfile.dailyQuestBoard?.enabled).toBe(true);
  });
});
