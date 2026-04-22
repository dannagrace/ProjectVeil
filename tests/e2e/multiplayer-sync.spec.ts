import { expect, test, type Page } from "@playwright/test";
import {
  buildRoomId,
  expectHeroMoveSpent,
  followTilePath,
  fullMoveTextPattern,
  openRoom,
  pressTile,
  reloadAndExpectRecoveredSession,
  withSmokeDiagnostics
} from "./smoke-helpers";

async function hoverTile(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ nextX, nextY }) => {
      const tile = document.querySelector<HTMLElement>(`[data-x="${nextX}"][data-y="${nextY}"]`);
      if (!tile) {
        throw new Error(`tile_not_found:${nextX},${nextY}`);
      }
      tile.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    },
    { nextX: x, nextY: y }
  );
}

test("second player receives room push updates without leaking another player's move details", async ({ browser }, testInfo) => {
  const roomId = buildRoomId("e2e-multi");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      await test.step("setup: both players join the sync room", async () => {
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

      await pressTile(playerOnePage, 0, 1);

      await expectHeroMoveSpent(playerOnePage, 1, "player-1");
      await expect(playerTwoPage.getByTestId("event-log")).toContainText("收到房间同步推送", { timeout: 10_000 });
      await expect(playerTwoPage.getByTestId("room-connection-summary")).toContainText("已连接");
      await expect(playerTwoPage.getByTestId("event-log")).not.toContainText("Moved 1 steps");
      await expect(playerTwoPage.getByTestId("event-log")).not.toContainText("Path:");
      await expect(playerTwoPage.getByTestId("timeline-panel")).not.toContainText("英雄完成移动");
      await expectHeroMoveSpent(playerTwoPage, 0, "player-2");
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});

test("building ownership changes are pushed to other clients with the same visible state", async ({ browser }, testInfo) => {
  const roomId = buildRoomId("e2e-building-sync");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      await test.step("setup: both players join the ownership sync room", async () => {
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

      await followTilePath(
        playerTwoPage,
        [
          { x: 6, y: 4, spent: 2 },
          { x: 6, y: 2, spent: 4 },
          { x: 5, y: 1, spent: 6 }
        ],
        "player-2"
      );

      await hoverTile(playerTwoPage, 3, 1);
      await expect(playerTwoPage.locator(".object-card-copy")).toContainText("当前无人占领");

      await pressTile(playerOnePage, 3, 1);
      await expectHeroMoveSpent(playerOnePage, 2, "player-1");
      await pressTile(playerOnePage, 3, 1);

      await expect(playerTwoPage.getByTestId("event-log")).toContainText("收到房间同步推送", { timeout: 10_000 });
      await expect(playerTwoPage.getByTestId("room-connection-summary")).toContainText("已连接");

      await hoverTile(playerTwoPage, 3, 1);
      await expect(playerTwoPage.locator(".object-card-copy")).toContainText("当前归属 player-1");
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});

test("reloading a peer after ownership sync restores the claimed building state from the authority snapshot", async ({ browser }, testInfo) => {
  const roomId = buildRoomId("e2e-building-recovery");
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  try {
    await withSmokeDiagnostics(testInfo, [playerOnePage, playerTwoPage], async () => {
      await test.step("setup: both players join the ownership recovery room", async () => {
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

      await followTilePath(
        playerTwoPage,
        [
          { x: 6, y: 4, spent: 2 },
          { x: 6, y: 2, spent: 4 },
          { x: 5, y: 1, spent: 6 }
        ],
        "player-2"
      );
      await pressTile(playerOnePage, 3, 1);
      await expectHeroMoveSpent(playerOnePage, 2, "player-1");
      await pressTile(playerOnePage, 3, 1);

      await expect(playerTwoPage.getByTestId("event-log")).toContainText("收到房间同步推送", { timeout: 10_000 });
      await hoverTile(playerTwoPage, 3, 1);
      await expect(playerTwoPage.locator(".object-card-copy")).toContainText("当前归属 player-1");

      await reloadAndExpectRecoveredSession(playerTwoPage, {
        roomId,
        playerId: "player-2",
        expectedMoveText: null
      });

      await hoverTile(playerTwoPage, 3, 1);
      await expect(playerTwoPage.locator(".object-card-copy")).toContainText("当前归属 player-1");
      await expectHeroMoveSpent(playerTwoPage, 6, "player-2");
    });
  } finally {
    await playerOneContext.close();
    await playerTwoContext.close();
  }
});
