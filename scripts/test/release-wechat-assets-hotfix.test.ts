import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildWechatAssetsHotfixManifest,
  runWechatAssetsHotfixCli
} from "../release-wechat-assets-hotfix.ts";
import {
  buildWechatMinigameTemplateArtifacts,
  normalizeWechatMinigameBuildConfig
} from "../../apps/cocos-client/tooling/cocos-wechat-build.ts";

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createBuildWorkspace(): {
  workspace: string;
  buildDir: string;
  configPath: string;
  baselineManifestPath: string;
} {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-hotfix-"));
  const buildDir = path.join(workspace, "wechatgame");
  const srcDir = path.join(buildDir, "src");
  const lobbySubpackageDir = path.join(buildDir, "subpackages", "lobby");
  fs.mkdirSync(srcDir, { recursive: true });
  fs.mkdirSync(lobbySubpackageDir, { recursive: true });

  const config = {
    projectName: "Project Veil",
    appId: "wxhotfixappid",
    buildOutputDir: "build/wechatgame",
    runtimeRemoteUrl: "https://veil.example.com/socket",
    remoteAssetRoot: "https://cdn.example.com/assets",
    domains: {
      request: ["https://veil.example.com"],
      socket: ["wss://veil.example.com"],
      uploadFile: [],
      downloadFile: ["https://cdn.example.com"]
    },
    expectedSubpackages: [{ root: "subpackages/lobby", label: "Lobby" }]
  };
  const configPath = path.join(workspace, "wechat-minigame.build.json");
  writeJson(configPath, config);
  const normalizedConfig = normalizeWechatMinigameBuildConfig(config);
  const templateArtifacts = buildWechatMinigameTemplateArtifacts(normalizedConfig);

  writeJson(path.join(buildDir, "game.json"), templateArtifacts.gameJson);
  fs.writeFileSync(path.join(buildDir, "game.js"), "\"use strict\";\n", "utf8");
  fs.writeFileSync(path.join(buildDir, "application.js"), "\"use strict\";\n", "utf8");
  writeJson(path.join(srcDir, "settings.json"), { subpackages: templateArtifacts.gameJson.subpackages ?? [] });
  writeJson(path.join(buildDir, "project.config.json"), templateArtifacts.projectConfigJson);
  writeJson(path.join(buildDir, "codex.wechat.build.json"), templateArtifacts.manifestJson);
  fs.writeFileSync(path.join(buildDir, "README.codex.md"), `${templateArtifacts.releaseChecklistMarkdown}\n`, "utf8");
  fs.writeFileSync(path.join(lobbySubpackageDir, "banner.png"), "new-banner", "utf8");

  const baselineManifestPath = path.join(workspace, "baseline-release.json");
  writeJson(baselineManifestPath, {
    schemaVersion: 1,
    buildTemplatePlatform: "wechatgame",
    projectName: "Project Veil",
    appId: "wxhotfixappid",
    buildOutputDir: "build/wechatgame",
    sourceRevision: "base1234",
    runtimeRemoteUrl: "https://veil.example.com/socket",
    remoteAssetRoot: "https://cdn.example.com/assets",
    budgets: { mainPackageMb: 4, totalSubpackageMb: 30 },
    packageSizes: { totalBytes: 10, mainPackageBytes: 10, totalSubpackageBytes: 0 },
    subpackages: [{ root: "subpackages/lobby", bytes: 0 }],
    warnings: [],
    files: [
      {
        relativePath: "game.js",
        bytes: 13,
        sha256: "0".repeat(64)
      }
    ]
  });

  return { workspace, buildDir, configPath, baselineManifestPath };
}

test("buildWechatAssetsHotfixManifest emits CDN URLs and subpackage summaries for changed files", () => {
  const { buildDir, configPath, baselineManifestPath } = createBuildWorkspace();
  const report = buildWechatAssetsHotfixManifest({
    configPath,
    buildDir,
    baselineManifestPath,
    sourceRevision: "head5678",
    version: "phase1",
    outputDir: path.join(buildDir, "..", "artifacts")
  });

  assert.equal(report.version, "phase1");
  assert.equal(report.sourceRevision, "head5678");
  assert.equal(report.baselineRevision, "base1234");
  assert.equal(report.manifestUrl, "https://cdn.example.com/assets/phase1/codex.wechat.hotfix-manifest.json");
  assert.ok(report.changedFiles.some((entry) => entry.path === "subpackages/lobby/banner.png"));
  const lobbyBanner = report.changedFiles.find((entry) => entry.path === "subpackages/lobby/banner.png");
  assert.equal(lobbyBanner?.packageRoot, "subpackages/lobby");
  assert.equal(
    lobbyBanner?.url,
    "https://cdn.example.com/assets/phase1/subpackages/lobby/banner.png"
  );
  assert.deepEqual(report.changedSubpackages, [
    {
      root: "subpackages/lobby",
      bytes: lobbyBanner?.bytes ?? 0,
      fileCount: 1
    }
  ]);
});

test("runWechatAssetsHotfixCli writes JSON and markdown outputs", () => {
  const { workspace, buildDir, configPath, baselineManifestPath } = createBuildWorkspace();
  const outputDir = path.join(workspace, "artifacts");
  const exitCode = runWechatAssetsHotfixCli([
    "node",
    "./scripts/release-wechat-assets-hotfix.ts",
    "--config",
    configPath,
    "--build-dir",
    buildDir,
    "--baseline-manifest",
    baselineManifestPath,
    "--output-dir",
    outputDir,
    "--version",
    "phase1"
  ]);

  assert.equal(exitCode, 0);
  const jsonPath = path.join(outputDir, "codex.wechat.hotfix-manifest.json");
  const markdownPath = path.join(outputDir, "codex.wechat.hotfix-manifest.md");
  assert.ok(fs.existsSync(jsonPath));
  assert.ok(fs.existsSync(markdownPath));
  assert.match(fs.readFileSync(markdownPath, "utf8"), /Changed Subpackages/);
  const report = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    version: string;
    changedFiles: Array<{ path: string }>;
  };
  assert.equal(report.version, "phase1");
  assert.ok(report.changedFiles.length > 0);
});
