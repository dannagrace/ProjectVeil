import { expect, test } from "./fixtures";
import { ANALYTICS_EVENT_CATALOG } from "../../packages/shared/src/analytics-events";
import { pollForAnalyticsEvent } from "./analytics-helpers";
import { getHeroMoveTotal, getNeutralBattleReward, getNeutralBattleRewardText } from "./config-fixtures";
import {
  acceptLobbyPrivacyConsent,
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
  let goldBeforeBattle = 0;

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await test.step("lobby: enter a room as a guest", async () => {
      await waitForLobbyReady(page);
      await page.locator("[data-lobby-room-id]").fill(roomId);
      await page.locator("[data-lobby-player-id]").fill("player-1");
      await page.locator("[data-lobby-display-name]").fill("Golden Path Guest");
      await acceptLobbyPrivacyConsent(page);
      await page.locator("[data-enter-room]").click();

      await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
      await expect(page.getByTestId("account-card")).toContainText("Golden Path Guest");
      await expect(page.getByTestId("stat-day")).toHaveText(/1/);
      await expectHeroMove(page, getHeroMoveTotal());
      await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);
      await expect(page.getByTestId("stat-gold")).toHaveText(/Gold\s*\d+/);

      const sessionStartEvent = await pollForAnalyticsEvent(
        request,
        "session_start",
        (event) => event.roomId === roomId && event.payload.roomId === roomId && event.payload.authMode === "guest"
      );
      expect(sessionStartEvent.payload.authMode).toBe("guest");
      expect(typeof sessionStartEvent.payload.platform).toBe(typeof ANALYTICS_EVENT_CATALOG.session_start.samplePayload.platform);
    });

    await test.step("world: scout toward the first neutral encounter", async () => {
      await pressTile(page, 3, 1);
      await expectHeroMoveSpent(page, 2);

      await pressTile(page, 2, 2);
      await expectHeroMoveSpent(page, 4);

      await pressTile(page, 4, 2);
      await expectHeroMoveSpent(page, 6);
    });

    await test.step("world: end the day and refresh movement before the fight", async () => {
      await page.locator("[data-end-day]").click();
      await expect(page.getByTestId("stat-day")).toHaveText(/2/);
      await expectHeroMove(page, getHeroMoveTotal());
      goldBeforeBattle = Number((await page.getByTestId("stat-gold").innerText()).replace(/\D+/g, "")) || 0;
    });

    await test.step("battle: clear the neutral encounter and keep the reward", async () => {
      await pressTile(page, 5, 3);
      await expectHeroMoveSpent(page, 2);

      await pressTile(page, 4, 3);

      for (let index = 0; index < 12; index += 1) {
        if (await page.getByTestId("battle-modal").isVisible().catch(() => false)) {
          break;
        }

        if (await page.getByTestId("battle-attack").isVisible().catch(() => false)) {
          await attackOnce(page);
          continue;
        }

        const currentGold = Number((await page.getByTestId("stat-gold").innerText()).replace(/\D+/g, "")) || 0;
        if (currentGold >= goldBeforeBattle + getNeutralBattleReward().amount) {
          break;
        }

        await page.waitForTimeout(500);
      }

      if (await page.getByTestId("battle-modal").isVisible().catch(() => false)) {
        await expect(page.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
        await expect(page.getByTestId("battle-modal-body")).toContainText(getNeutralBattleRewardText());
        await dismissBattleModal(page);
      }

      await expect(page.getByTestId("stat-gold")).toHaveText(
        new RegExp(`Gold\\s*${goldBeforeBattle + getNeutralBattleReward().amount}`)
      );
      await expect(page.getByTestId("battle-empty")).toHaveText(/No active battle/);
    });
  });
});
