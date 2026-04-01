import fs from "node:fs";
import { chromium } from "playwright";

const outDir = "output/cocos-battle-rejection-runtime-3";
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    consoleErrors.push({ type: message.type(), text: message.text() });
  }
});

await page.goto("http://127.0.0.1:7456/?roomId=bugfix-battle-rejection-runtime-3&playerId=player-1", {
  waitUntil: "networkidle"
});
await page.waitForTimeout(2000);

const result = await page.evaluate(async () => {
  const root = globalThis.cc?.director?.getScene?.()?.getChildByName?.("Game")?.components?.find?.(
    (component) => component?.constructor?.name === "VeilRoot"
  ) ?? null;
  if (!root) {
    return { ok: false, reason: "root_missing" };
  }

  await root.startNewRun();
  const targetTile = root.lastUpdate.world.map.tiles.find((tile) => tile.position.x === 5 && tile.position.y === 4) ?? null;
  if (!targetTile) {
    return { ok: false, reason: "target_tile_missing" };
  }

  await root.moveHeroToTile(targetTile);
  const battle = root.lastUpdate?.battle ?? null;
  if (!battle) {
    return { ok: false, reason: "battle_missing" };
  }

  const activeUnitId = battle.turnOrder[0] ?? null;
  const activeCamp = activeUnitId ? battle.units[activeUnitId]?.camp ?? null : null;
  const enemyUnitId = Object.keys(battle.units).find((unitId) => {
    const candidate = battle.units[unitId];
    return candidate?.camp && candidate.camp !== activeCamp;
  }) ?? null;

  await root.actInBattle({ type: "battle.attack", attackerId: activeUnitId, defenderId: activeUnitId });
  const rejectedStatus = root.predictionStatus;
  const rejectedTimeline = root.timelineEntries.slice(0, 3);

  await root.actInBattle({ type: "battle.attack", attackerId: activeUnitId, defenderId: enemyUnitId });

  return {
    ok: true,
    activeUnitId,
    enemyUnitId,
    rejectedStatus,
    acceptedStatus: root.predictionStatus,
    rejectedTimeline,
    finalTimeline: root.timelineEntries.slice(0, 5),
    logLines: root.logLines.slice(0, 8),
    updateReason: root.lastUpdate?.reason ?? null,
    battleFeedback: root.battleFeedback
  };
});

await page.screenshot({ path: `${outDir}/battle-rejection.png`, fullPage: true });
fs.writeFileSync(`${outDir}/result.json`, JSON.stringify({ result, consoleErrors }, null, 2));
console.log(JSON.stringify({ result, consoleErrors }, null, 2));
await browser.close();
