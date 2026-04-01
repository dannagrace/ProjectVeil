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
      "phase1-world-stonewatch-fork.json",
      "phase1-map-objects-stonewatch-fork.json",
      "phase1-world-ridgeway-crossing.json",
      "phase1-map-objects-ridgeway-crossing.json",
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
      "stonewatch-fork",
      "--map-pack",
      "ridgeway-crossing",
      "--map-pack",
      "phase2"
    ],
    { cwd: repoRoot }
  );

  assert.match(stdout, /Bundles: 5/);
  assert.match(stdout, /Bundle: frontier-basin/);
  assert.match(stdout, /Bundle: stonewatch-fork/);
  assert.match(stdout, /Bundle: ridgeway-crossing/);
  assert.match(stdout, /Bundle: phase2/);
  assert.match(stdout, /Result: PASS/);
});

test("validate-content-pack fails when a pack places an object onto blocked terrain", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-content-pack-"));
  await seedContentPackRoot(tempDir);

  const ridgewayWorldPath = join(tempDir, "phase1-world-ridgeway-crossing.json");
  const ridgewayWorld = JSON.parse(await readFile(ridgewayWorldPath, "utf8")) as {
    terrainOverrides: Array<{ position: { x: number; y: number }; terrain: string }>;
  };
  ridgewayWorld.terrainOverrides.push({
    position: { x: 6, y: 4 },
    terrain: "water"
  });
  await writeFile(ridgewayWorldPath, `${JSON.stringify(ridgewayWorld, null, 2)}\n`, "utf8");

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
        "ridgeway-crossing"
      ],
      { cwd: repoRoot }
    ),
    (error: NodeJS.ErrnoException & { stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? "", /Bundle: ridgeway-crossing/);
      assert.match(error.stdout ?? "", /\[mapObjects\] buildings\[3\]\.position/);
      assert.match(error.stdout ?? "", /placed on water terrain/);
      return true;
    }
  );
});

test("validate-content-pack supports the stonewatch fork preset on its own", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      scriptPath,
      "--root-dir",
      configsDir,
      "--map-pack",
      "stonewatch-fork"
    ],
    { cwd: repoRoot }
  );

  assert.match(stdout, /Bundles: 2/);
  assert.match(stdout, /Bundle: stonewatch-fork/);
  assert.match(stdout, /Result: PASS/);
});
