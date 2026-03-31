import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWechatMinigameTemplateArtifacts,
  normalizeWechatMinigameBuildConfig
  // Keep release-validation helpers sourced from tooling/ so root test discovery works in git worktrees.
} from "../tooling/cocos-wechat-build.ts";

function createPackagedWechatReleaseArtifact(): {
  tempDir: string;
  artifactsDir: string;
  configPath: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-primary-delivery-build-"));
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-primary-delivery-artifacts-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-primary-delivery-config-"));
  fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, "game.json"),
    JSON.stringify({
      deviceOrientation: "portrait",
      networkTimeout: {
        request: 10000,
        connectSocket: 10000,
        uploadFile: 10000,
        downloadFile: 10000
      },
      subpackages: []
    })
  );
  fs.writeFileSync(path.join(tempDir, "game.js"), "\"use strict\";\n");
  fs.writeFileSync(path.join(tempDir, "application.js"), "\"use strict\";\n");
  fs.writeFileSync(path.join(tempDir, "src", "settings.json"), JSON.stringify({ subpackages: [] }));
  const config = normalizeWechatMinigameBuildConfig({
    projectName: "Project Veil",
    appId: "touristappid",
    runtimeRemoteUrl: "https://veil.example.com/socket",
    remoteAssetRoot: "https://cdn.example.com/assets",
    domains: {
      request: ["https://veil.example.com"],
      socket: ["wss://veil.example.com"],
      uploadFile: [],
      downloadFile: ["https://cdn.example.com"]
    }
  });
  const artifacts = buildWechatMinigameTemplateArtifacts(config);
  const configPath = path.join(configDir, "wechat-minigame.build.json");
  fs.writeFileSync(path.join(tempDir, "project.config.json"), JSON.stringify(artifacts.projectConfigJson));
  fs.writeFileSync(path.join(tempDir, "codex.wechat.build.json"), JSON.stringify(artifacts.manifestJson));
  fs.writeFileSync(path.join(tempDir, "README.codex.md"), `${artifacts.releaseChecklistMarkdown}\n`);
  fs.writeFileSync(configPath, JSON.stringify(config));

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/package-wechat-minigame-release.ts",
      "--config",
      configPath,
      "--output-dir",
      tempDir,
      "--artifacts-dir",
      artifactsDir,
      "--expect-exported-runtime",
      "--source-revision",
      "abc1234"
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe"
    }
  );

  return {
    tempDir,
    artifactsDir,
    configPath
  };
}

test("audit:cocos-primary-delivery writes passing JSON and markdown summaries", () => {
  const { tempDir, artifactsDir, configPath } = createPackagedWechatReleaseArtifact();
  const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-primary-delivery-report-"));
  const outputPath = path.join(reportDir, "primary-delivery-audit.json");
  const markdownOutputPath = path.join(reportDir, "primary-delivery-audit.md");

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/audit-cocos-primary-delivery.ts",
      "--config",
      configPath,
      "--output-dir",
      tempDir,
      "--artifacts-dir",
      artifactsDir,
      "--expect-exported-runtime",
      "--expected-revision",
      "abc1234",
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Overall status: passed/);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { status: string; passedChecks: number; failedChecks: number };
    checks: Array<{ id: string; status: string }>;
  };
  assert.equal(report.summary.status, "passed");
  assert.equal(report.summary.passedChecks, 2);
  assert.equal(report.summary.failedChecks, 0);
  assert.deepEqual(
    report.checks.map((check) => [check.id, check.status]),
    [
      ["exported-build-validation", "passed"],
      ["packaged-artifact-audit", "passed"]
    ]
  );

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /Primary Cocos Client Delivery Audit/);
  assert.match(markdown, /Overall status: \*\*PASSED\*\*/);
  assert.match(markdown, /docs\/cocos-primary-client-delivery\.md/);
});
