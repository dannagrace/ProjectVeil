import { expect, test, type Page } from "@playwright/test";

async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

test("hero can clear a neutral battle and receive the reward", async ({ page }) => {
  const roomId = `e2e-battle-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });
  await expect(page.getByTestId("battle-empty")).toHaveText(/No active battle/);

  await pressTile(page, 5, 4);

  await expect(page.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(page.getByTestId("battle-attack")).toBeVisible();

  const logBeforeAttack = await page.getByTestId("battle-log").innerText();

  await page.getByTestId("battle-attack").click();

  await expect
    .poll(async () => page.getByTestId("battle-log").innerText(), {
      message: "battle log should change after the player attacks"
    })
    .not.toBe(logBeforeAttack);

  await expect(page.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
  await expect(page.getByTestId("battle-modal-body")).toContainText("gold +300");
  await expect(page.getByTestId("stat-gold")).toHaveText(/Gold\s*300/);
});
