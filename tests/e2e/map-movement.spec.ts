import { expect, test, type Page } from "@playwright/test";

async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

test("hero can move onto the wood pile and collect it", async ({ page }) => {
  const roomId = `e2e-room-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);

  await pressTile(page, 0, 1);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 5\/6/);

  await pressTile(page, 0, 0);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 4\/6/);

  await pressTile(page, 0, 0);
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);
});
