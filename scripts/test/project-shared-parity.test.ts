import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  buildExpectedProjectSharedFiles,
  buildProjectSharedMirrorManifest,
  checkProjectSharedParity,
  DEFAULT_ROOT_DIR,
  syncProjectShared
} from "../project-shared-parity.mjs";

function createFixtureRoot(): string {
  const fixtureRoot = mkdtempSync(resolve(tmpdir(), "project-shared-parity-"));
  const manifest = buildProjectSharedMirrorManifest({ rootDir: DEFAULT_ROOT_DIR });
  const sourcePaths = new Set(manifest.map((entry) => entry.source));

  for (const relativeSourcePath of sourcePaths) {
    const fixtureSourcePath = resolve(fixtureRoot, relativeSourcePath);
    mkdirSync(dirname(fixtureSourcePath), { recursive: true });
    writeFileSync(
      fixtureSourcePath,
      readFileSync(resolve(DEFAULT_ROOT_DIR, relativeSourcePath), "utf8"),
      "utf8"
    );
  }

  return fixtureRoot;
}

test("project-shared expected files keep map compatibility pointed at world/index", () => {
  const expectedFiles = buildExpectedProjectSharedFiles({ rootDir: DEFAULT_ROOT_DIR });
  const mapCompat = expectedFiles.get("apps/cocos-client/assets/scripts/project-shared/map.ts");

  assert.equal(mapCompat, 'export * from "./world/index.ts";\n');
});

test("project-shared sync and parity detect drift plus unexpected files", () => {
  const fixtureRoot = createFixtureRoot();
  const syncResult = syncProjectShared({ rootDir: fixtureRoot });

  assert.ok(syncResult.changedFiles.length > 0);

  const cleanReport = checkProjectSharedParity({ rootDir: fixtureRoot });
  assert.equal(cleanReport.hasViolations, false);

  const driftedTarget = resolve(
    fixtureRoot,
    "apps/cocos-client/assets/scripts/project-shared/battle.ts"
  );
  writeFileSync(driftedTarget, `${readFileSync(driftedTarget, "utf8")}\n// drift`, "utf8");

  const unexpectedTarget = resolve(
    fixtureRoot,
    "apps/cocos-client/assets/scripts/project-shared/unexpected.ts"
  );
  writeFileSync(unexpectedTarget, 'export const unexpected = true;\n', "utf8");

  const driftReport = checkProjectSharedParity({ rootDir: fixtureRoot });
  assert.equal(driftReport.hasViolations, true);
  assert.deepEqual(driftReport.missingFiles, []);
  assert.ok(driftReport.driftedFiles.some((entry) => entry.filePath.endsWith("/battle.ts")));
  assert.ok(driftReport.unexpectedFiles.some((entry) => entry.endsWith("/unexpected.ts")));
});
