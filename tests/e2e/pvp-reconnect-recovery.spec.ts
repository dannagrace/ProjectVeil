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

test("players can reload during a PvP battle and resume from the same turn state", async ({ browser }) => {
  const roomId = `e2e-pvp-reconnect-${Date.now()}`;
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

  await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();
  await expect(playerOnePage.getByTestId("battle-actions")).toContainText("等待对手操作");

  await playerTwoPage.reload();

  await expect(playerTwoPage.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(playerTwoPage.getByTestId("event-log")).toContainText("连接已恢复", { timeout: 10_000 });
  await expect(playerTwoPage.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();

  await attackOnce(playerTwoPage);
  await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();

  await playerOnePage.reload();

  await expect(playerOnePage.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(playerOnePage.getByTestId("event-log")).toContainText("连接已恢复", { timeout: 10_000 });
  await expect(playerOnePage.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();

  await attackOnce(playerOnePage);
  await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();

  await playerOneContext.close();
  await playerTwoContext.close();
});
