import { expect, test, type Page } from "./fixtures";
import {
  getHeroMoveTotal,
  getMineClaimLogText,
  getMineIncome,
  getNeutralBattleReward,
  getNeutralBattleRewardText
} from "./config-fixtures";
import { expectHeroMove, expectHeroMoveSpent } from "./smoke-helpers";

interface AutomationState {
  keyboardCursor?: {
    x: number;
    y: number;
  } | null;
}

async function readAutomationState(page: Page): Promise<AutomationState> {
  const text = await page.evaluate(() => window.render_game_to_text?.() ?? "{}");
  return JSON.parse(text) as AutomationState;
}

async function pressKey(page: Page, key: string, count = 1): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press(key);
  }
}

async function attackUntilResolvedByKeyboard(page: Page, maxAttacks = 6): Promise<void> {
  for (let index = 0; index < maxAttacks; index += 1) {
    const modalVisible = await page
      .getByTestId("battle-modal")
      .isVisible()
      .catch(() => false);
    if (modalVisible) {
      return;
    }

    await expect(page.getByTestId("battle-attack")).toBeVisible({ timeout: 10_000 });
    const battleLogBeforeAttack = await page.getByTestId("battle-log").innerText();
    await page.keyboard.press("Space");

    await expect
      .poll(async () => {
        const modalVisible = await page
          .getByTestId("battle-modal")
          .isVisible()
          .catch(() => false);
        if (modalVisible) {
          return "resolved";
        }

        return page.getByTestId("battle-log").innerText();
      })
      .not.toBe(battleLogBeforeAttack);
  }
}

test("keyboard shortcuts can collect wood, claim a mine, and end the day", async ({ page }) => {
  const roomId = `e2e-keyboard-world-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expectHeroMove(page, getHeroMoveTotal());

  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 1, y: 1 });

  await pressKey(page, "ArrowLeft");
  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 0, y: 1 });
  await page.keyboard.press("Enter");
  await expectHeroMoveSpent(page, 1);

  await pressKey(page, "ArrowUp");
  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 0, y: 0 });
  await page.keyboard.press("Enter");
  await expectHeroMoveSpent(page, 2);

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);

  await pressKey(page, "ArrowRight", 3);
  await pressKey(page, "ArrowDown");
  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 3, y: 1 });

  await page.keyboard.press("Enter");
  await expectHeroMoveSpent(page, 6);

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("stat-wood")).toHaveText(new RegExp(`Wood\\s*${5 + getMineIncome()}`));
  await expect(page.getByTestId("event-log")).toContainText(getMineClaimLogText());

  await page.keyboard.press("b");
  await expect(page.getByTestId("stat-day")).toHaveText(/2/);
  await expectHeroMove(page, getHeroMoveTotal());

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("stat-wood")).toHaveText(new RegExp(`Wood\\s*${5 + getMineIncome() * 2}`));
});

test("keyboard shortcuts can enter battle, attack, and close the victory modal", async ({ page }) => {
  const roomId = `e2e-keyboard-battle-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expectHeroMove(page, getHeroMoveTotal());
  const goldBeforeBattle = Number((await page.getByTestId("stat-gold").innerText()).replace(/\D+/g, "")) || 0;

  await pressKey(page, "ArrowRight", 2);
  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 3, y: 1 });
  await page.keyboard.press("Enter");
  await expectHeroMoveSpent(page, 2);

  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 2, y: 2 });
  await page.keyboard.press("Enter");
  await expectHeroMoveSpent(page, 4);

  await pressKey(page, "ArrowRight", 2);
  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 4, y: 2 });
  await page.keyboard.press("Enter");
  await expectHeroMoveSpent(page, 6);

  await page.keyboard.press("b");
  await expect(page.getByTestId("stat-day")).toHaveText(/2/);
  await expectHeroMove(page, getHeroMoveTotal());

  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 5, y: 3 });
  await page.keyboard.press("Enter");
  await expectHeroMoveSpent(page, 2);

  await pressKey(page, "ArrowLeft");
  await expect.poll(async () => (await readAutomationState(page)).keyboardCursor).toEqual({ x: 4, y: 3 });
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("battle-attack")).toBeVisible();

  await attackUntilResolvedByKeyboard(page);

  await expect(page.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
  await expect(page.getByTestId("battle-modal-body")).toContainText(getNeutralBattleRewardText());
  await page.keyboard.press("Enter");

  await expect(page.getByTestId("battle-modal")).toBeHidden();
  await expect(page.getByTestId("stat-gold")).toHaveText(new RegExp(`Gold\\s*${goldBeforeBattle + getNeutralBattleReward().amount}`));
});
