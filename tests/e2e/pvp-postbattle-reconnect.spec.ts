import { expect, test } from "@playwright/test";
import {
  buildRoomId,
  expectRecoveredBattleSettlement,
  expectHeroMoveSpent,
  fullMoveTextPattern,
  openRoom,
  resetSmokeStore,
  reloadAndExpectRecoveredSession,
  resolveBattleToSettlement,
  startDeterministicPvpBattle,
  withSmokeDiagnostics
} from "./smoke-helpers";

test("players can reload during PvP settlement and recover the settled world state", async ({ browser }, testInfo) => {
  await resetSmokeStore();
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
            expectedMoveText: fullMoveTextPattern("player-1")
          }),
          openRoom(playerTwoPage, {
            roomId,
            playerId: "player-2",
            expectedMoveText: fullMoveTextPattern("player-2")
          })
        ]);
      });

      await test.step("gameplay: resolve the PvP battle to settlement", async () => {
        await startDeterministicPvpBattle(playerOnePage, playerTwoPage);
        await resolveBattleToSettlement(playerOnePage, playerTwoPage);

        await expect(playerOnePage.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
        await expect(playerTwoPage.getByTestId("battle-modal-title")).toHaveText("战斗失败");
      });

      await test.step("reconnect: both clients reload while settlement modal is still open", async () => {
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
      });

      await expectRecoveredBattleSettlement(playerOnePage, {
        phase: "已结算",
        recoverySummaryIncludes: ["权威房间状态已恢复", "战后结果与地图状态已经重新对齐"],
        settlementSummary: "已击败",
        settlementRoomState: "房间已回到地图探索阶段",
        settlementNextAction: "仍可继续移动",
        hpPattern: /HP 30\/32/
      });
      await expectRecoveredBattleSettlement(playerTwoPage, {
        phase: "已结算",
        recoverySummaryIncludes: ["权威房间状态已恢复"],
        settlementSummary: "PVP 失利",
        settlementRoomState: "对手仍保留在房间地图上",
        settlementNextAction: "已无法继续移动",
        hpPattern: /HP 15\/30/,
        resultSummaryIncludes: ["权威房间状态已恢复", "当前 PVP结算已同步回写"]
      });
      await expectHeroMoveSpent(playerOnePage, 3, "player-1");
      await expectHeroMoveSpent(playerTwoPage, 6, "player-2");
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
