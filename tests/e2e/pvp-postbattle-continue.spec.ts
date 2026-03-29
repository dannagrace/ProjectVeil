import { expect, test } from "@playwright/test";
import {
  attackOnce,
  buildRoomId,
  expectHeroMoveSpent,
  fullMoveTextPattern,
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
            expectedMoveText: fullMoveTextPattern("player-1")
          }),
          openRoom(playerTwoPage, {
            roomId,
            playerId: "player-2",
            expectedMoveText: fullMoveTextPattern("player-2")
          })
        ]);
      });

      await test.step("gameplay: resolve the battle before settlement reload", async () => {
        await pressTile(playerOnePage, 3, 4);
        await expectHeroMoveSpent(playerOnePage, 5, "player-1");

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

      await expectHeroMoveSpent(playerOnePage, 5, "player-1");
      await expectHeroMoveSpent(playerTwoPage, 6, "player-2");

      await pressTile(playerOnePage, 2, 4);
      await expectHeroMoveSpent(playerOnePage, 6, "player-1");

      await pressTile(playerTwoPage, 2, 5);
      await expectHeroMoveSpent(playerTwoPage, 6, "player-2");
      await expect(playerTwoPage.getByTestId("event-log")).toContainText("Action rejected: not_enough_move_points");
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
