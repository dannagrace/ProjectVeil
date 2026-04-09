import { expect, test } from "./fixtures";
import { ANALYTICS_EVENT_CATALOG } from "../../packages/shared/src/analytics-events";
import { pollForAnalyticsEvent } from "./analytics-helpers";
import {
  getHeroMoveTotal,
  getMineClaimLogText,
  getMineIncome,
  getNeutralBattleReward,
  getNeutralBattleRewardText
} from "./config-fixtures";
import {
  attackOnce,
  buildRoomId,
  dismissBattleModal,
  expectHeroMove,
  expectHeroMoveSpent,
  pressTile,
  waitForLobbyReady,
  withSmokeDiagnostics
} from "./smoke-helpers";

test("golden path player journey stays stable from lobby entry through world progress and battle reward", async (
  { page, request },
  testInfo
) => {
  const roomId = buildRoomId("e2e-golden-path");

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await test.step("lobby: enter a room as a guest", async () => {
      await waitForLobbyReady(page);
      await page.locator("[data-lobby-room-id]").fill(roomId);
      await page.locator("[data-lobby-player-id]").fill("player-1");
      await page.locator("[data-lobby-display-name]").fill("Golden Path Guest");
      await page.locator("[data-enter-room]").click();

      await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
      await expect(page.getByTestId("account-card")).toContainText("Golden Path Guest");
      await expect(page.getByTestId("stat-day")).toHaveText(/1/);
      await expectHeroMove(page, getHeroMoveTotal());
      await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);
      await expect(page.getByTestId("stat-gold")).toHaveText(/Gold\s*0/);

      const sessionStartEvent = await pollForAnalyticsEvent(
        request,
        "session_start",
        (event) => event.roomId === roomId && event.payload.roomId === roomId && event.payload.authMode === "guest"
      );
      expect(sessionStartEvent.payload.authMode).toBe("guest");
      expect(typeof sessionStartEvent.payload.platform).toBe(typeof ANALYTICS_EVENT_CATALOG.session_start.samplePayload.platform);
    });

    await test.step("world: collect wood and claim the mine", async () => {
      await pressTile(page, 0, 1);
      await expectHeroMoveSpent(page, 1);

      await pressTile(page, 0, 0);
      await expectHeroMoveSpent(page, 2);

      await pressTile(page, 0, 0);
      await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);

      await pressTile(page, 3, 1);
      await expectHeroMoveSpent(page, 6);

      await pressTile(page, 3, 1);
      await expect(page.getByTestId("stat-wood")).toHaveText(new RegExp(`Wood\\s*${5 + getMineIncome()}`));
      await expect(page.getByTestId("event-log")).toContainText(getMineClaimLogText());
    });

    await test.step("world: end the day and reset movement", async () => {
      await page.locator("[data-end-day]").click();
      await expect(page.getByTestId("stat-day")).toHaveText(/2/);
      await expectHeroMove(page, getHeroMoveTotal());
      await expect(page.getByTestId("stat-wood")).toHaveText(new RegExp(`Wood\\s*${5 + getMineIncome()}`));
    });

    await test.step("battle: clear the neutral encounter and keep the reward", async () => {
      await pressTile(page, 5, 4);
      await expectHeroMoveSpent(page, 5);
      await expect(page.getByTestId("battle-attack")).toBeVisible();

      for (let index = 0; index < 6; index += 1) {
        if (await page.getByTestId("battle-modal").isVisible().catch(() => false)) {
          break;
        }

        await attackOnce(page);
      }

      await expect(page.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
      await expect(page.getByTestId("battle-modal-body")).toContainText(getNeutralBattleRewardText());
      await dismissBattleModal(page);
      await expect(page.getByTestId("stat-gold")).toHaveText(new RegExp(`Gold\\s*${getNeutralBattleReward().amount}`));
      await expect(page.getByTestId("battle-empty")).toHaveText(/No active battle/);
    });
  });
});
