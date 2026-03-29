import { expect, test, type Page } from "@playwright/test";
import {
  formatHeroStatsText,
  getHeroArmyCount,
  getHeroMoveTotal,
  getHeroStats,
  getHeroStatsAfterShrine,
  getMineClaimLogText,
  getMineIncome,
  getRecruitmentCost,
  getRecruitmentCount,
  getRecruitmentLogText,
  getShrineVisitLogText
} from "./config-fixtures";
import { expectHeroMove, expectHeroMoveSpent } from "./smoke-helpers";

async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

async function endDay(page: Page, day: number): Promise<void> {
  await page.locator("[data-end-day]").click();
  await expect(page.getByTestId("stat-day")).toHaveText(new RegExp(`${day}`));
  await expectHeroMove(page, getHeroMoveTotal());
}

test("hero can move onto the wood pile and collect it", async ({ page }) => {
  const roomId = `e2e-room-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expectHeroMove(page, getHeroMoveTotal());
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);

  await pressTile(page, 0, 1);
  await expectHeroMoveSpent(page, 1);

  await pressTile(page, 0, 0);
  await expectHeroMoveSpent(page, 2);

  await pressTile(page, 0, 0);
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*5/);
});

test("hero can collect gold, recruit at the recruitment post, and spend resources correctly", async ({ page }) => {
  const roomId = `e2e-recruit-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("stat-day")).toHaveText(/1/, { timeout: 10_000 });
  await expect(page.getByTestId("hero-army")).toHaveText(new RegExp(`x ${getHeroArmyCount()}`), { timeout: 10_000 });
  await expect(page.getByTestId("stat-gold")).toHaveText(/Gold\s*0/);

  await pressTile(page, 1, 3);
  await expectHeroMoveSpent(page, 2);

  await pressTile(page, 0, 4);
  await expectHeroMoveSpent(page, 4);

  await pressTile(page, 0, 5);
  await expectHeroMoveSpent(page, 5);

  await pressTile(page, 0, 6);
  await expectHeroMoveSpent(page, 6);

  await endDay(page, 2);

  await pressTile(page, 0, 7);
  await expectHeroMoveSpent(page, 1);

  await pressTile(page, 0, 7);
  await expect(page.getByTestId("stat-gold")).toHaveText(/Gold\s*500/);
  await expect(page.getByTestId("event-log")).toContainText("Collected gold +500");

  await pressTile(page, 1, 3);
  await expectHeroMoveSpent(page, 6);

  await pressTile(page, 1, 3);
  await expect(page.getByTestId("hero-army")).toHaveText(new RegExp(`x ${getHeroArmyCount() + getRecruitmentCount()}`));
  await expect(page.getByTestId("stat-gold")).toHaveText(new RegExp(`Gold\\s*${500 - getRecruitmentCost().gold}`));
  await expect(page.getByTestId("event-log")).toContainText(getRecruitmentLogText());
});

test("hero can visit the shrine and gain a permanent attribute bonus", async ({ page }) => {
  const roomId = `e2e-shrine-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("hero-stats")).toHaveText(formatHeroStatsText(getHeroStats()), { timeout: 10_000 });

  await pressTile(page, 3, 2);
  await expectHeroMoveSpent(page, 3);

  await pressTile(page, 3, 2);
  await expect(page.getByTestId("hero-stats")).toHaveText(formatHeroStatsText(getHeroStatsAfterShrine()));
  await expect(page.getByTestId("event-log")).toContainText(getShrineVisitLogText());
});

test("hero can claim a mine for an immediate reward and claim it again on a later day", async ({ page }) => {
  const roomId = `e2e-mine-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("stat-day")).toHaveText(/1/, { timeout: 10_000 });
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);

  await pressTile(page, 3, 1);
  await expectHeroMoveSpent(page, 2);

  await pressTile(page, 3, 1);
  await expect(page.getByTestId("stat-wood")).toHaveText(new RegExp(`Wood\\s*${getMineIncome()}`));
  await expect(page.getByTestId("event-log")).toContainText(getMineClaimLogText());

  await endDay(page, 2);
  await expect(page.getByTestId("stat-wood")).toHaveText(new RegExp(`Wood\\s*${getMineIncome()}`));

  await pressTile(page, 3, 1);
  await expect(page.getByTestId("stat-wood")).toHaveText(new RegExp(`Wood\\s*${getMineIncome() * 2}`));
  await expect(page.getByTestId("event-log")).toContainText(getMineClaimLogText());

  await endDay(page, 3);
  await expect(page.getByTestId("stat-wood")).toHaveText(new RegExp(`Wood\\s*${getMineIncome() * 2}`));
});
