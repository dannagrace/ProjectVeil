import { expect, test } from "@playwright/test";

test("lobby opens and a guest can enter a room", async ({ page }) => {
  const roomId = `e2e-lobby-${Date.now()}`;

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "大厅 / 登录入口" })).toBeVisible();
  await expect(page.getByText("活跃房间")).toBeVisible();

  await page.locator("[data-lobby-room-id]").fill(roomId);
  await page.locator("[data-lobby-player-id]").fill("player-1");
  await page.locator("[data-lobby-display-name]").fill("Smoke Guest");
  await page.locator("[data-enter-room]").click();

  await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
  await expect(page.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(page.getByTestId("account-card")).toContainText("Smoke Guest");
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });
});

test("lobby reuses a cached guest session when entering a room", async ({ page }) => {
  const roomId = `e2e-lobby-cached-${Date.now()}`;

  await page.addInitScript(() => {
    window.localStorage.setItem(
      "project-veil:auth-session",
      JSON.stringify({
        playerId: "cached-guest-1",
        displayName: "Cached Guest",
        authMode: "guest",
        source: "local"
      })
    );
  });

  await page.goto("/");

  await expect(page.getByText("已缓存本地会话：cached-guest-1")).toBeVisible();
  await page.locator("[data-lobby-room-id]").fill(roomId);
  await page.locator("[data-enter-room]").click();

  await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
  await expect(page.getByTestId("session-meta")).toContainText("Player: cached-guest-1");
  await expect(page.getByTestId("account-card")).toContainText("Cached Guest");
  await expect(page.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });
});
