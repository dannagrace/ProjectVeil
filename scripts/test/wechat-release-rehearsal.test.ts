import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");
const fixtureBuildDir = path.join(repoRoot, "apps", "cocos-client", "test", "fixtures", "wechatgame-export");
const defaultConfigPath = path.join(repoRoot, "apps", "cocos-client", "wechat-minigame.build.json");

test("release:wechat:rehearsal produces structured + markdown summaries", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-rehearsal-"));
  const buildDir = path.join(workspace, "build");
  const artifactsDir = path.join(workspace, "artifacts");
  const summaryPath = path.join(workspace, "summary.json");
  const markdownPath = path.join(workspace, "summary.md");

  fs.cpSync(fixtureBuildDir, buildDir, { recursive: true });

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/wechat-release-rehearsal.ts",
      "--config",
      defaultConfigPath,
      "--build-dir",
      buildDir,
      "--artifacts-dir",
      artifactsDir,
      "--summary",
      summaryPath,
      "--markdown",
      markdownPath,
      "--source-revision",
      "abc1234",
      "--expected-revision",
      "abc1234"
    ],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /WeChat release rehearsal PASSED/);
  assert.ok(fs.existsSync(summaryPath));
  assert.ok(fs.existsSync(markdownPath));

  const report = JSON.parse(fs.readFileSync(summaryPath, "utf8")) as {
    summary: { status: string; artifacts: Record<string, string | undefined> };
    stages: Array<{ id: string; status: string }>;
  };
  assert.equal(report.summary.status, "passed");
  assert.deepEqual(
    report.stages.map((stage) => stage.status),
    ["passed", "passed", "passed", "passed"]
  );
  assert.ok(report.summary.artifacts.archivePath?.includes(".tar.gz"));
  assert.ok(report.summary.artifacts.metadataPath?.endsWith(".package.json"));
  assert.ok(
    report.summary.artifacts.candidateSummaryJsonPath?.endsWith("codex.wechat.release-candidate-summary.json")
  );
  assert.ok(
    report.summary.artifacts.candidateSummaryMarkdownPath?.endsWith("codex.wechat.release-candidate-summary.md")
  );
});
