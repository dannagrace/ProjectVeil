import { expect, test, type Page } from "@playwright/test";

async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

async function attackOnce(page: Page): Promise<void> {
  await expect(page.getByTestId("battle-attack")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("battle-attack").click();
}

test("players can reload after a PvP battle resolves and keep the settled world state", async ({ browser }) => {
  const roomId = `e2e-pvp-postbattle-${Date.now()}`;
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  await Promise.all([
    playerOnePage.goto(`http://127.0.0.1:4173/?roomId=${roomId}&playerId=player-1`),
    playerTwoPage.goto(`http://127.0.0.1:4173/?roomId=${roomId}&playerId=player-2`)
  ]);

  await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });
  await expect(playerTwoPage.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });

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

  await playerOnePage.reload();
  await playerTwoPage.reload();

  await expect(playerOnePage.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(playerTwoPage.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(playerOnePage.getByTestId("event-log")).toContainText("连接已恢复", { timeout: 10_000 });
  await expect(playerTwoPage.getByTestId("event-log")).toContainText("连接已恢复", { timeout: 10_000 });
  await expect(playerOnePage.getByTestId("room-phase")).toHaveText("已结算");
  await expect(playerTwoPage.getByTestId("room-phase")).toHaveText("已结算");
  await expect(playerOnePage.getByTestId("battle-settlement-summary")).toContainText("已击败");
  await expect(playerOnePage.getByTestId("battle-settlement-room-state")).toContainText("房间已回到地图探索阶段");
  await expect(playerOnePage.getByTestId("battle-settlement-next-action")).toContainText("仍可继续移动");
  await expect(playerTwoPage.getByTestId("battle-settlement-summary")).toContainText("遭遇战失利");
  await expect(playerTwoPage.getByTestId("battle-settlement-room-state")).toContainText("对手仍保留在房间地图上");
  await expect(playerTwoPage.getByTestId("battle-settlement-next-action")).toContainText("已无法继续移动");
  await expect(playerOnePage.getByTestId("opponent-summary")).toContainText("最近对手");
  await expect(playerTwoPage.getByTestId("room-result-summary")).toContainText("当前结算已同步回写");

  await expect(playerOnePage.getByTestId("battle-empty")).toHaveText(/No active battle/);
  await expect(playerTwoPage.getByTestId("battle-empty")).toHaveText(/No active battle/);
  await expect(playerOnePage.getByTestId("hero-hp")).toHaveText(/HP 30\/30/);
  await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 1\/6/);
  await expect(playerTwoPage.getByTestId("hero-hp")).toHaveText(/HP 15\/30/);
  await expect(playerTwoPage.getByTestId("hero-move")).toHaveText(/Move 0\/6/);

  await playerOneContext.close();
  await playerTwoContext.close();
});
