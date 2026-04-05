import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configsDir = join(repoRoot, "configs");
const scriptPath = join(repoRoot, "scripts", "content-smoke-gate.ts");

async function copyConfigFixture(tempDir: string, fileName: string): Promise<void> {
  const content = await readFile(join(configsDir, fileName), "utf8");
  await writeFile(join(tempDir, fileName), content, "utf8");
}

async function seedSmokeGateRoot(tempDir: string): Promise<void> {
  await Promise.all(
    [
      "phase1-world.json",
      "phase1-map-objects.json",
      "phase1-world-frontier-basin.json",
      "phase1-map-objects-frontier-basin.json",
      "units.json",
      "battle-skills.json",
      "battle-balance.json",
      "hero-skills.json",
      "hero-skill-trees-full.json",
      "daily-dungeons.json",
      "boss-encounter-templates.json",
      "campaign-chapter1.json",
      "campaign-chapter2.json",
      "campaign-chapter3.json",
      "campaign-chapter4.json"
    ].map((fileName) => copyConfigFixture(tempDir, fileName))
  );
}

test("content-smoke-gate validates the shipped campaign and representative boss map pack", async () => {
  const { stdout } = await execFileAsync(
    "node",
    ["--import", "tsx", scriptPath, "--root-dir", configsDir],
    { cwd: repoRoot }
  );

  assert.match(stdout, /Result: PASS/);
  assert.match(stdout, /Campaign smoke: PASS \(27 missions across 4 chapters; 3 boss mission\(s\)\)/);
  assert.match(stdout, /Representative boss scenario: chapter2-break-the-ring \(frontier-basin, boss-shadow-warden\)/);
  assert.match(stdout, /Content-pack smoke: PASS \(2 bundle\(s\): default, frontier-basin\)/);
});

test("content-smoke-gate fails fast when a campaign boss template reference drifts", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-content-smoke-"));
  await seedSmokeGateRoot(tempDir);

  const chapter2Path = join(tempDir, "campaign-chapter2.json");
  const chapter2 = JSON.parse(await readFile(chapter2Path, "utf8")) as {
    missions: Array<{ id: string; bossTemplateId?: string }>;
  };
  const bossMission = chapter2.missions.find((mission) => mission.id === "chapter2-break-the-ring");
  assert.ok(bossMission);
  bossMission.bossTemplateId = "boss-missing-template";
  await writeFile(chapter2Path, `${JSON.stringify(chapter2, null, 2)}\n`, "utf8");

  await assert.rejects(
    execFileAsync(
      "node",
      ["--import", "tsx", scriptPath, "--root-dir", tempDir],
      { cwd: repoRoot }
    ),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr ?? "", /campaign mission chapter2-break-the-ring bossTemplateId references unknown template boss-missing-template/);
      return true;
    }
  );
});
