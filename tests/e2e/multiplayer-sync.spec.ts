import { expect, test, type Page } from "@playwright/test";

async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

test("second player receives room push updates without leaking another player's move details", async ({ browser }) => {
  const roomId = `e2e-multi-${Date.now()}`;
  const playerOneContext = await browser.newContext();
  const playerTwoContext = await browser.newContext();
  const playerOnePage = await playerOneContext.newPage();
  const playerTwoPage = await playerTwoContext.newPage();

  await Promise.all([
    playerOnePage.goto(`http://127.0.0.1:4173/?roomId=${roomId}&playerId=player-1`),
    playerTwoPage.goto(`http://127.0.0.1:4173/?roomId=${roomId}&playerId=player-2`)
  ]);

  await expect(playerOnePage.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(playerTwoPage.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });
  await expect(playerTwoPage.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });

  await pressTile(playerOnePage, 0, 1);

  await expect(playerOnePage.getByTestId("hero-move")).toHaveText(/Move 5\/6/);
  await expect(playerTwoPage.getByTestId("event-log")).toContainText("收到房间同步推送", { timeout: 10_000 });
  await expect(playerTwoPage.getByTestId("event-log")).not.toContainText("Moved 1 steps");
  await expect(playerTwoPage.getByTestId("event-log")).not.toContainText("Path:");
  await expect(playerTwoPage.getByTestId("timeline-panel")).not.toContainText("英雄完成移动");
  await expect(playerTwoPage.getByTestId("hero-move")).toHaveText(/Move 6\/6/);

  await playerOneContext.close();
  await playerTwoContext.close();
});
