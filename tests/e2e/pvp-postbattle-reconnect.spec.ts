import { expect, test } from "@playwright/test";
import {
  attackOnce,
  buildRoomId,
  openRoom,
  pressTile,
  reloadAndExpectRecoveredSession,
  withSmokeDiagnostics
} from "./smoke-helpers";

test("players can reload after a PvP battle resolves and keep the settled world state", async ({ browser }, testInfo) => {
  const roomId = buildRoomId("e2e-pvp-postbattle");
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

      await test.step("gameplay: resolve the PvP battle to settlement", async () => {
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

      await expect(playerOnePage.getByTestId("room-recovery-summary")).toContainText("权威房间状态已恢复");
      await expect(playerOnePage.getByTestId("room-recovery-summary")).toContainText("战后结果与地图状态已经重新对齐");
      await expect(playerTwoPage.getByTestId("room-recovery-summary")).toContainText("权威房间状态已恢复");
      await expect(playerOnePage.getByTestId("room-phase")).toHaveText("已结算");
      await expect(playerTwoPage.getByTestId("room-phase")).toHaveText("已结算");
      await expect(playerOnePage.getByTestId("battle-settlement-summary")).toContainText("已击败");
      await expect(playerOnePage.getByTestId("battle-settlement-room-state")).toContainText("房间已回到地图探索阶段");
      await expect(playerOnePage.getByTestId("battle-settlement-next-action")).toContainText("仍可继续移动");
      await expect(playerTwoPage.getByTestId("battle-settlement-summary")).toContainText("遭遇战失利");
      await expect(playerTwoPage.getByTestId("battle-settlement-room-state")).toContainText("对手仍保留在房间地图上");
      await expect(playerTwoPage.getByTestId("battle-settlement-next-action")).toContainText("已无法继续移动");
      await expect(playerOnePage.getByTestId("opponent-summary")).toContainText("最近对手");
      await expect(playerOnePage.getByTestId("opponent-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
      await expect(playerTwoPage.getByTestId("room-result-summary")).toContainText("权威房间状态已恢复");
      await expect(playerTwoPage.getByTestId("room-result-summary")).toContainText("当前结算已同步回写");

      await expect(playerOnePage.getByTestId("battle-empty")).toHaveText(/No active battle/);
      await expect(playerTwoPage.getByTestId("battle-empty")).toHaveText(/No active battle/);
      await expect(playerOnePage.getByTestId("hero-hp")).toHaveText(/HP 30\/30/);
      await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 1\/6/);
      await expect(playerTwoPage.getByTestId("hero-hp")).toHaveText(/HP 15\/30/);
      await expect(playerTwoPage.getByTestId("hero-move")).toHaveText(/Move 0\/6/);
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
