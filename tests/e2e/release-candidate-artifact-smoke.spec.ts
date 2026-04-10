import { expect, test, type Page } from "./fixtures";
import { acceptLobbyPrivacyConsent, buildRoomId, expectRoomReady, fullMoveTextPattern, withSmokeDiagnostics } from "./smoke-helpers";

async function expectEnteredRoom(page: Page, roomId: string, playerId: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
  await expectRoomReady(page, {
    roomId,
    playerId,
    expectedMoveText: fullMoveTextPattern(playerId),
    requireDiagnosticsPanel: false
  });
  await expect(page.getByTestId("event-log")).toContainText("会话已连接", { timeout: 10_000 });
}

test("rc-artifact: guest login reaches lobby and room boot", async ({ page }, testInfo) => {
  const roomId = buildRoomId("rc-artifact-guest");
  const playerId = "player-1";

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "大厅 / 登录入口" })).toBeVisible();
    await expect(page.getByText("活跃房间").first()).toBeVisible();

    await page.locator("[data-lobby-room-id]").fill(roomId);
    await page.locator("[data-lobby-player-id]").fill(playerId);
    await page.locator("[data-lobby-display-name]").fill("RC Smoke Guest");
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-enter-room]").click();

    await expectEnteredRoom(page, roomId, playerId);
    await expect(page.getByTestId("account-card")).toContainText("RC Smoke Guest");
  });
});

test("rc-artifact: cached session restore reaches room boot", async ({ page }, testInfo) => {
  const roomId = buildRoomId("rc-artifact-cached");
  const playerId = "cached-guest-1";

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "project-veil:auth-session",
      JSON.stringify({
        playerId: "cached-guest-1",
        displayName: "Cached RC Guest",
        authMode: "guest",
        source: "local"
      })
    );
  });

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await page.goto("/");

    await expect(page.getByText("已缓存本地会话：cached-guest-1")).toBeVisible();
    await page.locator("[data-lobby-room-id]").fill(roomId);
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-enter-room]").click();

    await expectEnteredRoom(page, roomId, playerId);
    await expect(page.getByTestId("account-card")).toContainText("Cached RC Guest");
  });
});
