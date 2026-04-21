import type { Page } from "@playwright/test";
import { loadDailyQuestConfig } from "../../apps/server/src/domain/economy/daily-quest-config.ts";
import { rotateDailyQuests } from "../../apps/server/src/domain/battle/event-engine.ts";
import { expect, test } from "./fixtures";
import {
  acceptLobbyPrivacyConsent,
  attackOnce,
  buildRoomId,
  dismissBattleModal,
  expectHeroMoveSpent,
  pressTile,
  waitForLobbyReady,
  withSmokeDiagnostics
} from "./smoke-helpers";

interface AuthSessionSnapshot {
  token?: string;
  playerId?: string;
  displayName?: string;
  source?: string;
}

interface DailyQuestReward {
  gems: number;
  gold: number;
}

interface DailyQuestProgress {
  id: string;
  title?: string;
  current: number;
  completed: boolean;
  claimed: boolean;
  reward: DailyQuestReward;
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

function resolveClaimableDailyQuestPlayerId(prefix: string): string {
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

  throw new Error(`unable_to_find_claimable_daily_quest_player_id:${prefix}`);
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
  await expectHeroMoveSpent(page, 2);

  await pressTile(page, 2, 2);
  await expectHeroMoveSpent(page, 4);

  await pressTile(page, 4, 2);
  await expectHeroMoveSpent(page, 6);

  await advanceToNextDay(page, 2);

  await pressTile(page, 5, 3);
  await expectHeroMoveSpent(page, 2);

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

interface BrowserApiResult<T> {
  status: number;
  payload: T;
}

async function fetchAuthedJson<T>(page: Page, path: string, body?: unknown): Promise<BrowserApiResult<T>> {
  return await page.evaluate(
    async ({ path, body }) => {
      const raw = window.localStorage.getItem("project-veil:auth-session");
      const session = raw ? (JSON.parse(raw) as AuthSessionSnapshot) : null;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const headers: Record<string, string> = {};
        if (session?.token) {
          headers.Authorization = `Bearer ${session.token}`;
        }
        if (body !== undefined) {
          headers["Content-Type"] = "application/json";
        }

        const response = await fetch(path, {
          method: body === undefined ? "GET" : "POST",
          headers,
          ...(body !== undefined ? { body: JSON.stringify(body) } : {})
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
    { path, body }
  );
}

async function waitForStableAuthSession(page: Page, expectedPlayerId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const session = await readAuthSession(page).catch(() => null);
    if (!session || session.playerId !== expectedPlayerId) {
      await page.waitForTimeout(250);
      continue;
    }

    const result = await fetchAuthedJson<PlayerProfilePayload>(page, "/api/player-accounts/me");
    if (result.status !== 200 || !result.payload.account) {
      await page.waitForTimeout(250);
      continue;
    }

    return;
  }

  throw new Error(`auth_session_never_became_usable:${expectedPlayerId}`);
}

async function completeTutorialForDailyQuests(page: Page): Promise<void> {
  const tutorialSteps: Array<{ step: number | null; reason: "advance" | "complete" }> = [
    { step: 2, reason: "advance" },
    { step: 3, reason: "advance" },
    { step: null, reason: "complete" }
  ];

  for (const tutorialStep of tutorialSteps) {
    const result = await fetchAuthedJson(page, "/api/player-accounts/me/tutorial-progress", tutorialStep);
    expect(result.status, `tutorial progress should succeed for ${tutorialStep.reason}:${tutorialStep.step ?? "null"}`).toBe(
      200
    );
  }
}

function getQuest(board: DailyQuestBoard | undefined): DailyQuestProgress {
  const quest = board?.quests?.find((entry: DailyQuestProgress) => entry.completed && !entry.claimed);
  expect(quest).toBeTruthy();
  return quest as DailyQuestProgress;
}

test("daily quest claim smoke settles the reward and records the event log entry", async ({ page }, testInfo) => {
  const roomId = buildRoomId("e2e-daily-quest");
  const playerId = resolveClaimableDailyQuestPlayerId(`daily-quest-player-${roomId.slice(-6)}`);
  let claimableQuestId = "";
  let claimableQuestReward: DailyQuestReward = { gems: 0, gold: 0 };
  let availableClaimsBeforeClaim = 0;
  let gemsBeforeClaim = 0;
  let goldBeforeClaim = 0;

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await test.step("setup: enter the room, finish the tutorial, and clear the first battle", async () => {
      await enterRoomThroughLobby(page, roomId, playerId, "Daily Quest Smoke");
      await waitForStableAuthSession(page, playerId);
      await completeTutorialForDailyQuests(page);
      await settleFirstBattle(page);
    });

    await test.step("api: profile exposes a claimable daily quest", async () => {
      const profileResult = await fetchAuthedJson<PlayerProfilePayload>(page, "/api/player-accounts/me");
      expect(profileResult.status).toBe(200);
      const profilePayload = profileResult.payload;
      expect(profilePayload.account?.dailyQuestBoard?.enabled).toBe(true);
      expect(profilePayload.account?.dailyQuestBoard?.availableClaims).toBeGreaterThanOrEqual(1);
      availableClaimsBeforeClaim = profilePayload.account?.dailyQuestBoard?.availableClaims ?? 0;

      const quest = getQuest(profilePayload.account?.dailyQuestBoard);
      claimableQuestId = quest.id;
      claimableQuestReward = quest.reward;
      expect(quest.current).toBeGreaterThanOrEqual(1);
      expect(quest.completed).toBe(true);
      expect(quest.claimed).toBe(false);
      gemsBeforeClaim = profilePayload.account?.gems ?? 0;
      goldBeforeClaim = profilePayload.account?.globalResources?.gold ?? 0;
    });

    await test.step("api: claim returns 200, credits the reward, and updates the board", async () => {
      const claimResult = await fetchAuthedJson<ClaimPayload>(page, `/api/player-accounts/me/daily-quests/${claimableQuestId}/claim`, {});
      expect(claimResult.status).toBe(200);

      const claimPayload = claimResult.payload;
      expect(claimPayload.claimed).toBe(true);
      expect(claimPayload.reward).toEqual(claimableQuestReward);
      expect(claimPayload.dailyQuestBoard?.availableClaims).toBe(Math.max(0, availableClaimsBeforeClaim - 1));
      expect(claimPayload.dailyQuestBoard?.quests?.find((quest) => quest.id === claimableQuestId)?.claimed).toBe(true);

      const profileAfterClaimResult = await fetchAuthedJson<PlayerProfilePayload>(page, "/api/player-accounts/me");
      expect(profileAfterClaimResult.status).toBe(200);
      const profileAfterClaim = profileAfterClaimResult.payload;
      expect(profileAfterClaim.account?.gems).toBe(gemsBeforeClaim + claimableQuestReward.gems);
      expect(profileAfterClaim.account?.globalResources?.gold).toBe(goldBeforeClaim + claimableQuestReward.gold);
      expect(
        profileAfterClaim.account?.dailyQuestBoard?.quests?.find((quest) => quest.id === claimableQuestId)?.claimed
      ).toBe(true);

    });

    await test.step("api: event log includes the daily quest claim entry", async () => {
      const eventLogResult = await fetchAuthedJson<EventLogPayload>(page, "/api/player-accounts/me/event-log?limit=20");
      expect(eventLogResult.status).toBe(200);
      const eventLogPayload = eventLogResult.payload;
      const claimEntry = eventLogPayload.items?.find(
        (entry) => entry.id?.includes("daily-quest-claim:") && entry.id?.endsWith(`:${claimableQuestId}`)
      );

      expect(claimEntry).toBeTruthy();
      expect(claimEntry?.description).toContain("领取每日任务");
      expect(claimEntry?.rewards).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ label: "gems", amount: claimableQuestReward.gems }),
          expect.objectContaining({ label: "gold", amount: claimableQuestReward.gold })
        ])
      );
    });
  });
});

test("daily quest re-claim guard does not double-credit the reward", async ({ page }, testInfo) => {
  const roomId = buildRoomId("e2e-daily-quest-reclaim");
  const playerId = resolveClaimableDailyQuestPlayerId(`daily-quest-reclaim-player-${roomId.slice(-6)}`);
  let claimableQuestId = "";

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await test.step("setup: enter the room, finish the tutorial, and claim after the first battle", async () => {
      await enterRoomThroughLobby(page, roomId, playerId, "Daily Quest Reclaim");
      await waitForStableAuthSession(page, playerId);
      await completeTutorialForDailyQuests(page);
      await settleFirstBattle(page);
    });

    const claimableProfileResult = await fetchAuthedJson<PlayerProfilePayload>(page, "/api/player-accounts/me");
    expect(claimableProfileResult.status).toBe(200);
    const claimableProfile = claimableProfileResult.payload;
    claimableQuestId = getQuest(claimableProfile.account?.dailyQuestBoard).id;

    const firstClaimResult = await fetchAuthedJson<ClaimPayload>(page, `/api/player-accounts/me/daily-quests/${claimableQuestId}/claim`, {});
    expect(firstClaimResult.status).toBe(200);

    const profileAfterFirstClaimResult = await fetchAuthedJson<PlayerProfilePayload>(page, "/api/player-accounts/me");
    expect(profileAfterFirstClaimResult.status).toBe(200);
    const profileAfterFirstClaim = profileAfterFirstClaimResult.payload;

    await test.step("api: repeat claim hits the idempotency guard", async () => {
      const repeatClaimResult = await fetchAuthedJson<ClaimPayload>(page, `/api/player-accounts/me/daily-quests/${claimableQuestId}/claim`, {});
      expect([200, 409]).toContain(repeatClaimResult.status);

      const repeatClaimPayload = repeatClaimResult.payload;
      expect(repeatClaimPayload.claimed).not.toBe(true);
      expect(
        repeatClaimPayload.reason === "already_claimed" || repeatClaimPayload.error?.code === "already_claimed"
      ).toBe(true);

      const profileAfterRepeatClaimResult = await fetchAuthedJson<PlayerProfilePayload>(page, "/api/player-accounts/me");
      expect(profileAfterRepeatClaimResult.status).toBe(200);
      const profileAfterRepeatClaim = profileAfterRepeatClaimResult.payload;

      expect(profileAfterRepeatClaim.account?.gems).toBe(profileAfterFirstClaim.account?.gems);
      expect(profileAfterRepeatClaim.account?.globalResources?.gold).toBe(profileAfterFirstClaim.account?.globalResources?.gold);
      expect(
        profileAfterRepeatClaim.account?.dailyQuestBoard?.quests?.find((quest) => quest.id === claimableQuestId)?.claimed
      ).toBe(true);
    });
  });
});
