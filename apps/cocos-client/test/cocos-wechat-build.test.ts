import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  analyzeWechatMinigameBuildOutput,
  buildWechatMinigameReleaseManifest,
  buildWechatMinigameDomainCoverage,
  buildWechatMinigameTemplateArtifacts,
  normalizeWechatMinigameBuildConfig
} from "../tooling/cocos-wechat-build.ts";

function resolveMainRepoTsxLoaderPath(): string {
  const loaderPath = path.resolve(__dirname, "../../../node_modules/tsx/dist/loader.mjs");
  if (!fs.existsSync(loaderPath)) {
    throw new Error(`Unable to resolve tsx loader from current workspace: ${loaderPath}`);
  }
  return loaderPath;
}

function createPackagedWechatReleaseArtifact(): {
  tempDir: string;
  artifactsDir: string;
  configPath: string;
} {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-build-package-"));
  const artifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-build-package-artifacts-"));
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-build-package-config-"));
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
      resolveMainRepoTsxLoaderPath(),
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

test("normalizeWechatMinigameBuildConfig trims inputs and deduplicates valid domain lists", () => {
  const config = normalizeWechatMinigameBuildConfig({
    projectName: "  Project Veil Mini  ",
    appId: "  wx123  ",
    orientation: "landscape",
    buildOutputDir: "./build/wechatgame/",
    runtimeRemoteUrl: " wss://realtime.example.com/socket?ticket=123 ",
    mainPackageBudgetMb: "5.5",
    totalSubpackageBudgetMb: 32,
    remoteAssetRoot: "https://cdn.example.com/project-veil/",
    networkTimeoutMs: {
      request: "12000",
      connectSocket: 15000,
      uploadFile: 900,
      downloadFile: 18000
    },
    domains: {
      request: ["https://api.example.com/v1", " https://api.example.com/ ", "ftp://ignored.example.com"],
      socket: ["wss://socket.example.com", "ws://dev-socket.example.com"],
      uploadFile: ["https://upload.example.com"],
      downloadFile: ["https://cdn.example.com/project-veil", "not-a-url"]
    },
    expectedSubpackages: [
      { root: " subpackages/battle " },
      { root: "subpackages/battle", label: "duplicate" },
      { root: "subpackages/ui", label: "UI Shell" }
    ]
  });

  assert.equal(config.projectName, "Project Veil Mini");
  assert.equal(config.appId, "wx123");
  assert.equal(config.orientation, "landscape");
  assert.equal(config.buildOutputDir, "build/wechatgame");
  assert.equal(config.runtimeRemoteUrl, "wss://realtime.example.com/socket");
  assert.equal(config.mainPackageBudgetMb, 5.5);
  assert.equal(config.totalSubpackageBudgetMb, 32);
  assert.equal(config.remoteAssetRoot, "https://cdn.example.com/project-veil");
  assert.deepEqual(config.networkTimeoutMs, {
    request: 12000,
    connectSocket: 15000,
    uploadFile: 10000,
    downloadFile: 18000
  });
  assert.deepEqual(config.domains.request, ["https://api.example.com"]);
  assert.deepEqual(config.domains.socket, ["wss://socket.example.com", "ws://dev-socket.example.com"]);
  assert.deepEqual(config.domains.uploadFile, ["https://upload.example.com"]);
  assert.deepEqual(config.domains.downloadFile, ["https://cdn.example.com"]);
  assert.deepEqual(config.expectedSubpackages, [
    { root: "subpackages/battle" },
    { root: "subpackages/ui", label: "UI Shell" }
  ]);
});

test("buildWechatMinigameTemplateArtifacts emits merge-friendly template files and checklist", () => {
  const artifacts = buildWechatMinigameTemplateArtifacts(
    normalizeWechatMinigameBuildConfig({
      projectName: "Project Veil",
      appId: "touristappid",
      runtimeRemoteUrl: "wss://socket.example.com/veil",
      remoteAssetRoot: "https://cdn.example.com/assets",
      expectedSubpackages: [{ root: "subpackages/battle", label: "Battle FX" }],
      domains: {
        request: ["https://socket.example.com/api"],
        socket: ["wss://socket.example.com"],
        uploadFile: [],
        downloadFile: ["https://cdn.example.com/project-veil"]
      }
    })
  );

  assert.deepEqual(artifacts.gameJson, {
    deviceOrientation: "portrait",
    networkTimeout: {
      request: 10000,
      connectSocket: 10000,
      uploadFile: 10000,
      downloadFile: 10000
    },
    subpackages: [
      {
        root: "subpackages/battle",
        name: "battle-fx"
      }
    ]
  });
  assert.deepEqual(artifacts.projectConfigJson, {
    projectname: "Project Veil",
    appid: "touristappid",
    compileType: "game"
  });
  assert.equal(artifacts.manifestJson.buildTemplatePlatform, "wechatgame");
  assert.deepEqual(artifacts.manifestJson.requiredDomains, {
    request: ["https://socket.example.com"],
    socket: ["wss://socket.example.com"],
    uploadFile: [],
    downloadFile: ["https://cdn.example.com"]
  });
  assert.deepEqual(artifacts.manifestJson.missingConfiguredDomains, {
    request: [],
    socket: [],
    uploadFile: [],
    downloadFile: []
  });
  assert.match(artifacts.releaseChecklistMarkdown, /Battle FX/);
  assert.match(artifacts.releaseChecklistMarkdown, /https:\/\/socket\.example\.com/);
  assert.match(artifacts.releaseChecklistMarkdown, /wss:\/\/socket\.example\.com/);
  assert.match(artifacts.releaseChecklistMarkdown, /当前配置已覆盖已知/);
  assert.match(artifacts.releaseChecklistMarkdown, /validate:wechat-build/);
  assert.match(artifacts.releaseChecklistMarkdown, /release:wechat:assets-hotfix/);
});

test("buildWechatMinigameDomainCoverage derives runtime request and socket origins from remoteUrl", () => {
  const coverage = buildWechatMinigameDomainCoverage(
    normalizeWechatMinigameBuildConfig({
      runtimeRemoteUrl: "http://127.0.0.1:2567/ws",
      remoteAssetRoot: "https://cdn.example.com/assets",
      domains: {
        request: ["http://127.0.0.1:2567"],
        socket: [],
        uploadFile: [],
        downloadFile: []
      }
    })
  );

  assert.deepEqual(coverage.required, {
    request: ["http://127.0.0.1:2567"],
    socket: ["ws://127.0.0.1:2567"],
    uploadFile: [],
    downloadFile: ["https://cdn.example.com"]
  });
  assert.deepEqual(coverage.missing, {
    request: [],
    socket: ["ws://127.0.0.1:2567"],
    uploadFile: [],
    downloadFile: ["https://cdn.example.com"]
  });
});

test("analyzeWechatMinigameBuildOutput measures main package and subpackage budgets from build output", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-build-"));
  const config = normalizeWechatMinigameBuildConfig({
    mainPackageBudgetMb: 1,
    totalSubpackageBudgetMb: 1,
    expectedSubpackages: [{ root: "subpackages/battle" }]
  });
  const artifacts = buildWechatMinigameTemplateArtifacts(config);
  fs.mkdirSync(path.join(tempDir, "subpackages", "battle"), { recursive: true });
  fs.writeFileSync(
    path.join(tempDir, "game.json"),
    JSON.stringify({
      ...artifacts.gameJson,
      subpackages: [{ root: "subpackages/battle", name: "battle" }]
    })
  );
  fs.writeFileSync(path.join(tempDir, "game.js"), Buffer.alloc(140));
  fs.writeFileSync(path.join(tempDir, "project.config.json"), JSON.stringify(artifacts.projectConfigJson));
  fs.writeFileSync(path.join(tempDir, "codex.wechat.build.json"), JSON.stringify(artifacts.manifestJson));
  fs.writeFileSync(path.join(tempDir, "README.codex.md"), `${artifacts.releaseChecklistMarkdown}\n`);
  fs.writeFileSync(path.join(tempDir, "subpackages", "battle", "index.js"), Buffer.alloc(60));

  const analysis = analyzeWechatMinigameBuildOutput(tempDir, config);

  assert.equal(analysis.errors.length, 0);
  assert.ok(analysis.mainPackageBytes > 140);
  assert.equal(analysis.totalSubpackageBytes, 60);
  assert.deepEqual(analysis.subpackages, [{ root: "subpackages/battle", bytes: 60 }]);
});

test("analyzeWechatMinigameBuildOutput validates injected config and exported runtime bootstrap files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-build-export-"));
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
  fs.writeFileSync(
    path.join(tempDir, "project.config.json"),
    JSON.stringify({
      projectname: "Project Veil",
      appid: "touristappid",
      compileType: "game",
      libVersion: "trial"
    })
  );
  fs.writeFileSync(
    path.join(tempDir, "codex.wechat.build.json"),
    JSON.stringify(
      buildWechatMinigameTemplateArtifacts(
        normalizeWechatMinigameBuildConfig({
          runtimeRemoteUrl: "http://127.0.0.1:2567",
          domains: {
            request: ["http://127.0.0.1:2567"],
            socket: ["ws://127.0.0.1:2567"],
            uploadFile: [],
            downloadFile: []
          }
        })
      ).manifestJson
    )
  );
  fs.writeFileSync(
    path.join(tempDir, "README.codex.md"),
    `${buildWechatMinigameTemplateArtifacts(
      normalizeWechatMinigameBuildConfig({
        runtimeRemoteUrl: "http://127.0.0.1:2567",
        domains: {
          request: ["http://127.0.0.1:2567"],
          socket: ["ws://127.0.0.1:2567"],
          uploadFile: [],
          downloadFile: []
        }
      })
    ).releaseChecklistMarkdown}\n`
  );

  const analysis = analyzeWechatMinigameBuildOutput(
    tempDir,
    normalizeWechatMinigameBuildConfig({
      runtimeRemoteUrl: "http://127.0.0.1:2567",
      domains: {
        request: ["http://127.0.0.1:2567"],
        socket: ["ws://127.0.0.1:2567"],
        uploadFile: [],
        downloadFile: []
      }
    }),
    { expectExportedRuntime: true }
  );

  assert.equal(analysis.errors.length, 0);
});

test("buildWechatMinigameReleaseManifest emits deterministic file hashes for validated exported builds", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-build-release-"));
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
  fs.writeFileSync(path.join(tempDir, "project.config.json"), JSON.stringify(artifacts.projectConfigJson));
  fs.writeFileSync(path.join(tempDir, "codex.wechat.build.json"), JSON.stringify(artifacts.manifestJson));
  fs.writeFileSync(path.join(tempDir, "README.codex.md"), `${artifacts.releaseChecklistMarkdown}\n`);

  const manifest = buildWechatMinigameReleaseManifest(tempDir, config, {
    expectExportedRuntime: true,
    sourceRevision: "abc1234"
  });

  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceRevision, "abc1234");
  assert.equal(manifest.packageSizes.totalBytes, manifest.packageSizes.mainPackageBytes);
  assert.deepEqual(manifest.files.map((file) => file.relativePath), [
    "application.js",
    "codex.wechat.build.json",
    "game.js",
    "game.json",
    "project.config.json",
    "README.codex.md",
    "src/settings.json"
  ]);
  assert.equal(manifest.files[0]?.sha256.length, 64);
  assert.match(manifest.files[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.warnings, ["No subpackages were detected or configured for this build."]);
});

test("package-wechat-release creates an archive and sidecar metadata from a validated exported build", () => {
  const { artifactsDir } = createPackagedWechatReleaseArtifact();

  const archivePath = path.join(artifactsDir, "project-veil-wechatgame-release.tar.gz");
  const metadataPath = path.join(artifactsDir, "project-veil-wechatgame-release.package.json");
  assert.ok(fs.existsSync(archivePath));
  assert.ok(fs.existsSync(metadataPath));

  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8")) as {
    archiveFileName: string;
    archiveSha256: string;
    fileCount: number;
    sourceRevision?: string;
  };
  assert.equal(metadata.archiveFileName, "project-veil-wechatgame-release.tar.gz");
  assert.match(metadata.archiveSha256, /^[a-f0-9]{64}$/);
  assert.equal(metadata.fileCount, 7);
  assert.equal(metadata.sourceRevision, "abc1234");

  const archiveListing = execFileSync("tar", ["-tzf", archivePath], { encoding: "utf8" });
  assert.match(archiveListing, /project-veil-wechatgame-release\/wechatgame\/codex\.wechat\.release\.json/);
  assert.match(archiveListing, /project-veil-wechatgame-release\/wechatgame\/game\.json/);
});

test("verify-wechat-release validates a downloaded artifact bundle", () => {
  const { artifactsDir } = createPackagedWechatReleaseArtifact();

  const output = execFileSync(
      "node",
      [
        "--import",
        resolveMainRepoTsxLoaderPath(),
        "./scripts/verify-wechat-minigame-artifact.ts",
        "--artifacts-dir",
        artifactsDir,
      "--expected-revision",
      "abc1234"
    ],
    {
      cwd: path.resolve(__dirname, "../../.."),
      encoding: "utf8",
      stdio: "pipe"
    }
  );

  assert.match(output, /Verified WeChat release archive/);
  assert.match(output, /Smoke checklist passed/);
  assert.match(output, /Revision: abc1234/);
});

test("verify-wechat-release fails when the requested rollback revision does not match the artifact", () => {
  const { artifactsDir } = createPackagedWechatReleaseArtifact();

  assert.throws(
    () =>
      execFileSync(
        "node",
        [
          "--import",
          resolveMainRepoTsxLoaderPath(),
          "./scripts/verify-wechat-minigame-artifact.ts",
          "--artifacts-dir",
          artifactsDir,
          "--expected-revision",
          "deadbeef"
        ],
        {
          cwd: path.resolve(__dirname, "../../.."),
          encoding: "utf8",
          stdio: "pipe"
        }
      ),
    /Release revision mismatch: expected deadbeef, sidecar=abc1234, manifest=abc1234/
  );
});

test("analyzeWechatMinigameBuildOutput reports injected config drift and missing exported bootstrap files", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-build-drift-"));
  fs.writeFileSync(
    path.join(tempDir, "game.json"),
    JSON.stringify({
      deviceOrientation: "landscape",
      networkTimeout: {
        request: 10000,
        connectSocket: 10000,
        uploadFile: 10000,
        downloadFile: 10000
      },
      subpackages: []
    })
  );
  fs.writeFileSync(
    path.join(tempDir, "project.config.json"),
    JSON.stringify({
      projectname: "Wrong Name",
      appid: "touristappid",
      compileType: "game"
    })
  );
  fs.writeFileSync(path.join(tempDir, "codex.wechat.build.json"), JSON.stringify({ buildTemplatePlatform: "wechatgame" }));
  fs.writeFileSync(path.join(tempDir, "README.codex.md"), "# stale\n");

  const analysis = analyzeWechatMinigameBuildOutput(
    tempDir,
    normalizeWechatMinigameBuildConfig({
      runtimeRemoteUrl: "http://127.0.0.1:2567",
      domains: {
        request: ["http://127.0.0.1:2567"],
        socket: ["ws://127.0.0.1:2567"],
        uploadFile: [],
        downloadFile: []
      }
    }),
    { expectExportedRuntime: true }
  );

  assert.match(analysis.errors.join("\n"), /Exported build is missing required runtime bootstrap file: game\.js/);
  assert.match(analysis.errors.join("\n"), /Exported build is missing required runtime bootstrap file: application\.js/);
  assert.match(analysis.errors.join("\n"), /Exported build is missing required runtime bootstrap file: src\/settings\.json/);
  assert.match(analysis.errors.join("\n"), /game\.json\.deviceOrientation mismatch/);
  assert.match(analysis.errors.join("\n"), /project\.config\.json\.projectname mismatch/);
  assert.match(analysis.errors.join("\n"), /codex\.wechat\.build\.json\.projectName mismatch/);
  assert.match(analysis.errors.join("\n"), /README\.codex\.md does not match generated template content/);
});

test("analyzeWechatMinigameBuildOutput reports budget overruns and missing expected subpackages", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veil-wechat-build-overrun-"));
  fs.writeFileSync(path.join(tempDir, "game.json"), JSON.stringify({ subpackages: [] }));
  fs.writeFileSync(path.join(tempDir, "main.js"), Buffer.alloc(200));

  const analysis = analyzeWechatMinigameBuildOutput(
    tempDir,
    normalizeWechatMinigameBuildConfig({
      mainPackageBudgetMb: 0.0001,
      totalSubpackageBudgetMb: 0.0001,
      runtimeRemoteUrl: "wss://veil.example.com/socket",
      remoteAssetRoot: "https://cdn.example.com/assets",
      domains: {
        request: [],
        socket: [],
        uploadFile: [],
        downloadFile: []
      },
      expectedSubpackages: [{ root: "subpackages/scene" }]
    })
  );

  assert.deepEqual(analysis.subpackages, [{ root: "subpackages/scene", bytes: 0 }]);
  assert.equal(analysis.missingExpectedSubpackages[0], "subpackages/scene");
  assert.match(analysis.errors.join("\n"), /Main package exceeded budget/);
  assert.match(analysis.errors.join("\n"), /Build output is missing required file: project\.config\.json/);
  assert.match(analysis.errors.join("\n"), /Build output is missing required file: codex\.wechat\.build\.json/);
  assert.match(analysis.errors.join("\n"), /Build output is missing required file: README\.codex\.md/);
  assert.match(analysis.warnings.join("\n"), /Expected subpackages missing/);
  assert.match(analysis.warnings.join("\n"), /request domain checklist/);
  assert.match(analysis.warnings.join("\n"), /socket domain checklist/);
  assert.match(analysis.warnings.join("\n"), /downloadFile domain checklist/);
});
