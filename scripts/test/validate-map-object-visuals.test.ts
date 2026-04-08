import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { buildMapObjectVisualCoverageReport } from "../validate-map-object-visuals.ts";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configsDir = join(repoRoot, "configs");
const scriptPath = join(repoRoot, "scripts", "validate-map-object-visuals.ts");

async function copyConfigFixture(tempDir: string, fileName: string): Promise<void> {
  const content = await readFile(join(configsDir, fileName), "utf8");
  await writeFile(join(tempDir, fileName), content, "utf8");
}

async function seedMapObjectVisualRoot(tempDir: string): Promise<void> {
  await Promise.all(
    [
      "object-visuals.json",
      "phase1-map-objects.json",
      "phase1-map-objects-frontier-basin.json",
      "phase1-map-objects-stonewatch-fork.json",
      "phase1-map-objects-ridgeway-crossing.json",
      "phase1-map-objects-highland-reach.json",
      "phase1-map-objects-amber-fields.json",
      "phase1-map-objects-ironpass-gorge.json",
      "phase1-map-objects-splitrock-canyon.json",
      "phase1-map-objects-bogfen-crossing.json",
      "phase1-map-objects-murkveil-delta.json",
      "phase1-map-objects-frostwatch-ridge.json",
      "phase1-map-objects-ashpeak-ascent.json",
      "phase1-map-objects-thornwall-divide.json"
    ].map((fileName) => copyConfigFixture(tempDir, fileName))
  );
}

test("validate-map-object-visuals covers the shipped 13 Phase 1 map packs", async () => {
  const report = await buildMapObjectVisualCoverageReport({
    rootDir: configsDir
  });

  assert.equal(report.mapPackCount, 13);
  assert.equal(report.valid, true);
  assert.equal(report.errorCount, 0);
  assert.equal(report.warningCount, 0);
});

test("validate-map-object-visuals fails when a shipped node loses coverage", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-map-object-visuals-"));
  await seedMapObjectVisualRoot(tempDir);

  const objectVisualsPath = join(tempDir, "object-visuals.json");
  const objectVisuals = JSON.parse(await readFile(objectVisualsPath, "utf8")) as {
    phase1MapPackCoverage: Record<string, { buildings: Record<string, string> }>;
  };

  delete objectVisuals.phase1MapPackCoverage["frontier-basin"]!.buildings["recruit-post-2"];
  await writeFile(objectVisualsPath, `${JSON.stringify(objectVisuals, null, 2)}\n`, "utf8");

  await assert.rejects(
    execFileAsync("node", ["--import", "tsx", scriptPath, "--root-dir", tempDir], { cwd: repoRoot }),
    (error: NodeJS.ErrnoException & { stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? "", /Result: FAIL/);
      assert.match(error.stdout ?? "", /coverage_node_missing/);
      assert.match(error.stdout ?? "", /frontier-basin node recruit-post-2/);
      return true;
    }
  );
});

test("validate-map-object-visuals warns on extra coverage without failing", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-map-object-visuals-"));
  await seedMapObjectVisualRoot(tempDir);

  const objectVisualsPath = join(tempDir, "object-visuals.json");
  const objectVisuals = JSON.parse(await readFile(objectVisualsPath, "utf8")) as {
    phase1MapPackCoverage: Record<string, { resources: Record<string, string> }>;
  };

  objectVisuals.phase1MapPackCoverage.default!.resources["gold@99,99"] = "gold";
  await writeFile(objectVisualsPath, `${JSON.stringify(objectVisuals, null, 2)}\n`, "utf8");

  const { stdout } = await execFileAsync(
    "node",
    ["--import", "tsx", scriptPath, "--root-dir", tempDir],
    { cwd: repoRoot }
  );

  assert.match(stdout, /Result: PASS/);
  assert.match(stdout, /Warnings: 1 issue\(s\)/);
  assert.match(stdout, /coverage_node_extra/);
  assert.match(stdout, /gold@99,99/);
});
