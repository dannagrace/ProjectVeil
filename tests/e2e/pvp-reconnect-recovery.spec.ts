import { expect, test } from "@playwright/test";
import {
  attackOnce,
  buildRoomId,
  openAuthenticatedMultiplayerRoomPair,
  reloadAndExpectRecoveredSession,
  startDeterministicPvpBattle,
  withSmokeDiagnostics
} from "./smoke-helpers";

test("players can reload during a PvP battle and resume from the same turn state", async ({ browser, request }, testInfo) => {
  const roomId = buildRoomId("e2e-pvp-reconnect");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      const { playerOne, playerTwo } = await test.step("setup: both players join the same PvP room", async () =>
        openAuthenticatedMultiplayerRoomPair(request, playerOnePage, playerTwoPage, roomId)
      );

      await test.step("gameplay: collide heroes into the same battle", async () => {
        await startDeterministicPvpBattle(playerOnePage, playerTwoPage);
        await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();
        await expect(playerTwoPage.getByTestId("battle-actions")).toContainText("等待对手操作");
        await expect(playerOnePage.getByTestId("opponent-summary")).toContainText(playerTwo.playerId);
        await expect(playerOnePage.getByTestId("opponent-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
        await expect(playerOnePage.getByTestId("room-result-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
      });

      await reloadAndExpectRecoveredSession(playerOnePage, {
        roomId,
        playerId: playerOne.playerId
      });
      await expect(playerOnePage.getByTestId("battle-panel")).not.toContainText("No active battle");
      await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();
      await expect(playerOnePage.getByTestId("room-recovery-summary")).toContainText("权威战斗状态已恢复");
      await expect(playerOnePage.getByTestId("opponent-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
      await expect(playerOnePage.getByTestId("room-next-action")).toContainText("等待本场对抗结算");

      await attackOnce(playerOnePage);
      await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();

      await reloadAndExpectRecoveredSession(playerTwoPage, {
        roomId,
        playerId: playerTwo.playerId
      });
      await expect(playerTwoPage.getByTestId("battle-panel")).not.toContainText("No active battle");
      await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();
      await expect(playerTwoPage.getByTestId("room-recovery-summary")).toContainText("权威战斗状态已恢复");
      await expect(playerTwoPage.getByTestId("opponent-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
      await expect(playerTwoPage.getByTestId("room-result-summary")).toContainText(`仍由 ${roomId}/battle-`);

      await attackOnce(playerTwoPage);
      await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
