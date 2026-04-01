import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runPhase1ReleasePersistenceRegression } from "../phase1-release-persistence-regression.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

test("phase1 release persistence regression validates shipped content and persistence carryover in memory mode", async () => {
  const report = await runPhase1ReleasePersistenceRegression({
    storageMode: "memory",
    configsRoot: path.join(repoRoot, "configs")
  });

  assert.equal(report.summary.status, "passed");
  assert.equal(report.effectiveStorageMode, "memory");
  assert.equal(report.contentValidation.valid, true);
  assert.equal(report.contentValidation.bundleCount, 3);
  assert.equal(report.persistenceRegression.playerId, "release-gate-player-1");
  assert.equal(report.persistenceRegression.heroId, "release-gate-hero-1");
  assert.equal(report.persistenceRegression.assertions.length >= 6, true);
  assert.match(
    report.persistenceRegression.assertions.join("\n"),
    /fresh-room hydration reapplies account resources and hero growth while resetting room-local position\/readiness/
  );
});
