import { expect, test, type Page } from "./fixtures";
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

    const lobbyRooms = await fetchJsonFromBrowser<{ items?: unknown[] }>(page, "/api/lobby/rooms");
    expect(Array.isArray(lobbyRooms.items)).toBe(true);

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

test("h5 smoke exposes the battle share stub when WeChat APIs are unavailable", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    let copiedText = "";
    Object.defineProperty(window, "__COPIED_H5_SHARE_TEXT__", {
      configurable: true,
      get: () => copiedText,
      set: (value: string) => {
        copiedText = value;
      }
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copiedText = text;
        }
      }
    });
  });

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await waitForLobbyReady(page);

    const result = await page.evaluate(async () => {
      if (typeof window.run_h5_share_stub_smoke !== "function") {
        throw new Error("missing_h5_share_stub_smoke");
      }

      const shareResult = await window.run_h5_share_stub_smoke();
      return {
        ...shareResult,
        copiedText: (window as typeof window & { __COPIED_H5_SHARE_TEXT__?: string }).__COPIED_H5_SHARE_TEXT__ ?? ""
      };
    });

    expect(result.copied).toBe(true);
    expect(result.message).toContain("已复制战绩摘要");
    expect(result.summary).toContain("房间 h5-share-room");
    expect(result.copiedText).toContain("邀请链接");
  });
});
