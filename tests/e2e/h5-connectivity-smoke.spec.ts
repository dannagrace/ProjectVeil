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

function readRgbLightness(value: string): number {
  const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`invalid_rgb_color:${value}`);
  }

  return channels.reduce((total, channel) => total + channel, 0) / (channels.length * 255);
}

test("h5 lobby light cards keep secondary text readable", async ({ page }, testInfo) => {
  await withSmokeDiagnostics(testInfo, [page], async () => {
    await waitForLobbyReady(page);
    await page.locator(".lobby-auth-disclosure").evaluateAll((disclosures) => {
      disclosures.forEach((disclosure) => disclosure.setAttribute("open", ""));
    });

    const lightSurfaceTextColors = await page
      .locator(
        [
          ".lobby-form.info-card .lobby-field > span",
          ".lobby-form.info-card .lobby-auth-head > span",
          ".lobby-form.info-card .lobby-auth-disclosure summary span",
          ".lobby-room-list .info-card > span",
          ".lobby-room-list .lobby-room-meta"
        ].join(", ")
      )
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          })
          .map((element) => getComputedStyle(element).color)
      );
    expect(lightSurfaceTextColors.length).toBeGreaterThan(0);
    for (const color of lightSurfaceTextColors) {
      expect(readRgbLightness(color)).toBeLessThan(0.42);
    }

    const disclosureToggleColors = await page
      .locator(".lobby-form.info-card .lobby-auth-disclosure summary")
      .evaluateAll((summaries) => summaries.map((summary) => getComputedStyle(summary, "::after").color));
    expect(disclosureToggleColors.length).toBeGreaterThan(0);
    for (const color of disclosureToggleColors) {
      expect(readRgbLightness(color)).toBeLessThan(0.42);
    }
  });
});

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

test("h5 mobile room keeps the map and light-surface panels readable", async ({ page }, testInfo) => {
  const roomId = buildRoomId("e2e-h5-mobile-layout");

  await page.setViewportSize({ width: 390, height: 844 });

  await withSmokeDiagnostics(testInfo, [page], async () => {
    await waitForLobbyReady(page);
    await page.locator("[data-lobby-room-id]").fill(roomId);
    await page.locator("[data-lobby-player-id]").fill("player-1");
    await page.locator("[data-lobby-display-name]").fill("Mobile Layout Smoke");
    await acceptLobbyPrivacyConsent(page);
    await page.locator("[data-enter-room]").click();

    await expect(page).toHaveURL(new RegExp(`roomId=${roomId}`));
    await expect(page.getByTestId("hero-move")).toHaveText(fullMoveTextPattern(), { timeout: 10_000 });

    const overflowingTiles = await page.locator(".grid .tile").evaluateAll((tiles) => {
      const viewportWidth = window.innerWidth;
      return tiles
        .map((tile) => {
          const rect = tile.getBoundingClientRect();
          return {
            text: tile.textContent?.replace(/\s+/g, " ").trim() ?? "",
            left: Math.round(rect.left),
            right: Math.round(rect.right)
          };
        })
        .filter((rect) => rect.left < -2 || rect.right > viewportWidth + 2);
    });
    expect(overflowingTiles).toEqual([]);

    const overflowingTileBoxes = await page.locator(".grid .tile").evaluateAll((tiles) =>
      tiles
        .map((tile) => ({
          text: tile.textContent?.replace(/\s+/g, " ").trim() ?? "",
          scrollWidth: tile.scrollWidth,
          clientWidth: tile.clientWidth
        }))
        .filter((tile) => tile.scrollWidth > tile.clientWidth + 1)
    );
    expect(overflowingTileBoxes).toEqual([]);

    const overflowingTileText = await page.locator(".grid .tile").evaluateAll((tiles) =>
      tiles
        .flatMap((tile) => Array.from(tile.querySelectorAll<HTMLElement>(".tile-label, .tile-coord")))
        .map((element) => ({
          text: element.textContent?.replace(/\s+/g, " ").trim() ?? "",
          className: element.className,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        }))
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
    );
    expect(overflowingTileText).toEqual([]);

    const lightSurfaceTextColors = await page.locator(".map-inspector, .battle-empty, .hero-equipment-item").evaluateAll(
      (elements) => elements.map((element) => getComputedStyle(element).color)
    );
    expect(lightSurfaceTextColors.length).toBeGreaterThan(0);
    for (const color of lightSurfaceTextColors) {
      expect(readRgbLightness(color)).toBeLessThan(0.42);
    }
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
