import { expect, test } from "@playwright/test";
import {
  attackOnce,
  buildRoomId,
  openRoom,
  pressTile,
  reloadAndExpectRecoveredSession,
  withSmokeDiagnostics
} from "./smoke-helpers";

test("winner can keep moving after a reloaded PvP settlement while loser stays locked by zero movement", async ({ browser }, testInfo) => {
  const roomId = buildRoomId("e2e-pvp-postbattle-continue");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      await test.step("setup: both players join the room", async () => {
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

      await test.step("gameplay: resolve the battle before settlement reload", async () => {
        await pressTile(playerOnePage, 3, 4);
        await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 1\/6/);

        await pressTile(playerTwoPage, 3, 4);

        await attackOnce(playerTwoPage);
        await attackOnce(playerOnePage);
        await attackOnce(playerTwoPage);
        await attackOnce(playerOnePage);
        await attackOnce(playerTwoPage);

        await expect(playerOnePage.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
        await expect(playerTwoPage.getByTestId("battle-modal-title")).toHaveText("战斗失败");
      });

      await Promise.all([
        reloadAndExpectRecoveredSession(playerOnePage, {
          roomId,
          playerId: "player-1"
        }),
        reloadAndExpectRecoveredSession(playerTwoPage, {
          roomId,
          playerId: "player-2"
        })
      ]);

      await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 1\/6/);
      await expect(playerTwoPage.getByTestId("hero-move")).toHaveText(/Move 0\/6/);

      await pressTile(playerOnePage, 2, 4);
      await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 0\/6/);

      await pressTile(playerTwoPage, 2, 5);
      await expect(playerTwoPage.getByTestId("hero-move")).toHaveText(/Move 0\/6/);
      await expect(playerTwoPage.getByTestId("event-log")).toContainText("Action rejected: not_enough_move_points");
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
