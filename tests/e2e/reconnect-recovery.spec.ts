import { expect, test, type Page } from "@playwright/test";

const PLAYER_ID = "player-1";

async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

test("page reload restores the remote room session and preserves world state", async ({ page }) => {
  const roomId = `e2e-reconnect-${Date.now()}`;
  const storageKey = `project-veil:reconnection:${roomId}:${PLAYER_ID}`;

  await page.goto(`http://127.0.0.1:4173/?roomId=${roomId}&playerId=${PLAYER_ID}`);

  await expect(page.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);

  await pressTile(page, 0, 1);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 5\/6/);

  await pressTile(page, 0, 0);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 4\/6/);

  await pressTile(page, 0, 0);
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);

  await expect
    .poll(async () => page.evaluate((key) => window.sessionStorage.getItem(key), storageKey))
    .not.toBeNull();

  await page.reload();

  await expect(page.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(page.getByTestId("event-log")).toContainText("连接已恢复", { timeout: 10_000 });
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 4\/6/);
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);
});
