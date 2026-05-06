import { expect, test, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { getHeroMoveTotal } from "./config-fixtures";
import { ADMIN_TOKEN, CLIENT_BASE_URL, RESET_ENDPOINT, SERVER_BASE_URL, SERVER_DIAGNOSTICS_URL } from "./runtime-targets";

interface RoomSessionOptions {
  roomId: string;
  playerId: string;
  expectedMoveText?: RegExp | null;
  requireDiagnosticsPanel?: boolean;
}

interface ReconnectOptions extends RoomSessionOptions {
  storage?: "sessionStorage" | "localStorage";
}

interface RuntimeHealthPayload {
  status?: string;
  runtime?: {
    persistence?: {
      status?: string;
      storage?: string;
    };
  };
}

interface AuthReadinessPayload {
  status?: string;
}

interface LobbyRoomsPayload {
  items?: unknown[];
}

interface GuestLoginPayload {
  session?: {
    token?: string;
    refreshToken?: string;
    playerId?: string;
    displayName?: string;
    authMode?: "guest" | "account";
    loginId?: string;
    sessionId?: string;
    expiresAt?: string;
    refreshExpiresAt?: string;
  };
}

export interface SmokeGuestAuthSession {
  playerId: string;
  displayName: string;
  authMode: "guest";
  source: "remote";
  token: string;
  refreshToken?: string;
  loginId?: string;
  sessionId?: string;
  expiresAt?: string;
  refreshExpiresAt?: string;
}

export interface StoredAuthSessionSnippet {
  authMode?: string;
  displayName?: string;
  loginId?: string;
  playerId?: string;
  source?: string;
  token?: string;
}

interface AutomationStateHeroLike {
  id?: string;
  playerId?: string;
  x: number;
  y: number;
  move?: {
    total: number;
    remaining: number;
  };
}

interface AutomationStateRoomLike {
  playerId?: string;
}

interface AutomationStateLike {
  room?: AutomationStateRoomLike;
  hero?: AutomationStateHeroLike | null;
  ownHeroes?: AutomationStateHeroLike[];
  visibleHeroes?: AutomationStateHeroLike[];
}

export interface AuthenticatedRoomSession {
  page: Page;
  session: SmokeGuestAuthSession;
  requestedPlayerId: string;
  playerId: string;
  hero: AutomationStateHeroLike & {
    move: {
      total: number;
      remaining: number;
    };
  };
}

export interface AuthenticatedMultiplayerRoomPair {
  playerOne: AuthenticatedRoomSession;
  playerTwo: AuthenticatedRoomSession;
}

function encodeRoomQuery(roomId: string, playerId: string): string {
  return `${CLIENT_BASE_URL}/?roomId=${encodeURIComponent(roomId)}&playerId=${encodeURIComponent(playerId)}`;
}

export function buildRoomId(prefix: string): string {
  return `${prefix}-${Date.now()}`;
}

export async function resetSmokeStore(): Promise<void> {
  const response = await fetch(RESET_ENDPOINT, {
    method: "POST",
    headers: getAdminHeaders()
  });
  if (!response.ok) {
    throw new Error(`reset_store_failed:${response.status}`);
  }
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

function getAdminHeaders(): Record<string, string> {
  return {
    "x-veil-admin-token": ADMIN_TOKEN
  };
}

async function fetchJsonFromBrowser<T>(
  page: Page,
  path: string,
  headers: Record<string, string> = getAdminHeaders()
): Promise<T> {
  return await page.evaluate(async ({ requestPath, requestHeaders }) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(requestPath, {
        headers: requestHeaders
      });
      if (response.ok) {
        return (await response.json()) as T;
      }
      if (response.status === 429 && attempt < 4) {
        const retryAfterSeconds = Math.max(1, Number(response.headers.get("Retry-After") ?? "1"));
        await new Promise((resolve) => window.setTimeout(resolve, retryAfterSeconds * 1000));
        continue;
      }
      throw new Error(`browser_fetch_failed:${requestPath}:${response.status}`);
    }
    throw new Error(`browser_fetch_failed:${requestPath}:unreachable`);
  }, { requestPath: path, requestHeaders: headers });
}

export async function readStoredAuthSession(page: Page): Promise<StoredAuthSessionSnippet | null> {
  return await page.evaluate(() => {
    const raw = window.localStorage.getItem("project-veil:auth-session");
    return raw ? (JSON.parse(raw) as StoredAuthSessionSnippet) : null;
  });
}

export async function waitForStoredAuthSession(
  page: Page,
  expected: Partial<StoredAuthSessionSnippet>
): Promise<StoredAuthSessionSnippet> {
  await expect.poll(async () => readStoredAuthSession(page)).toMatchObject(expected);
  const session = await readStoredAuthSession(page);
  expect(session?.playerId).toBeTruthy();
  return session!;
}

export async function createLobbyReadinessAuthHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(async () => {
    const response = await fetch("/api/auth/guest-login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        displayName: "Smoke Readiness Probe",
        privacyConsentAccepted: true
      })
    });
    if (!response.ok) {
      throw new Error(`readiness_guest_login_failed:${response.status}`);
    }

    const payload = (await response.json()) as GuestLoginPayload;
    const sessionToken = payload.session?.token;
    if (!sessionToken) {
      throw new Error("readiness_guest_login_missing_token");
    }
    return sessionToken;
  });

  return {
    Authorization: `Bearer ${token}`
  };
}

export async function waitForLobbyReady(page: Page): Promise<Record<string, string>> {
  return await test.step("setup: wait for lobby smoke readiness", async () => {
    // Reset the server's in-memory store before entering lobby
    // The fixture also resets server-side, but this ensures the browser
    // context is fresh after being reused across tests
    await page.evaluate(async (adminToken) => {
      const adminHeaders = {
        "x-veil-admin-token": adminToken
      };
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          const response = await fetch("/api/test/reset-store", { method: "POST", headers: adminHeaders });
          if (response.ok || response.status !== 429 || attempt === 4) {
            return;
          }
          const retryAfterSeconds = Math.max(1, Number(response.headers.get("Retry-After") ?? "1"));
          await new Promise((resolve) => window.setTimeout(resolve, retryAfterSeconds * 1000));
        } catch {
          return;
        }
      }
      try {
        await fetch("/api/test/reset-store", { method: "POST", headers: adminHeaders });
      } catch {
        // Ignore errors if endpoint not available
      }
    }, ADMIN_TOKEN);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "大厅 / 登录入口" })).toBeVisible();
    await expect(page.getByText("活跃房间").first()).toBeVisible();
    const lobbyReadinessHeaders = await createLobbyReadinessAuthHeaders(page);
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const response = await fetch("/api/runtime/health");
            const payload = (await response.json()) as RuntimeHealthPayload;
            return (
              (response.status >= 200 && response.status < 300 && payload.status === "ok")
              || (response.status === 503
                && payload.status === "warn"
                && payload.runtime?.persistence?.status === "degraded"
                && payload.runtime?.persistence?.storage === "memory")
            );
          }),
        {
          message: "waiting for runtime health endpoint",
          timeout: 15_000
        }
      )
      .toBe(true);
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
        async () =>
          Array.isArray((await fetchJsonFromBrowser<LobbyRoomsPayload>(page, "/api/lobby/rooms", lobbyReadinessHeaders)).items),
        {
          message: "waiting for lobby room listing",
          timeout: 15_000
        }
      )
      .toBe(true);

    return lobbyReadinessHeaders;
  });
}

export async function createSmokeGuestAuthSession(
  request: APIRequestContext,
  displayName: string
): Promise<SmokeGuestAuthSession> {
  const response = await request.post(`${SERVER_BASE_URL}/api/auth/guest-login`, {
    data: {
      displayName,
      privacyConsentAccepted: true
    }
  });
  expect(response.status()).toBe(200);

  const payload = (await response.json()) as GuestLoginPayload;
  const session = payload.session;
  const playerId = session?.playerId?.trim();
  const token = session?.token?.trim();
  if (!playerId || !token) {
    throw new Error("guest_auth_session_missing_identity");
  }

  return {
    playerId,
    displayName: session?.displayName?.trim() || displayName,
    authMode: "guest",
    source: "remote",
    token,
    ...(session?.refreshToken?.trim() ? { refreshToken: session.refreshToken.trim() } : {}),
    ...(session?.loginId?.trim() ? { loginId: session.loginId.trim() } : {}),
    ...(session?.sessionId?.trim() ? { sessionId: session.sessionId.trim() } : {}),
    ...(session?.expiresAt?.trim() ? { expiresAt: session.expiresAt.trim() } : {}),
    ...(session?.refreshExpiresAt?.trim() ? { refreshExpiresAt: session.refreshExpiresAt.trim() } : {})
  };
}

export async function seedStoredAuthSession(page: Page, session: SmokeGuestAuthSession): Promise<void> {
  await page.addInitScript((authSession) => {
    const storageKey = "project-veil:auth-session";
    const existingRaw = window.localStorage.getItem(storageKey);
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as { playerId?: unknown; token?: unknown };
        if (existing.playerId === authSession.playerId && typeof existing.token === "string" && existing.token.trim()) {
          return;
        }
      } catch {
        // Fall through and replace malformed auth state.
      }
    }
    window.localStorage.setItem(storageKey, JSON.stringify(authSession));
  }, session);
}

export async function acceptLobbyPrivacyConsent(page: Page): Promise<void> {
  await test.step("setup: accept lobby privacy consent", async () => {
    const consentCheckbox = page.locator("[data-privacy-consent]").first();
    await expect(consentCheckbox).toBeVisible();
    if (!(await consentCheckbox.isChecked())) {
      await consentCheckbox.check();
    }
  });
}

export async function expectHeroMove(page: Page, remaining: number, playerId = "player-1"): Promise<void> {
  await expect(page.getByTestId("hero-move")).toHaveText(moveTextPattern(remaining, playerId), { timeout: 10_000 });
}

export async function expectHeroMoveSpent(page: Page, spent: number, playerId = "player-1"): Promise<void> {
  await expectHeroMove(page, moveRemainingAfterSpend(spent, playerId), playerId);
}

export async function expectHeroMoveSpentForSession(page: Page, spent: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const move = (await readAutomationState(page)).hero?.move;
        return move ? move.total - move.remaining : null;
      },
      {
        message: `waiting for active hero to spend ${spent} move`
      }
    )
    .toBe(spent);
}

export async function pressTile(page: Page, x: number, y: number): Promise<void> {
  await page.locator(`[data-x="${x}"][data-y="${y}"]`).dispatchEvent("pointerdown", {
    button: 0
  });
}

export async function moveToAnyReachableTile(page: Page): Promise<{ x: number; y: number }> {
  const target = await page.evaluate(() => {
    const reachableTiles = Array.from(document.querySelectorAll<HTMLButtonElement>(".tile.is-reachable"))
      .filter((tile) => !tile.classList.contains("is-hero"))
      .map((tile) => ({
        x: Number(tile.dataset.x ?? Number.NaN),
        y: Number(tile.dataset.y ?? Number.NaN)
      }))
      .filter((tile) => Number.isFinite(tile.x) && Number.isFinite(tile.y));

    reachableTiles.sort((left, right) => {
      if (left.y !== right.y) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });

    return reachableTiles[0] ?? null;
  });

  if (!target) {
    throw new Error("reachable_tile_missing");
  }

  const previousMoveText = await page.getByTestId("hero-move").innerText();
  await pressTile(page, target.x, target.y);
  await expect(page.getByTestId("hero-move")).not.toHaveText(previousMoveText, { timeout: 10_000 });
  return target;
}

export async function followTilePath(
  page: Page,
  path: ReadonlyArray<{ x: number; y: number; spent?: number }>,
  playerId = "player-1"
): Promise<void> {
  for (const step of path) {
    await pressTile(page, step.x, step.y);
    if (typeof step.spent === "number") {
      await expectHeroMoveSpent(page, step.spent, playerId);
    }
  }
}

export async function followTilePathForSession(
  page: Page,
  path: ReadonlyArray<{ x: number; y: number; spent?: number }>
): Promise<void> {
  for (const step of path) {
    await pressTile(page, step.x, step.y);
    if (typeof step.spent === "number") {
      await expectHeroMoveSpentForSession(page, step.spent);
    }
  }
}

export async function readAutomationState(page: Page): Promise<AutomationStateLike> {
  const text = await page.evaluate(() => window.render_game_to_text?.() ?? "{}");
  return JSON.parse(text) as AutomationStateLike;
}

export async function waitForCurrentRoomSession(
  page: Page,
  expectedPlayerId?: string
): Promise<AuthenticatedRoomSession["hero"]> {
  const readyValue = "__ready__";
  await expect
    .poll(
      async () => {
        const state = await readAutomationState(page);
        if (!state.room?.playerId || !state.hero?.move) {
          return null;
        }
        if (expectedPlayerId && state.room.playerId !== expectedPlayerId) {
          return `unexpected:${state.room.playerId}`;
        }
        return expectedPlayerId ?? readyValue;
      },
      {
        message: expectedPlayerId
          ? `waiting for authoritative player ${expectedPlayerId}`
          : "waiting for authoritative room session"
      }
    )
    .toBe(expectedPlayerId ?? readyValue);

  const state = await readAutomationState(page);
  const hero = state.hero;
  if (!hero?.move) {
    throw new Error("current_room_session_missing_active_hero");
  }
  return {
    ...hero,
    move: hero.move
  };
}

export async function openAuthenticatedRoom(
  page: Page,
  options: {
    roomId: string;
    session: SmokeGuestAuthSession;
    expectedMoveText?: RegExp | null;
    requireDiagnosticsPanel?: boolean;
  }
): Promise<AuthenticatedRoomSession> {
  return await test.step(`setup: open ${options.session.playerId} in ${options.roomId}`, async () => {
    await seedStoredAuthSession(page, options.session);
    await page.goto(`${CLIENT_BASE_URL}/?roomId=${encodeURIComponent(options.roomId)}`);
    await expectRoomReady(page, {
      roomId: options.roomId,
      playerId: options.session.playerId,
      expectedMoveText: options.expectedMoveText ?? null,
      requireDiagnosticsPanel: options.requireDiagnosticsPanel
    });
    const hero = await waitForCurrentRoomSession(page, options.session.playerId);
    return {
      page,
      session: options.session,
      requestedPlayerId: options.session.playerId,
      playerId: options.session.playerId,
      hero
    };
  });
}

export async function openAuthenticatedMultiplayerRoomPair(
  request: APIRequestContext,
  playerOnePage: Page,
  playerTwoPage: Page,
  roomId: string
): Promise<AuthenticatedMultiplayerRoomPair> {
  const playerOneAuth = await createSmokeGuestAuthSession(request, "Smoke Player One");
  const playerOne = await openAuthenticatedRoom(playerOnePage, {
    roomId,
    session: playerOneAuth,
    expectedMoveText: null
  });
  const playerTwoAuth = await createSmokeGuestAuthSession(request, "Smoke Player Two");
  const playerTwo = await openAuthenticatedRoom(playerTwoPage, {
    roomId,
    session: playerTwoAuth,
    expectedMoveText: null
  });

  if (playerOne.hero.x !== 1 || playerOne.hero.y !== 1 || playerTwo.hero.x !== 6 || playerTwo.hero.y !== 6) {
    throw new Error(
      `unexpected_default_multiplayer_slots:${playerOne.playerId}@${playerOne.hero.x},${playerOne.hero.y}:${playerTwo.playerId}@${playerTwo.hero.x},${playerTwo.hero.y}`
    );
  }

  return {
    playerOne,
    playerTwo
  };
}

async function waitForVisibleHero(page: Page, playerId: string, x: number, y: number): Promise<void> {
  await expect
    .poll(
      async () =>
        (await readAutomationState(page)).visibleHeroes?.some(
          (hero) => hero.playerId === playerId && hero.x === x && hero.y === y
        ) ?? false,
      {
        message: `waiting for ${playerId} visibility at ${x},${y}`
      }
    )
    .toBe(true);
}

export async function startDeterministicPvpBattle(playerOnePage: Page, playerTwoPage: Page): Promise<void> {
  await pressTile(playerOnePage, 3, 1);
  await expectHeroMoveSpentForSession(playerOnePage, 2);

  await followTilePathForSession(
    playerTwoPage,
    [
      { x: 6, y: 4, spent: 2 },
      { x: 6, y: 2, spent: 4 },
      { x: 5, y: 1, spent: 6 }
    ]
  );

  await expect(playerOnePage.getByTestId("event-log")).toContainText("收到房间同步推送", { timeout: 10_000 });
  const playerTwoId = (await readAutomationState(playerTwoPage)).room?.playerId ?? "player-2";
  await waitForVisibleHero(playerOnePage, playerTwoId, 5, 1);
  await pressTile(playerOnePage, 5, 1);
  await expectHeroMoveSpentForSession(playerOnePage, 3);

  await expect(playerOnePage.getByTestId("battle-panel")).not.toContainText("No active battle");
  await expect(playerTwoPage.getByTestId("battle-panel")).not.toContainText("No active battle");
}

export async function attackOnce(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expect(page.getByTestId("battle-attack")).toBeVisible({ timeout: 10_000 });
    const clicked = await page.evaluate(() => {
      const button = document.querySelector<HTMLButtonElement>('[data-testid="battle-attack"]');
      if (!button || button.disabled) {
        return false;
      }
      button.click();
      return true;
    });
    if (clicked) {
      return;
    }
    await page.waitForTimeout(200);
  }

  throw new Error("battle_attack_click_unavailable");
}

async function hasVisibleBattleAttack(page: Page): Promise<boolean> {
  try {
    return await page.getByTestId("battle-attack").isVisible();
  } catch {
    return false;
  }
}

async function hasVisibleBattleModal(page: Page): Promise<boolean> {
  try {
    return await page.getByTestId("battle-modal-title").isVisible();
  } catch {
    return false;
  }
}

export async function resolveBattleToSettlement(
  firstPage: Page,
  secondPage: Page,
  maxTurns = 8
): Promise<void> {
  for (let turn = 0; turn < maxTurns; turn += 1) {
    if ((await hasVisibleBattleModal(firstPage)) || (await hasVisibleBattleModal(secondPage))) {
      return;
    }

    if (await hasVisibleBattleAttack(firstPage)) {
      await attackOnce(firstPage);
      continue;
    }

    if (await hasVisibleBattleAttack(secondPage)) {
      await attackOnce(secondPage);
      continue;
    }

    await firstPage.waitForTimeout(200);
  }

  throw new Error("battle_settlement_not_reached");
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
  if (options.requireDiagnosticsPanel !== false) {
    await expect(page.getByTestId("diagnostic-panel")).toBeVisible();
    await expect(page.getByTestId("diagnostic-connection-status")).toHaveText("已连接");
  }
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
    const response = await fetch(SERVER_DIAGNOSTICS_URL, {
      headers: getAdminHeaders()
    });
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
