import { expect, test } from "@playwright/test";
import {
  attackOnce,
  buildRoomId,
  openRoom,
  pressTile,
  reloadAndExpectRecoveredSession,
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
            expectedMoveText: /Move 6\/6/
          }),
          openRoom(playerTwoPage, {
            roomId,
            playerId: "player-2",
            expectedMoveText: /Move 6\/6/
          })
        ]);
      });

      await test.step("gameplay: collide heroes into the same battle", async () => {
        await pressTile(playerOnePage, 3, 4);
        await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 1\/6/);

        await pressTile(playerTwoPage, 3, 4);

        await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();
        await expect(playerOnePage.getByTestId("battle-actions")).toContainText("等待对手操作");
      });

      await reloadAndExpectRecoveredSession(playerTwoPage, {
        roomId,
        playerId: "player-2"
      });
      await expect(playerTwoPage.getByTestId("battle-panel")).not.toContainText("No active battle");
      await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();

      await attackOnce(playerTwoPage);
      await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();

      await reloadAndExpectRecoveredSession(playerOnePage, {
        roomId,
        playerId: "player-1"
      });
      await expect(playerOnePage.getByTestId("battle-panel")).not.toContainText("No active battle");
      await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();

      await attackOnce(playerOnePage);
      await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
