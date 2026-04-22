import { expect, test } from "@playwright/test";
import {
  dismissBattleModal,
  expectRecoveredBattleSettlement,
  expectHeroMoveSpent,
  fullMoveTextPattern,
  moveToAnyReachableTile,
  openRoom,
  pressTile,
  resetSmokeStore,
  reloadAndExpectRecoveredSession,
  resolveBattleToSettlement,
  buildRoomId,
  startDeterministicPvpBattle,
  withSmokeDiagnostics
} from "./smoke-helpers";

test("winner can recover immediately after PvP settlement while loser stays locked by zero movement", async ({ browser }, testInfo) => {
  await resetSmokeStore();
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
        await startDeterministicPvpBattle(playerOnePage, playerTwoPage);
        await resolveBattleToSettlement(playerOnePage, playerTwoPage);

        await expect(playerOnePage.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
        await expect(playerTwoPage.getByTestId("battle-modal-title")).toHaveText("战斗失败");
      });

      await test.step("gameplay: dismiss settlement and confirm world state before reconnect", async () => {
        await Promise.all([dismissBattleModal(playerOnePage), dismissBattleModal(playerTwoPage)]);
        await expectRecoveredBattleSettlement(playerOnePage, {
          phase: "已结算",
          recoverySummaryIncludes: ["结算与地图房间态已经重新对齐"],
          settlementSummary: "已击败",
          settlementRoomState: "房间已回到地图探索阶段",
          settlementNextAction: "仍可继续移动",
          hpPattern: /HP 30\/32/
        });
        await expectRecoveredBattleSettlement(playerTwoPage, {
          phase: "已结算",
          recoverySummaryIncludes: ["结算与地图房间态已经重新对齐"],
          settlementSummary: "PVP 失利",
          settlementRoomState: "对手仍保留在房间地图上",
          settlementNextAction: "已无法继续移动",
          hpPattern: /HP 15\/30/
        });
      });

      await test.step("reconnect: both clients reload immediately after settlement", async () => {
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
        hpPattern: /HP 15\/30/
      });

      await moveToAnyReachableTile(playerOnePage);

      await pressTile(playerTwoPage, 2, 5);
      await expectHeroMoveSpent(playerTwoPage, 6, "player-2");
      await expect(playerTwoPage.getByTestId("event-log")).toContainText("Action rejected:");
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
