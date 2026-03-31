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

interface RuntimeHealthPayload {
  status?: string;
}

interface AuthReadinessPayload {
  status?: string;
}

interface LobbyRoomsPayload {
  rooms?: unknown[];
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

export function fullMoveTextPattern(playerId = "player-1"): RegExp | null {
  try {
    return moveTextPattern(getHeroMoveTotal(playerId), playerId);
  } catch {
    // If playerId not in config (e.g., test-injected cache), skip move text validation
    return null;
  }
}

export function moveRemainingAfterSpend(spent: number, playerId = "player-1"): number {
  return getHeroMoveTotal(playerId) - spent;
}

async function fetchJsonFromBrowser<T>(page: Page, path: string): Promise<T> {
  return await page.evaluate(async (requestPath) => {
    const response = await fetch(requestPath);
    if (!response.ok) {
      throw new Error(`browser_fetch_failed:${requestPath}:${response.status}`);
    }
    return (await response.json()) as T;
  }, path);
}

export async function waitForLobbyReady(page: Page): Promise<void> {
  await test.step("setup: wait for lobby smoke readiness", async () => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "大厅 / 登录入口" })).toBeVisible();
    await expect(page.getByText("活跃房间")).toBeVisible();
    await expect
      .poll(
        async () => (await fetchJsonFromBrowser<RuntimeHealthPayload>(page, "/api/runtime/health")).status ?? null,
        {
          message: "waiting for runtime health endpoint",
          timeout: 15_000
        }
      )
      .toBe("ok");
    await expect
      .poll(
        async () => (await fetchJsonFromBrowser<AuthReadinessPayload>(page, "/api/runtime/auth-readiness")).status ?? null,
        {
          message: "waiting for auth readiness endpoint",
          timeout: 15_000
        }
      )
      .toBe("ok");
    await expect
      .poll(
        async () => Array.isArray((await fetchJsonFromBrowser<LobbyRoomsPayload>(page, "/api/lobby/rooms")).rooms),
        {
          message: "waiting for lobby room listing",
          timeout: 15_000
        }
      )
      .toBe(true);
  });
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

export async function dismissBattleModal(page: Page): Promise<void> {
  await test.step("gameplay: dismiss settlement modal", async () => {
    await expect(page.getByTestId("battle-modal")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("battle-modal-close").click();
    await expect(page.getByTestId("battle-modal")).toBeHidden();
  });
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

export async function reloadAndExpectAuthoritativeConvergence(page: Page, options: ReconnectOptions): Promise<void> {
  await test.step(`reconnect: converge ${options.playerId} in ${options.roomId}`, async () => {
    await waitForReconnectionToken(page, options);
    await page.reload();
    await expectRoomReady(page, {
      ...options,
      expectedMoveText: options.expectedMoveText ?? null
    });
    await expect(page.getByTestId("event-log")).toContainText("已从本地缓存回放最近房间状态", { timeout: 10_000 });
    await expect(page.getByTestId("event-log")).toContainText("连接已恢复", { timeout: 10_000 });
    await expect(page.getByTestId("room-recovery-summary")).toContainText("权威房间状态已恢复");
    await expect(page.getByTestId("prediction-status")).toHaveCount(0);
  });
}

interface SettlementRecoveryExpectations {
  phase: string;
  recoverySummaryIncludes: string[];
  settlementSummary: string;
  settlementRoomState: string;
  settlementNextAction: string;
  hpPattern: RegExp;
  resultSummaryIncludes?: string[];
  opponentSummaryIncludes?: string[];
}

export async function expectRecoveredBattleSettlement(
  page: Page,
  expectations: SettlementRecoveryExpectations
): Promise<void> {
  await expect(page.getByTestId("room-phase")).toHaveText(expectations.phase);
  for (const summaryText of expectations.recoverySummaryIncludes) {
    await expect(page.getByTestId("room-recovery-summary")).toContainText(summaryText);
  }
  await expect(page.getByTestId("battle-settlement-summary")).toContainText(expectations.settlementSummary);
  await expect(page.getByTestId("battle-settlement-room-state")).toContainText(expectations.settlementRoomState);
  await expect(page.getByTestId("battle-settlement-next-action")).toContainText(expectations.settlementNextAction);
  if (expectations.resultSummaryIncludes) {
    for (const resultText of expectations.resultSummaryIncludes) {
      await expect(page.getByTestId("room-result-summary")).toContainText(resultText);
    }
  }
  if (expectations.opponentSummaryIncludes) {
    for (const opponentText of expectations.opponentSummaryIncludes) {
      await expect(page.getByTestId("opponent-summary")).toContainText(opponentText);
    }
  }
  await expect(page.getByTestId("battle-empty")).toHaveText(/No active battle/);
  await expect(page.getByTestId("hero-hp")).toHaveText(expectations.hpPattern);
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
