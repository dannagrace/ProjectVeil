import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configsDir = join(repoRoot, "configs");
const scriptPath = join(repoRoot, "scripts", "validate-content-pack.ts");

async function copyConfigFixture(tempDir: string, fileName: string): Promise<void> {
  const content = await readFile(join(configsDir, fileName), "utf8");
  await writeFile(join(tempDir, fileName), content, "utf8");
}

async function seedContentPackRoot(tempDir: string): Promise<void> {
  await Promise.all(
    [
      "phase1-world.json",
      "phase1-map-objects.json",
      "phase1-world-frontier-basin.json",
      "phase1-map-objects-frontier-basin.json",
      "phase2-contested-basin.json",
      "phase2-map-objects-contested-basin.json",
      "units.json",
      "battle-skills.json",
      "battle-balance.json"
    ].map((fileName) => copyConfigFixture(tempDir, fileName))
  );
}

test("validate-content-pack validates all shipped map packs with CLI presets", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      scriptPath,
      "--root-dir",
      configsDir,
      "--map-pack",
      "frontier-basin",
      "--map-pack",
      "phase2"
    ],
    { cwd: repoRoot }
  );

  assert.match(stdout, /Bundles: 3/);
  assert.match(stdout, /Bundle: frontier-basin/);
  assert.match(stdout, /Bundle: phase2/);
  assert.match(stdout, /Result: PASS/);
});

test("validate-content-pack fails when an extra map pack has cross-file consistency errors", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-content-pack-"));
  await seedContentPackRoot(tempDir);

  const frontierWorldPath = join(tempDir, "phase1-world-frontier-basin.json");
  const frontierWorld = JSON.parse(await readFile(frontierWorldPath, "utf8")) as {
    heroes: Array<{ armyTemplateId: string }>;
  };
  frontierWorld.heroes[0] = {
    ...frontierWorld.heroes[0],
    armyTemplateId: "missing_template"
  };
  await writeFile(frontierWorldPath, `${JSON.stringify(frontierWorld, null, 2)}\n`, "utf8");

  await assert.rejects(
    execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        scriptPath,
        "--root-dir",
        tempDir,
        "--map-pack",
        "frontier-basin"
      ],
      { cwd: repoRoot }
    ),
    (error: NodeJS.ErrnoException & { stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? "", /Bundle: frontier-basin/);
      assert.match(error.stdout ?? "", /\[world\] heroes\[0\]\.armyTemplateId/);
      return true;
    }
  );
});
