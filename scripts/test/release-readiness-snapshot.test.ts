import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "release-readiness-snapshot.ts");

test("release-readiness-snapshot includes map-object visuals as a required automated gate", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-release-readiness-snapshot-"));
  const outputPath = path.join(tempDir, "release-readiness.json");

  const result = await import("node:child_process").then(({ execFileSync }) =>
    execFileSync("node", ["--import", "tsx", scriptPath, "--no-run", "--output", outputPath], {
      cwd: repoRoot,
      encoding: "utf8"
    })
  );

  assert.match(result, /Overall status: pending/);

  const snapshot = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { total: number; pending: number; status: string };
    checks: Array<{
      id: string;
      kind: string;
      required: boolean;
      status: string;
      command?: string;
    }>;
  };

  const mapObjectVisuals = snapshot.checks.find((check) => check.id === "map-object-visuals");
  assert.ok(mapObjectVisuals);
  assert.equal(mapObjectVisuals.kind, "automated");
  assert.equal(mapObjectVisuals.required, true);
  assert.equal(mapObjectVisuals.status, "pending");
  assert.equal(mapObjectVisuals.command, "npm run validate:map-object-visuals");
  assert.equal(snapshot.summary.status, "pending");
  assert.equal(snapshot.summary.pending, snapshot.summary.total);
});
