import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildWechatMinigameTemplateArtifacts,
  normalizeWechatMinigameBuildConfig
} from "../tooling/cocos-wechat-build.ts";

function createPackagedWechatReleaseArtifact(): {
  artifactsDir: string;
  reportPath: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-smoke-build-"));
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-smoke-artifacts-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-smoke-config-"));
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
  fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });
  fs.writeFileSync(path.join(tempDir, "src", "settings.json"), JSON.stringify({ subpackages: [] }));
  const configPath = path.join(configDir, "wechat-minigame.build.json");
  const config = normalizeWechatMinigameBuildConfig({
    projectName: "Project Veil",
    appId: "wxsmoketestappid",
    runtimeRemoteUrl: "wss://veil.example.com/socket",
    remoteAssetRoot: "https://cdn.example.com/assets",
    domains: {
      request: ["https://veil.example.com"],
      socket: ["wss://veil.example.com"],
      uploadFile: [],
      downloadFile: ["https://cdn.example.com"]
    }
  });
  const artifacts = buildWechatMinigameTemplateArtifacts(config);
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
    artifactsDir,
    reportPath: path.join(artifactsDir, "codex.wechat.smoke-report.json")
  };
}

test("smoke:wechat-release writes a reusable acceptance report template", () => {
  const { artifactsDir, reportPath } = createPackagedWechatReleaseArtifact();

  const output = execFileSync(
    "node",
    ["--import", "tsx", "./scripts/smoke-wechat-minigame-release.ts", "--artifacts-dir", artifactsDir],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Wrote WeChat smoke report template/);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    artifact: { sourceRevision?: string };
    execution: { result: string };
    cases: Array<{ id: string; status: string }>;
  };
  assert.equal(report.artifact.sourceRevision, "abc1234");
  assert.equal(report.execution.result, "pending");
  assert.deepEqual(
    report.cases.map((entry) => entry.id),
    ["login-lobby", "room-entry", "reconnect-recovery", "share-roundtrip", "key-assets"]
  );
  assert.ok(report.cases.every((entry) => entry.status === "pending"));
});

test("smoke:wechat-release validates a completed acceptance report", () => {
  const { artifactsDir, reportPath } = createPackagedWechatReleaseArtifact();

  execFileSync(
    "node",
    ["--import", "tsx", "./scripts/smoke-wechat-minigame-release.ts", "--artifacts-dir", artifactsDir],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe"
    }
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    execution: { tester: string; device: string; clientVersion: string; executedAt: string; result: string; summary: string };
    cases: Array<{ status: string; notes: string; evidence: string[] }>;
  };
  report.execution.tester = "codex";
  report.execution.device = "iPhone 15 / WeChat 8.0.x";
  report.execution.clientVersion = "1.0.155";
  report.execution.executedAt = "2026-03-28T23:50:00+08:00";
  report.execution.result = "passed";
  report.execution.summary = "All required smoke cases passed on device.";
  for (const entry of report.cases) {
    entry.status = "passed";
    entry.notes = "ok";
    entry.evidence = ["manual"];
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const output = execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/smoke-wechat-minigame-release.ts",
      "--artifacts-dir",
      artifactsDir,
      "--check",
      "--expected-revision",
      "abc1234"
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Validated WeChat smoke report/);
  assert.match(output, /Result: passed/);
  assert.match(output, /Tester: codex/);
});

test("smoke:wechat-release rejects incomplete acceptance reports", () => {
  const { artifactsDir, reportPath } = createPackagedWechatReleaseArtifact();

  execFileSync(
    "node",
    ["--import", "tsx", "./scripts/smoke-wechat-minigame-release.ts", "--artifacts-dir", artifactsDir],
    {
      cwd: path.resolve(__dirname, "../../.."),
      stdio: "pipe"
    }
  );

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as {
    execution: { tester: string; device: string; executedAt: string; result: string };
    cases: Array<{ id: string; status: string }>;
  };
  report.execution.tester = "codex";
  report.execution.device = "Android / WeChat";
  report.execution.executedAt = "2026-03-28T23:50:00+08:00";
  report.execution.result = "passed";
  for (const entry of report.cases) {
    entry.status = "passed";
  }
  const shareCase = report.cases.find((entry) => entry.id === "share-roundtrip");
  if (shareCase) {
    shareCase.status = "pending";
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  assert.throws(
    () =>
      execFileSync(
        "node",
        ["--import", "tsx", "./scripts/smoke-wechat-minigame-release.ts", "--artifacts-dir", artifactsDir, "--check"],
        {
          cwd: path.resolve(__dirname, "../../.."),
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
    /Smoke report case login-lobby is still pending.|Smoke report case share-roundtrip is still pending./
  );
});
