import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test("release:cocos:primary-diagnostics exports versioned JSON and Markdown artifacts with required checkpoints", () => {
  const workspace = createTempDir("veil-primary-diagnostics-");
  const outputPath = path.join(workspace, "primary-diagnostics.json");
  const markdownOutputPath = path.join(workspace, "primary-diagnostics.md");

  const stdout = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/cocos-primary-client-diagnostic-snapshots.ts",
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8"
    }
  );

  assert.match(stdout, /Wrote primary-client diagnostic JSON:/);
  assert.match(stdout, /Checkpoint count: 5/);

  const artifact = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    schemaVersion: number;
    summary: {
      status: string;
      checkpointCount: number;
      categoryIds: string[];
      checkpointIds: string[];
    };
    checkpoints: Array<{
      id: string;
      category: string;
      telemetryCheckpoints: string[];
      diagnostics: {
        source: {
          mode: string;
        };
        account?: {
          accountReadiness?: {
            status: string;
            summary: string;
          };
        };
      };
    }>;
  };

  assert.equal(artifact.schemaVersion, 1);
  assert.equal(artifact.summary.status, "passed");
  assert.equal(artifact.summary.checkpointCount, 5);
  assert.deepEqual(artifact.summary.categoryIds, ["progression", "inventory", "combat", "reconnect"]);
  assert.deepEqual(artifact.summary.checkpointIds, [
    "progression-review",
    "inventory-overflow",
    "combat-loop",
    "reconnect-cached-replay",
    "reconnect-recovery"
  ]);
  assert.deepEqual(
    artifact.checkpoints.map((checkpoint) => checkpoint.id),
    artifact.summary.checkpointIds
  );
  assert.equal(artifact.checkpoints.find((checkpoint) => checkpoint.id === "combat-loop")?.diagnostics.source.mode, "battle");
  assert.equal(artifact.checkpoints[0]?.diagnostics.account?.accountReadiness?.status, "ready");
  assert.deepEqual(
    artifact.checkpoints.find((checkpoint) => checkpoint.id === "inventory-overflow")?.telemetryCheckpoints,
    ["equipment.equip.rejected", "loot.overflowed"]
  );
  assert.equal(fs.existsSync(markdownOutputPath), true);
  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /# Primary-Client Diagnostic Snapshots/);
  assert.match(markdown, /Account readiness: ready · 正式账号会话已绑定/);
  assert.match(markdown, /reconnect-cached-replay/);
});
