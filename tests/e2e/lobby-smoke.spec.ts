import { expect, test, type Page } from "./fixtures";
import {
  acceptLobbyPrivacyConsent,
  buildRoomId,
  expectRoomReady,
  fullMoveTextPattern,
  waitForLobbyReady,
  withSmokeDiagnostics
} from "./smoke-helpers";

async function expectEnteredRoom(page: Page, roomId: string, playerId?: string): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
  if (playerId) {
    await expectRoomReady(page, {
      roomId,
      playerId,
      expectedMoveText: fullMoveTextPattern()
    });
    return;
  }

  await expect(page.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
  await expect(page.getByTestId("diagnostic-panel")).toBeVisible();
  await expect(page.getByTestId("diagnostic-connection-status")).toHaveText("已连接");
  await expect(page.getByTestId("room-connection-summary")).toContainText("已连接");
  await expect(page.getByTestId("hero-move")).toHaveText(fullMoveTextPattern(), { timeout: 10_000 });
}

test("lobby opens and a guest can enter a room", async ({ page }, testInfo) => {
  const roomId = buildRoomId("e2e-lobby");

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await test.step("setup: open lobby shell", async () => {
      await waitForLobbyReady(page);
    });

    await page.locator("[data-lobby-room-id]").fill(roomId);
    await page.locator("[data-lobby-player-id]").fill("player-1");
    await page.locator("[data-lobby-display-name]").fill("Smoke Guest");
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-enter-room]").click();

    await expectEnteredRoom(page, roomId, "player-1");
    await expect(page.getByTestId("account-card")).toContainText("Smoke Guest");
  });
});

test("lobby reuses a cached guest session when entering a room", async ({ page }, testInfo) => {
  const roomId = buildRoomId("e2e-lobby-cached");

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

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await waitForLobbyReady(page);
    await expect(page.getByText("已缓存本地会话：cached-guest-1")).toBeVisible();
    await page.locator("[data-lobby-room-id]").fill(roomId);
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-enter-room]").click();

    await expectEnteredRoom(page, roomId, "cached-guest-1");
    await expect(page.getByTestId("account-card")).toContainText("Cached Guest");
  });
});

test("lobby supports formal registration and enters the room with an account session", async ({ page }, testInfo) => {
  const stamp = Date.now();
  const roomId = `e2e-lobby-register-${stamp}`;
  const loginId = `formal-ranger-${stamp}`;
  const displayName = "Formal Ranger";
  const password = "formal-pass-1";

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await waitForLobbyReady(page);
    await page.locator("[data-lobby-room-id]").fill(roomId);
    await page.locator("[data-lobby-login-id]").fill(loginId);
    await page.locator("[data-registration-display-name]").fill(displayName);
    await page.locator("[data-registration-password]").fill(password);
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-request-registration]").click();

    await expect(page.locator("[data-registration-token]")).toHaveValue(/\S+/, { timeout: 10_000 });
    await expect(page.locator(".account-status")).toContainText("注册令牌已生成");

    await page.locator("[data-confirm-registration]").click();

    await expectEnteredRoom(page, roomId);
    await expect(page.getByTestId("account-card")).toContainText(displayName);
    await expect(page.getByTestId("account-card")).toContainText(`已绑定登录 ID：${loginId}`);

    await expect
      .poll(async () =>
        page.evaluate(() => {
          const raw = window.localStorage.getItem("project-veil:auth-session");
          return raw ? (JSON.parse(raw) as { authMode?: string; loginId?: string; playerId?: string }) : null;
        })
      )
      .toMatchObject({
        authMode: "account",
        loginId
      });
  });
});

test("lobby supports password recovery and rotates the account password before entering the room", async ({
  page,
  request
}, testInfo) => {
  const stamp = Date.now();
  const roomId = `e2e-lobby-recovery-${stamp}`;
  const loginId = `recovery-ranger-${stamp}`;
  const displayName = "Recovery Ranger";
  const originalPassword = "recovery-old-1";
  const nextPassword = "recovery-new-1";

  const requestRegistrationResponse = await request.post("http://127.0.0.1:2567/api/auth/account-registration/request", {
    data: {
      loginId,
      displayName
    }
  });
  expect(requestRegistrationResponse.ok()).toBeTruthy();
  const requestRegistrationPayload = (await requestRegistrationResponse.json()) as { registrationToken?: string };
  expect(requestRegistrationPayload.registrationToken).toBeTruthy();

  const confirmRegistrationResponse = await request.post("http://127.0.0.1:2567/api/auth/account-registration/confirm", {
    data: {
      loginId,
      registrationToken: requestRegistrationPayload.registrationToken,
      password: originalPassword
    }
  });
  expect(confirmRegistrationResponse.ok()).toBeTruthy();

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await waitForLobbyReady(page);
    await page.locator("[data-lobby-room-id]").fill(roomId);
    await page.locator("[data-lobby-login-id]").fill(loginId);
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-request-recovery]").click();

    await expect(page.locator("[data-recovery-token]")).toHaveValue(/\S+/, { timeout: 10_000 });
    await expect(page.locator(".account-status")).toContainText("找回令牌已生成");

    await page.locator("[data-recovery-password]").fill(nextPassword);
    await page.locator("[data-confirm-recovery]").click();

    await expectEnteredRoom(page, roomId);
    await expect(page.getByTestId("account-card")).toContainText(displayName);
    await expect(page.getByTestId("account-card")).toContainText(`已绑定登录 ID：${loginId}`);

    const oldPasswordLoginResponse = await request.post("http://127.0.0.1:2567/api/auth/account-login", {
      data: {
        loginId,
        password: originalPassword
      }
    });
    expect(oldPasswordLoginResponse.status()).toBe(401);

    const newPasswordLoginResponse = await request.post("http://127.0.0.1:2567/api/auth/account-login", {
      data: {
        loginId,
        password: nextPassword
      }
    });
    expect(newPasswordLoginResponse.ok()).toBeTruthy();
  });
});
