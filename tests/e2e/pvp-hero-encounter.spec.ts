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

test("two players can enter a hero-vs-hero battle and resolve it with correct turn ownership", async ({ browser }) => {
  const roomId = `e2e-pvp-${Date.now()}`;
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

  await expect(playerOnePage.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(playerTwoPage.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();
  await expect(playerOnePage.getByTestId("battle-actions")).toContainText("等待对手操作");

  await attackOnce(playerTwoPage);
  await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();
  await expect(playerTwoPage.getByTestId("battle-actions")).toContainText("等待对手操作");

  await attackOnce(playerOnePage);
  await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();

  await attackOnce(playerTwoPage);
  await expect(playerOnePage.getByTestId("battle-attack")).toBeVisible();

  await attackOnce(playerOnePage);
  await expect(playerTwoPage.getByTestId("battle-attack")).toBeVisible();

  await attackOnce(playerTwoPage);

  await expect(playerOnePage.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
  await expect(playerOnePage.getByTestId("battle-modal-body")).toContainText("你已击败敌方英雄");
  await expect(playerTwoPage.getByTestId("battle-modal-title")).toHaveText("战斗失败");
  await expect(playerTwoPage.getByTestId("hero-hp")).toHaveText(/HP 15\/30/);
  await expect(playerTwoPage.getByTestId("hero-move")).toHaveText(/Move 0\/6/);

  await playerOneContext.close();
  await playerTwoContext.close();
});
