import { test, expect } from './fixtures';
import { ADMIN_BASE_URL, ADMIN_TOKEN } from "./runtime-targets";
import { createSmokeGuestAuthSession, openAuthenticatedRoom } from "./smoke-helpers";

test('Admin Console 联动测试: 修改资源并验证实时同步', async ({ browser, request }) => {
  const playerContext = await browser.newContext();
  const adminContext = await browser.newContext();

  try {
    const playerPage = await playerContext.newPage();
    const roomId = `admin-sync-${Date.now()}`;
    const session = await createSmokeGuestAuthSession(request, "Sync E2E");
    await openAuthenticatedRoom(playerPage, {
      roomId,
      session,
      expectedMoveText: null
    });
    const goldDelta = 9999;

    const adminPage = await adminContext.newPage();
    await adminPage.goto(ADMIN_BASE_URL);
    await adminPage.fill("#adminSecret", ADMIN_TOKEN);
    await adminPage.fill("#targetPlayerId", session.playerId);
    await adminPage.fill("#modGold", String(goldDelta));
    await adminPage.fill("#modWood", "0");
    await adminPage.click("#modifyResourcesButton");

    const status = adminPage.locator("#status");
    await expect(status).toContainText("修改成功");
    await expect(status).toContainText(/当前 Gold: \d+/);
    const syncedGold = Number((await status.innerText()).match(/当前 Gold:\s*(\d+)/)?.[1] ?? "0");
    expect(syncedGold).toBeGreaterThanOrEqual(goldDelta);
    await expect(playerPage.getByTestId("stat-gold")).toHaveText(new RegExp(`Gold\\s*${syncedGold}`));
  } finally {
    await adminContext.close();
    await playerContext.close();
  }
});
