import { expect, test, type Page } from "@playwright/test";
import { expectHeroMoveSpent } from "./smoke-helpers";

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

  await expectHeroMoveSpent(playerOnePage, 0, "player-1");
  await expectHeroMoveSpent(playerTwoPage, 0, "player-2");

  await pressTile(playerOnePage, 3, 4);
  await expectHeroMoveSpent(playerOnePage, 5, "player-1");

  await pressTile(playerTwoPage, 3, 4);

  await expect(playerOnePage.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(playerTwoPage.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(playerOnePage.getByTestId("room-phase")).toHaveText("战斗中");
  await expect(playerTwoPage.getByTestId("room-phase")).toHaveText("战斗中");
  await expect(playerOnePage.getByTestId("room-status-detail")).toContainText("英雄遭遇战");
  await expect(playerOnePage.getByTestId("room-status-detail")).toContainText(`遭遇会话：${roomId}/battle-`);
  await expect(playerOnePage.getByTestId("encounter-source")).toContainText("我方英雄先手接触敌方英雄");
  await expect(playerOnePage.getByTestId("encounter-source")).toContainText("战斗会话 battle-");
  await expect(playerOnePage.getByTestId("encounter-source")).toHaveAttribute("data-tone", "action");
  await expect(playerTwoPage.getByTestId("opponent-summary")).toContainText("player-1");
  await expect(playerTwoPage.getByTestId("opponent-summary")).toContainText("房间态：战斗中");
  await expect(playerTwoPage.getByTestId("opponent-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
  await expect(playerTwoPage.getByTestId("opponent-summary")).toContainText("当前回合：我方操作");
  await expect(playerTwoPage.getByTestId("room-result-summary")).toContainText("多人遭遇战已接管地图行动");
  await expect(playerTwoPage.getByTestId("room-result-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
  await expect(playerTwoPage.getByTestId("room-next-action")).toContainText("等待本场对抗结算");
  await expect(playerTwoPage.getByTestId("room-next-action")).toHaveAttribute("data-tone", "action");
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
  await expect(playerOnePage.getByTestId("battle-settlement")).toContainText("战斗胜利");
  await expect(playerOnePage.getByTestId("battle-settlement-summary")).toContainText("已击败");
  await expect(playerOnePage.getByTestId("battle-settlement-room-state")).toContainText("房间已回到地图探索阶段");
  await expect(playerOnePage.getByTestId("battle-settlement-next-action")).toContainText("仍可继续移动");
  await expect(playerOnePage.getByTestId("room-phase")).toHaveText("已结算");
  await expect(playerOnePage.getByTestId("encounter-source")).toContainText("本场结果已结算并回写到房间地图");
  await expect(playerOnePage.getByTestId("encounter-source")).toHaveAttribute("data-tone", "victory");
  await expect(playerOnePage.getByTestId("room-result-summary")).toContainText("房间已回到地图探索阶段");
  await expect(playerOnePage.getByTestId("opponent-summary")).toContainText("最近对手");
  await expect(playerOnePage.getByTestId("opponent-summary")).toContainText(`遭遇会话：${roomId}/battle-`);
  await expect(playerOnePage.getByTestId("room-next-action")).toContainText("仍可继续移动");
  await expect(playerOnePage.getByTestId("room-next-action")).toHaveAttribute("data-tone", "victory");
  await expect(playerTwoPage.getByTestId("room-next-action")).toContainText("移动力已耗尽");
  await expect(playerTwoPage.getByTestId("battle-settlement-aftermath")).toContainText("移动力清零");
  await expect(playerTwoPage.getByTestId("battle-settlement-room-state")).toContainText("对手仍保留在房间地图上");
  await expect(playerTwoPage.getByTestId("hero-hp")).toHaveText(/HP 15\/30/);
  await expectHeroMoveSpent(playerTwoPage, 6, "player-2");

  await playerOneContext.close();
  await playerTwoContext.close();
});
