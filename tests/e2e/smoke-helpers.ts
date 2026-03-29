import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { getHeroMoveTotal } from "./config-fixtures";

const CLIENT_BASE_URL = "http://127.0.0.1:4173";
const SERVER_DIAGNOSTICS_URL = "http://127.0.0.1:2567/api/runtime/diagnostic-snapshot?format=text";

interface RoomSessionOptions {
  roomId: string;
  playerId: string;
  expectedMoveText?: RegExp | null;
}

interface ReconnectOptions extends RoomSessionOptions {
  storage?: "sessionStorage" | "localStorage";
}

function encodeRoomQuery(roomId: string, playerId: string): string {
  return `${CLIENT_BASE_URL}/?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`;
}

export function buildRoomId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

export function moveTextPattern(remaining: number, playerId = "player-1"): RegExp {
  return new RegExp(`^Move\\s*${remaining}\\/${getHeroMoveTotal(playerId)}$`);
}

export function fullMoveTextPattern(playerId = "player-1"): RegExp {
  return moveTextPattern(getHeroMoveTotal(playerId), playerId);
}

export function moveRemainingAfterSpend(spent: number, playerId = "player-1"): number {
  return getHeroMoveTotal(playerId) - spent;
}

export async function expectHeroMove(page: Page, remaining: number, playerId = "player-1"): Promise<void> {
  await expect(page.getByTestId("hero-move")).toHaveText(moveTextPattern(remaining, playerId), { timeout: 10_000 });
}

export async function expectHeroMoveSpent(page: Page, spent: number, playerId = "player-1"): Promise<void> {
  await expectHeroMove(page, moveRemainingAfterSpend(spent, playerId), playerId);
}

export async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

export async function attackOnce(page: Page): Promise<void> {
  await expect(page.getByTestId("battle-attack")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("battle-attack").click();
}

export async function openRoom(page: Page, options: RoomSessionOptions): Promise<void> {
  await test.step(`setup: open ${options.playerId} in ${options.roomId}`, async () => {
    await page.goto(encodeRoomQuery(options.roomId, options.playerId));
    await expectRoomReady(page, options);
  });
}

export async function expectRoomReady(page: Page, options: RoomSessionOptions): Promise<void> {
  await expect(page.getByTestId("session-meta")).toContainText(`Room: ${options.roomId}`);
  await expect(page.getByTestId("session-meta")).toContainText(`Player: ${options.playerId}`);
  await expect(page.getByTestId("diagnostic-panel")).toBeVisible();
  await expect(page.getByTestId("diagnostic-connection-status")).toHaveText("已连接");
  await expect(page.getByTestId("room-connection-summary")).toContainText("已连接");
  if (options.expectedMoveText) {
    await expect(page.getByTestId("hero-move")).toHaveText(options.expectedMoveText, { timeout: 10_000 });
  }
}

export async function waitForReconnectionToken(page: Page, options: ReconnectOptions): Promise<void> {
  const storageKey = `project-veil:reconnection:${options.roomId}:${options.playerId}`;
  const storageAccessor = options.storage ?? "sessionStorage";

  await test.step(`setup: persist reconnect token for ${options.playerId}`, async () => {
    await expect
      .poll(
        async () =>
          page.evaluate(
            ({ key, storageAccessor }) => window[storageAccessor].getItem(key),
            { key: storageKey, storageAccessor }
          ),
        {
          message: `waiting for reconnect token ${storageKey}`
        }
      )
      .not.toBeNull();
  });
}

export async function reloadAndExpectRecoveredSession(page: Page, options: ReconnectOptions): Promise<void> {
  await test.step(`reconnect: reload ${options.playerId} in ${options.roomId}`, async () => {
    await waitForReconnectionToken(page, options);
    await page.reload();
    await expectRoomReady(page, {
      ...options,
      expectedMoveText: options.expectedMoveText ?? null
    });
    await expect(page.getByTestId("event-log")).toContainText("连接已恢复", { timeout: 10_000 });
    await expect(page.getByTestId("room-recovery-summary")).toContainText("已恢复");
  });
}

async function attachText(testInfo: TestInfo, name: string, body: string | null): Promise<void> {
  if (!body) {
    return;
  }

  await testInfo.attach(name, {
    body: Buffer.from(body, "utf8"),
    contentType: "text/plain"
  });
}

async function attachJson(testInfo: TestInfo, name: string, body: string | null): Promise<void> {
  if (!body) {
    return;
  }

  await testInfo.attach(name, {
    body: Buffer.from(body, "utf8"),
    contentType: "application/json"
  });
}

async function readPageText(page: Page, selector: string): Promise<string | null> {
  try {
    const locator = page.locator(selector);
    if (!(await locator.count())) {
      return null;
    }
    return await locator.innerText();
  } catch {
    return null;
  }
}

async function attachPageDiagnostics(testInfo: TestInfo, page: Page, label: string): Promise<void> {
  await attachText(testInfo, `${label}-url.txt`, page.url() || null);
  await attachText(testInfo, `${label}-session-meta.txt`, await readPageText(page, '[data-testid="session-meta"]'));
  await attachText(testInfo, `${label}-event-log.txt`, await readPageText(page, '[data-testid="event-log"]'));
  await attachText(
    testInfo,
    `${label}-room-connection-summary.txt`,
    await readPageText(page, '[data-testid="room-connection-summary"]')
  );
  await attachText(
    testInfo,
    `${label}-diagnostic-summary.txt`,
    await page.evaluate(() => window.render_diagnostic_snapshot_to_text?.() ?? null).catch(() => null)
  );
  await attachJson(
    testInfo,
    `${label}-diagnostic-snapshot.json`,
    await page.evaluate(() => window.export_diagnostic_snapshot?.() ?? null).catch(() => null)
  );
  await attachJson(
    testInfo,
    `${label}-automation-state.json`,
    await page.evaluate(() => window.render_game_to_text?.() ?? null).catch(() => null)
  );
}

async function attachServerDiagnostics(testInfo: TestInfo): Promise<void> {
  try {
    const response = await fetch(SERVER_DIAGNOSTICS_URL);
    if (!response.ok) {
      await attachText(testInfo, "server-diagnostics-error.txt", `HTTP ${response.status}`);
      return;
    }
    await attachText(testInfo, "server-diagnostics.txt", await response.text());
  } catch (error) {
    await attachText(
      testInfo,
      "server-diagnostics-error.txt",
      error instanceof Error ? error.stack ?? error.message : String(error)
    );
  }
}

export async function withSmokeDiagnostics<T>(
  testInfo: TestInfo,
  pages: Page[],
  callback: () => Promise<T>
): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    await attachServerDiagnostics(testInfo);
    for (const [index, page] of pages.entries()) {
      await attachPageDiagnostics(testInfo, page, `page-${index + 1}`);
    }
    throw error;
  }
}
