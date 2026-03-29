import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

interface DiagnosticSnapshot {
  schemaVersion: number;
  room: {
    roomId: string;
    playerId: string;
    connectionStatus: string;
  };
  world: {
    hero: {
      id: string;
    } | null;
    resources: {
      gold: number;
      wood: number;
      ore: number;
    };
  } | null;
  diagnostics: {
    logTail: string[];
  };
}

test("developer diagnostics panel exports a compact gameplay snapshot", async ({ page }) => {
  const roomId = `e2e-diagnostic-${Date.now()}`;
  await page.goto(`/?roomId=${roomId}&playerId=player-1`);

  await expect(page.getByTestId("hero-move")).toHaveText(/Move 6\/6/, { timeout: 10_000 });
  await expect(page.getByTestId("diagnostic-panel")).toBeVisible();
  await expect(page.getByTestId("diagnostic-connection-status")).toHaveText("已连接");
  await expect(page.getByTestId("diagnostic-alert-list")).toContainText("链路稳定");
  await expect(page.getByTestId("diagnostic-section-room")).toContainText(roomId);
  await expect(page.getByTestId("diagnostic-section-sync")).toContainText("connected");
  await expect(page.getByTestId("diagnostic-summary")).toContainText(`Room ${roomId} / Player player-1 / Sync connected`);

  const exported = await page.evaluate(() => window.export_diagnostic_snapshot?.() ?? null);
  expect(exported).not.toBeNull();
  const exportedText = await page.evaluate(() => window.render_diagnostic_snapshot_to_text?.() ?? null);
  expect(exportedText).toContain(`Room ${roomId} / Player player-1 / Sync connected`);

  const snapshot = JSON.parse(exported!) as DiagnosticSnapshot;
  expect(snapshot.schemaVersion).toBe(1);
  expect(snapshot.room.roomId).toBe(roomId);
  expect(snapshot.room.playerId).toBe("player-1");
  expect(snapshot.room.connectionStatus).toBe("connected");
  expect(snapshot.world?.hero?.id).toBe("hero-1");
  expect(snapshot.world?.resources).toEqual({ gold: 0, wood: 0, ore: 0 });
  expect(snapshot.diagnostics.logTail[0]).toContain(`Room ${roomId}`);

  await page.getByTestId("diagnostic-copy-text").click();
  await expect(page.getByTestId("diagnostic-export-status")).toHaveText("已复制紧凑摘要");

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("diagnostic-export").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(`veil-diagnostic-${roomId}-player-1-`);

  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const fileContents = await readFile(filePath!, "utf8");
  const downloadedSnapshot = JSON.parse(fileContents) as DiagnosticSnapshot;
  expect(downloadedSnapshot.room.roomId).toBe(roomId);
  expect(downloadedSnapshot.room.playerId).toBe("player-1");
  expect(downloadedSnapshot.room.connectionStatus).toBe("connected");
});
