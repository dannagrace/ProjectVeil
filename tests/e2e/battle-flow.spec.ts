import { expect, test, type Page } from "./fixtures";
import { getHeroMoveTotal, getNeutralBattleReward, getNeutralBattleRewardText } from "./config-fixtures";
import { expectHeroMove, pressTile } from "./smoke-helpers";

async function attackUntilResolved(page: Page, maxAttacks = 6): Promise<void> {
  for (let index = 0; index < maxAttacks; index += 1) {
    const modalVisible = await page
      .getByTestId("battle-modal")
      .isVisible()
      .catch(() => false);
    if (modalVisible) {
      return;
    }

    await expect(page.getByTestId("battle-attack")).toBeVisible({ timeout: 10_000 });
    const logBeforeAttack = await page.getByTestId("battle-log").innerText();

    await page.getByTestId("battle-attack").click();

    await expect
      .poll(async () => page.getByTestId("battle-log").innerText(), {
        message: `battle log should change after attack ${index + 1}`
      })
      .not.toBe(logBeforeAttack);
  }
}

test("hero can clear a neutral battle and receive the reward", async ({ page }) => {
  const roomId = `e2e-battle-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expectHeroMove(page, getHeroMoveTotal());
  await expect(page.getByTestId("battle-empty")).toHaveText(/No active battle/);

  await pressTile(page, 5, 4);

  await expect(page.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(page.getByTestId("battle-attack")).toBeVisible();

  await attackUntilResolved(page);

  await expect(page.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
  await expect(page.getByTestId("battle-modal-body")).toContainText(getNeutralBattleRewardText());
  await expect(page.getByTestId("stat-gold")).toHaveText(new RegExp(`Gold\\s*${getNeutralBattleReward().amount}`));
});
