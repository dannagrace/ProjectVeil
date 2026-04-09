import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { pollForAnalyticsEvent } from "./analytics-helpers";
import { buildRoomId, expectHeroMoveSpent, pressTile, waitForLobbyReady, withSmokeDiagnostics } from "./smoke-helpers";

const QUEST_ID = "smoke_resource_pickup";
const QUEST_REWARD = { gems: 2, gold: 35 };

interface AuthSessionSnapshot {
  token?: string;
}

interface DailyQuestProgress {
  id: string;
  current: number;
  completed: boolean;
  claimed: boolean;
  reward: {
    gems: number;
    gold: number;
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
    dailyQuestBoard?: DailyQuestBoard;
  };
}

interface DailyQuestBoard {
  enabled?: boolean;
  availableClaims?: number;
  quests?: DailyQuestProgress[];
}

interface ClaimPayload {
  claimed?: boolean;
  reason?: string;
  reward?: {
    gems?: number;
    gold?: number;
  };
  dailyQuestBoard?: {
    availableClaims?: number;
    quests?: Array<{
      id: string;
      claimed?: boolean;
    }>;
  };
  error?: {
    code?: string;
    message?: string;
  };
}

interface EventLogPayload {
  items?: Array<{
    id?: string;
    description?: string;
    rewards?: Array<{
      label?: string;
      amount?: number;
    }>;
  }>;
}

async function enterRoomThroughLobby(page: Page, roomId: string, playerId: string, displayName: string): Promise<void> {
  await waitForLobbyReady(page);
  await page.locator("[data-lobby-room-id]").fill(roomId);
  await page.locator("[data-lobby-player-id]").fill(playerId);
  await page.locator("[data-lobby-display-name]").fill(displayName);
  await page.locator("[data-enter-room]").click();

  await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
  await expect(page.getByTestId("account-card")).toContainText(displayName);
}

async function completeResourceCollection(page: Page): Promise<void> {
  await pressTile(page, 0, 1);
  await expectHeroMoveSpent(page, 1);

  await pressTile(page, 0, 0);
  await expectHeroMoveSpent(page, 2);

  await pressTile(page, 0, 0);
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);
  await expect(page.getByTestId("event-log")).toContainText("Collected wood +5");
}

async function readAuthToken(page: Page): Promise<string> {
  const authSession = await page.evaluate(() => {
    const raw = window.localStorage.getItem("project-veil:auth-session");
    return raw ? (JSON.parse(raw) as AuthSessionSnapshot) : null;
  });

  expect(authSession?.token).toBeTruthy();
  return authSession?.token ?? "";
}

function buildAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`
  };
}

function getQuest(board: DailyQuestBoard | undefined): DailyQuestProgress {
  const quest = board?.quests?.find((entry: DailyQuestProgress) => entry.id === QUEST_ID);
  expect(quest).toBeTruthy();
  return quest as DailyQuestProgress;
}

test("daily quest claim smoke settles the reward and records the event log entry", async ({ page, request }, testInfo) => {
  const roomId = buildRoomId("e2e-daily-quest");
  let gemsBeforeClaim = 0;
  let goldBeforeClaim = 0;

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await test.step("setup: enter the room and complete the resource pickup", async () => {
      await enterRoomThroughLobby(page, roomId, "player-1", "Daily Quest Smoke");
      await completeResourceCollection(page);
    });

    const token = await readAuthToken(page);

    await test.step("api: profile exposes a claimable daily quest", async () => {
      const profileResponse = await request.get("http://127.0.0.1:2567/api/player-accounts/me", {
        headers: buildAuthHeaders(token)
      });
      expect(profileResponse.ok()).toBeTruthy();

      const profilePayload = (await profileResponse.json()) as PlayerProfilePayload;
      expect(profilePayload.account?.dailyQuestBoard?.enabled).toBe(true);
      expect(profilePayload.account?.dailyQuestBoard?.availableClaims).toBeGreaterThanOrEqual(1);

      const quest = getQuest(profilePayload.account?.dailyQuestBoard);
      expect(quest.current).toBe(1);
      expect(quest.completed).toBe(true);
      expect(quest.claimed).toBe(false);
      expect(quest.reward).toEqual(QUEST_REWARD);
      gemsBeforeClaim = profilePayload.account?.gems ?? 0;
      goldBeforeClaim = profilePayload.account?.globalResources?.gold ?? 0;
    });

    await test.step("api: claim returns 200, credits the reward, and updates the board", async () => {
      const claimResponse = await request.post(`http://127.0.0.1:2567/api/player-accounts/me/daily-quests/${QUEST_ID}/claim`, {
        headers: buildAuthHeaders(token)
      });
      expect(claimResponse.status()).toBe(200);

      const claimPayload = (await claimResponse.json()) as ClaimPayload;
      expect(claimPayload.claimed).toBe(true);
      expect(claimPayload.reward).toEqual(QUEST_REWARD);
      expect(claimPayload.dailyQuestBoard?.availableClaims).toBe(0);
      expect(claimPayload.dailyQuestBoard?.quests?.find((quest) => quest.id === QUEST_ID)?.claimed).toBe(true);

      const profileAfterClaimResponse = await request.get("http://127.0.0.1:2567/api/player-accounts/me", {
        headers: buildAuthHeaders(token)
      });
      expect(profileAfterClaimResponse.ok()).toBeTruthy();

      const profileAfterClaim = (await profileAfterClaimResponse.json()) as PlayerProfilePayload;
      expect(profileAfterClaim.account?.gems).toBe(gemsBeforeClaim + QUEST_REWARD.gems);
      expect(profileAfterClaim.account?.globalResources?.gold).toBe(goldBeforeClaim + QUEST_REWARD.gold);
      expect(getQuest(profileAfterClaim.account?.dailyQuestBoard).claimed).toBe(true);

      const questCompleteEvent = await pollForAnalyticsEvent(
        request,
        "quest_complete",
        (event) => event.payload.questId === QUEST_ID
      );
      expect(questCompleteEvent.payload.questId).toBe(QUEST_ID);
      expect((questCompleteEvent.payload.reward.gems ?? 0) + (questCompleteEvent.payload.reward.gold ?? 0)).toBeGreaterThan(0);
    });

    await test.step("api: event log includes the daily quest claim entry", async () => {
      const eventLogResponse = await request.get("http://127.0.0.1:2567/api/player-accounts/me/event-log?limit=20", {
        headers: buildAuthHeaders(token)
      });
      expect(eventLogResponse.ok()).toBeTruthy();

      const eventLogPayload = (await eventLogResponse.json()) as EventLogPayload;
      const claimEntry = eventLogPayload.items?.find((entry) => entry.id?.includes("daily-quest-claim:") && entry.id?.endsWith(`:${QUEST_ID}`));

      expect(claimEntry).toBeTruthy();
      expect(claimEntry?.description).toContain("领取每日任务");
      expect(claimEntry?.rewards).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "gems", amount: QUEST_REWARD.gems }),
          expect.objectContaining({ label: "gold", amount: QUEST_REWARD.gold })
        ])
      );
    });
  });
});

test("daily quest re-claim guard does not double-credit the reward", async ({ page, request }, testInfo) => {
  const roomId = buildRoomId("e2e-daily-quest-reclaim");

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await test.step("setup: enter the room, complete the quest, and claim once", async () => {
      await enterRoomThroughLobby(page, roomId, "player-1", "Daily Quest Reclaim");
      await completeResourceCollection(page);
    });

    const token = await readAuthToken(page);

    const firstClaimResponse = await request.post(`http://127.0.0.1:2567/api/player-accounts/me/daily-quests/${QUEST_ID}/claim`, {
      headers: buildAuthHeaders(token)
    });
    expect(firstClaimResponse.status()).toBe(200);

    const profileAfterFirstClaimResponse = await request.get("http://127.0.0.1:2567/api/player-accounts/me", {
      headers: buildAuthHeaders(token)
    });
    expect(profileAfterFirstClaimResponse.ok()).toBeTruthy();
    const profileAfterFirstClaim = (await profileAfterFirstClaimResponse.json()) as PlayerProfilePayload;

    await test.step("api: repeat claim hits the idempotency guard", async () => {
      const repeatClaimResponse = await request.post(
        `http://127.0.0.1:2567/api/player-accounts/me/daily-quests/${QUEST_ID}/claim`,
        {
          headers: buildAuthHeaders(token)
        }
      );
      expect([200, 409]).toContain(repeatClaimResponse.status());

      const repeatClaimPayload = (await repeatClaimResponse.json()) as ClaimPayload;
      expect(repeatClaimPayload.claimed).not.toBe(true);
      expect(
        repeatClaimPayload.reason === "already_claimed" || repeatClaimPayload.error?.code === "already_claimed"
      ).toBe(true);

      const profileAfterRepeatClaimResponse = await request.get("http://127.0.0.1:2567/api/player-accounts/me", {
        headers: buildAuthHeaders(token)
      });
      expect(profileAfterRepeatClaimResponse.ok()).toBeTruthy();
      const profileAfterRepeatClaim = (await profileAfterRepeatClaimResponse.json()) as PlayerProfilePayload;

      expect(profileAfterRepeatClaim.account?.gems).toBe(profileAfterFirstClaim.account?.gems);
      expect(profileAfterRepeatClaim.account?.globalResources?.gold).toBe(profileAfterFirstClaim.account?.globalResources?.gold);
      expect(getQuest(profileAfterRepeatClaim.account?.dailyQuestBoard).claimed).toBe(true);
    });
  });
});
