import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { pollForAnalyticsEvent } from "./analytics-helpers";
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

test("hero can clear a neutral battle and receive the reward", async ({ page, request }) => {
  const roomId = `e2e-battle-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expectHeroMove(page, getHeroMoveTotal());
  await expect(page.getByTestId("battle-empty")).toHaveText(/No active battle/);

  await pressTile(page, 3, 1);
  await expectHeroMove(page, getHeroMoveTotal() - 2);
  await pressTile(page, 5, 1);
  await expectHeroMove(page, getHeroMoveTotal() - 4);
  await pressTile(page, 5, 3);
  await expectHeroMove(page, getHeroMoveTotal() - 6);
  await pressTile(page, 5, 4);

  await expect(page.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(page.getByTestId("battle-attack")).toBeVisible();
  const battleStartEvent = await pollForAnalyticsEvent(
    request,
    "battle_start",
    (event) => event.roomId === roomId && event.payload.roomId === roomId && event.payload.encounterKind === "neutral"
  );
  expect(battleStartEvent.payload.roomId).toBe(roomId);
  expect(battleStartEvent.payload.battleId).toBeTruthy();

  await attackUntilResolved(page);

  await expect(page.getByTestId("battle-modal-title")).toHaveText("战斗胜利");
  await expect(page.getByTestId("battle-modal-body")).toContainText(getNeutralBattleRewardText());
  await expect(page.getByTestId("stat-gold")).toHaveText(new RegExp(`Gold\\s*${getNeutralBattleReward().amount}`));
  const battleEndEvent = await pollForAnalyticsEvent(
    request,
    "battle_end",
    (event) =>
      event.roomId === roomId &&
      event.payload.roomId === roomId &&
      event.payload.result === "attacker_victory" &&
      event.payload.battleKind === "neutral"
  );
  expect(battleEndEvent.payload.roomId).toBe(roomId);
  expect(battleEndEvent.payload.result).toBe("attacker_victory");
});
