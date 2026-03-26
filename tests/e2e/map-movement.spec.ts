import { expect, test, type Page } from "@playwright/test";

async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

async function hoverTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).hover();
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

test("hero can collect gold, recruit at the recruitment post, and spend resources correctly", async ({ page }) => {
  const roomId = `e2e-recruit-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("hero-army")).toHaveText(/x 12/, { timeout: 10_000 });
  await expect(page.getByTestId("stat-gold")).toHaveText(/Gold\s*0/);

  await pressTile(page, 0, 1);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 5\/6/);

  await pressTile(page, 0, 1);
  await expect(page.getByTestId("stat-gold")).toHaveText(/Gold\s*500/);
  await expect(page.getByTestId("event-log")).toContainText("Collected gold +500");

  await pressTile(page, 1, 3);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 2\/6/);

  await hoverTile(page, 1, 3);
  await expect(page.locator(".object-card-value")).toContainText("招募 4/4");

  await pressTile(page, 1, 3);
  await expect(page.getByTestId("hero-army")).toHaveText(/x 16/);
  await expect(page.getByTestId("stat-gold")).toHaveText(/Gold\s*260/);
  await expect(page.getByTestId("event-log")).toContainText("Recruited hero_guard_basic x4");

  await hoverTile(page, 1, 3);
  await expect(page.locator(".object-card-value")).toContainText("招募 0/4");
});

test("hero can visit the shrine and gain a permanent attribute bonus", async ({ page }) => {
  const roomId = `e2e-shrine-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("hero-stats")).toHaveText("ATK 2 · DEF 2 · POW 1 · KNW 1", { timeout: 10_000 });

  await pressTile(page, 3, 2);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 3\/6/);

  await pressTile(page, 3, 2);
  await expect(page.getByTestId("hero-stats")).toHaveText("ATK 3 · DEF 2 · POW 1 · KNW 1");
  await expect(page.getByTestId("event-log")).toContainText("Visited shrine-attack-1: 攻击 +1");

  await hoverTile(page, 3, 2);
  await expect(page.locator(".object-card-copy")).toContainText("已留下访问记录");
});

test("hero can claim a mine and receive income on successive days", async ({ page }) => {
  const roomId = `e2e-mine-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("stat-day")).toHaveText(/1/, { timeout: 10_000 });
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*0/);

  await pressTile(page, 3, 1);
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 4\/6/);

  await pressTile(page, 3, 1);
  await expect(page.getByTestId("event-log")).toContainText("Claimed mine: Wood +2/day");

  await hoverTile(page, 3, 1);
  await expect(page.locator(".object-card-copy")).toContainText("当前归属 player-1");

  await page.locator("[data-end-day]").click();
  await expect(page.getByTestId("stat-day")).toHaveText(/2/);
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*2/);
  await expect(page.getByTestId("event-log")).toContainText("Mine produced Wood +2");

  await page.locator("[data-end-day]").click();
  await expect(page.getByTestId("stat-day")).toHaveText(/3/);
  await expect(page.getByTestId("stat-wood")).toHaveText(/Wood\s*4/);
});
