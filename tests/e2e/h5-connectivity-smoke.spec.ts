import { expect, test, type Page } from "@playwright/test";
import { buildRoomId, fullMoveTextPattern, waitForLobbyReady, withSmokeDiagnostics } from "./smoke-helpers";

interface RuntimeDiagnosticSnapshot {
  room?: {
    roomId?: string | null;
    playerId?: string | null;
    connectionStatus?: string | null;
    lastUpdateSource?: string | null;
  } | null;
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

async function readRuntimeDiagnosticSnapshot(page: Page): Promise<RuntimeDiagnosticSnapshot> {
  return await page.evaluate(() => {
    const exported = window.export_diagnostic_snapshot?.();
    if (!exported) {
      throw new Error("missing_runtime_diagnostic_snapshot");
    }

    return JSON.parse(exported) as RuntimeDiagnosticSnapshot;
  });
}

test("h5 smoke reaches lobby http path and room websocket path", async ({ page }, testInfo) => {
  const roomId = buildRoomId("e2e-h5-connectivity");
  const playerId = "player-1";

  await withSmokeDiagnostics(testInfo, [page], async () => {
    const lobbyRoomsResponsePromise = page.waitForResponse((response) => {
      return response.url().includes("/api/lobby/rooms") && response.request().method() === "GET";
    });

    await waitForLobbyReady(page);
    const lobbyRoomsResponse = await lobbyRoomsResponsePromise;
    expect(lobbyRoomsResponse.ok()).toBeTruthy();

    const runtimeHealth = await fetchJsonFromBrowser<{ status?: string }>(page, "/api/runtime/health");
    expect(runtimeHealth.status).toBe("ok");

    const lobbyRooms = await fetchJsonFromBrowser<{ rooms?: unknown[] }>(page, "/api/lobby/rooms");
    expect(Array.isArray(lobbyRooms.rooms)).toBe(true);

    await page.locator("[data-lobby-room-id]").fill(roomId);
    await page.locator("[data-lobby-player-id]").fill(playerId);
    await page.locator("[data-lobby-display-name]").fill("Connectivity Smoke");
    await page.locator("[data-enter-room]").click();

    await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
    await expect(page.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
    await expect(page.getByTestId("session-meta")).toContainText(`Player: ${playerId}`);
    await expect(page.getByTestId("diagnostic-connection-status")).toHaveText("已连接");
    await expect(page.getByTestId("room-connection-summary")).toContainText("已连接");
    await expect(page.getByTestId("hero-move")).toHaveText(fullMoveTextPattern(playerId), { timeout: 10_000 });

    const diagnostics = await readRuntimeDiagnosticSnapshot(page);
    expect(diagnostics.room).toMatchObject({
      roomId,
      playerId,
      connectionStatus: "connected",
      lastUpdateSource: "system"
    });
  });
});
