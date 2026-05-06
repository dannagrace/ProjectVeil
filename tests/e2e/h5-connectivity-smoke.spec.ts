import { expect, test, type Page } from "./fixtures";
import {
  acceptLobbyPrivacyConsent,
  buildRoomId,
  fullMoveTextPattern,
  waitForLobbyReady,
  waitForStoredAuthSession,
  withSmokeDiagnostics
} from "./smoke-helpers";

interface RuntimeDiagnosticSnapshot {
  room?: {
    roomId?: string | null;
    playerId?: string | null;
    connectionStatus?: string | null;
    lastUpdateSource?: string | null;
  } | null;
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

async function fetchJsonFromBrowser<T>(page: Page, path: string, headers: Record<string, string> = {}): Promise<T> {
  return await page.evaluate(async ({ requestPath, requestHeaders }) => {
    const response = await fetch(requestPath, {
      headers: requestHeaders
    });
    if (!response.ok) {
      throw new Error(`browser_fetch_failed:${requestPath}:${response.status}`);
    }
    return (await response.json()) as T;
  }, { requestPath: path, requestHeaders: headers });
}

async function expectRuntimeHealthReady(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const response = await fetch("/api/runtime/health");
          const payload = (await response.json()) as RuntimeHealthPayload;
          return (
            (response.status >= 200 && response.status < 300 && payload.status === "ok") ||
            (response.status === 503 &&
              payload.status === "warn" &&
              payload.runtime?.persistence?.status === "degraded" &&
              payload.runtime?.persistence?.storage === "memory")
          );
        }),
      {
        message: "waiting for runtime health endpoint",
        timeout: 15_000
      }
    )
    .toBe(true);
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
    const lobbyAuthHeaders = await waitForLobbyReady(page);
    await expectRuntimeHealthReady(page);

    const lobbyRooms = await fetchJsonFromBrowser<{ items?: unknown[] }>(page, "/api/lobby/rooms", lobbyAuthHeaders);
    expect(Array.isArray(lobbyRooms.items)).toBe(true);

    await page.locator("[data-lobby-room-id]").fill(roomId);
    await page.locator("[data-lobby-player-id]").fill(playerId);
    await page.locator("[data-lobby-display-name]").fill("Connectivity Smoke");
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-enter-room]").click();

    await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
    const authSession = await waitForStoredAuthSession(page, {
      authMode: "guest",
      displayName: "Connectivity Smoke",
      source: "remote"
    });
    const resolvedPlayerId = authSession.playerId!;

    await expect(page.getByTestId("session-meta")).toContainText(`Room: ${roomId}`);
    await expect(page.getByTestId("session-meta")).toContainText(`Player: ${resolvedPlayerId}`);
    await expect(page.getByTestId("diagnostic-connection-status")).toHaveText("已连接");
    await expect(page.getByTestId("room-connection-summary")).toContainText("已连接");
    const movePattern = fullMoveTextPattern(resolvedPlayerId);
    if (movePattern) {
      await expect(page.getByTestId("hero-move")).toHaveText(movePattern, { timeout: 10_000 });
    }

    const diagnostics = await readRuntimeDiagnosticSnapshot(page);
    expect(diagnostics.room).toMatchObject({
      roomId,
      playerId: resolvedPlayerId,
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
