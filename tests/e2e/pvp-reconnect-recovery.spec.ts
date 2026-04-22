import { expect, test } from "@playwright/test";
import {
  attackOnce,
  buildRoomId,
  openRoom,
  reloadAndExpectRecoveredSession,
  startDeterministicPvpBattle,
  fullMoveTextPattern,
  withSmokeDiagnostics
} from "./smoke-helpers";

test("players can reload during a PvP battle and resume from the same turn state", async ({ browser }, testInfo) => {
  const roomId = buildRoomId("e2e-pvp-reconnect");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      await test.step("setup: both players join the same PvP room", async () => {
        await Promise.all([
          openRoom(playerOnePage, {
            roomId,
            playerId: "player-1",
            expectedMoveText: fullMoveTextPattern("player-1")
          }),
          openRoom(playerTwoPage, {
            roomId,
            playerId: "player-2",
            expectedMoveText: fullMoveTextPattern("player-2")
          })
        ]);
      });

      await test.step("gameplay: collide heroes into the same battle", async () => {
        await startDeterministicPvpBattle(playerOnePage, playerTwoPage);
        await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();
        await expect(playerTwoPage.getByTestId("battle-actions")).toContainText("等待对手操作");
        await expect(playerOnePage.getByTestId("opponent-summary")).toContainText("player-2");
        await expect(playerOnePage.getByTestId("opponent-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
        await expect(playerOnePage.getByTestId("room-result-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
      });

      await reloadAndExpectRecoveredSession(playerOnePage, {
        roomId,
        playerId: "player-1"
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
        playerId: "player-2"
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
