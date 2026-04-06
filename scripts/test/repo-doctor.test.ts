import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectDoctorReport, renderDoctorReport } from "../repo-doctor.mjs";

function makeTempRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-veil-doctor-"));
  fs.mkdirSync(path.join(repoRoot, "node_modules"), { recursive: true });
  return repoRoot;
}

function writeFile(targetPath: string, content = "") {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, content);
}

function basePackageJson() {
  return {
    name: "project-veil",
    private: true,
    packageManager: "npm@10.9.3",
    engines: {
      node: ">=22 <25",
      npm: ">=10"
    }
  };
}

test("doctor passes when baseline and requested flow prerequisites are configured", () => {
  const repoRoot = makeTempRepo();
  writeFile(path.join(repoRoot, ".env"), "VEIL_MYSQL_HOST=127.0.0.1\n");
  writeFile(path.join(repoRoot, "apps/cocos-client/wechat-minigame.build.json"), "{}\n");
  writeFile(path.join(repoRoot, "apps/cocos-client/build-templates/wechatgame/README.codex.md"), "# template\n");
  writeFile(path.join(repoRoot, ".cache/ms-playwright/chromium-1208/INSTALLATION_COMPLETE"), "ok\n");

  const report = collectDoctorReport(
    {
      flows: ["baseline", "e2e", "mysql", "redis", "release"]
    },
    {
      repoRoot,
      packageJson: basePackageJson(),
      nvmrcValue: "22",
      envFile: {
        VEIL_MYSQL_HOST: "127.0.0.1",
        VEIL_MYSQL_USER: "root",
        VEIL_MYSQL_PASSWORD: "secret",
        VEIL_BACKUP_S3_BUCKET: "veil-backups",
        WECHAT_APP_ID: "wx-test-app",
        WECHAT_APP_SECRET: "wx-test-secret"
      },
      env: { HOME: repoRoot },
      nodeVersion: "v22.11.0",
      npmVersion: "10.9.3",
      packageInstalled: () => true,
      commandExists: (command: string) =>
        ["redis-server", "mysql", "mysqldump", "aws"].includes(command),
      runCommand: () => ({ status: 0, stdout: "", stderr: "", error: null })
    }
  );

  assert.equal(report.counts.fail, 0);
  assert.equal(report.counts.warn, 0);
  assert.equal(report.overallStatus, "pass");
  assert.match(renderDoctorReport(report), /Doctor result: passed/);
});

test("doctor warns on Node and npm drift even when engines still pass", () => {
  const repoRoot = makeTempRepo();
  const report = collectDoctorReport(
    {
      flows: ["baseline"]
    },
    {
      repoRoot,
      packageJson: basePackageJson(),
      nvmrcValue: "22",
      envFile: {},
      env: { HOME: repoRoot },
      nodeVersion: "v24.14.0",
      npmVersion: "11.9.0",
      packageInstalled: () => true,
      commandExists: () => false,
      runCommand: () => ({ status: 1, stdout: "", stderr: "", error: null })
    }
  );

  assert.equal(report.counts.fail, 0);
  assert.equal(report.counts.warn, 2);
  assert.equal(report.overallStatus, "warn");
  const output = renderDoctorReport(report);
  assert.match(output, /differs from \.nvmrc/);
  assert.match(output, /differs from packageManager/);
  assert.match(output, /Doctor result: passed with warnings/);
});

test("doctor fails with runtime remediation when Node/npm are unsupported", () => {
  const repoRoot = makeTempRepo();
  const report = collectDoctorReport(
    {
      flows: ["baseline"]
    },
    {
      repoRoot,
      packageJson: basePackageJson(),
      nvmrcValue: "22",
      readmePrerequisites: {
        node: "Node.js 22 LTS",
        npm: "npm 10+"
      },
      envFile: {},
      env: { HOME: repoRoot },
      nodeVersion: "v20.11.1",
      npmVersion: "9.8.1",
      packageInstalled: () => true,
      commandExists: () => false,
      runCommand: () => ({ status: 1, stdout: "", stderr: "", error: null })
    }
  );

  assert.equal(report.counts.fail, 2);
  assert.equal(report.overallStatus, "fail");
  const output = renderDoctorReport(report);
  assert.match(output, /Doctor result: failed/);
  assert.match(output, /Run `nvm use` from the repo root to switch to Node 22/);
  assert.match(output, /npm ci --no-audit --no-fund/);
});

test("doctor prints actionable remediation when optional flow prerequisites are missing", () => {
  const repoRoot = makeTempRepo();
  writeFile(path.join(repoRoot, "apps/cocos-client/wechat-minigame.build.json"), "{}\n");
  writeFile(path.join(repoRoot, "apps/cocos-client/build-templates/wechatgame/README.codex.md"), "# template\n");

  const report = collectDoctorReport(
    {
      flows: ["baseline", "e2e", "mysql", "redis", "release"]
    },
    {
      repoRoot,
      packageJson: basePackageJson(),
      nvmrcValue: "22",
      envFile: {},
      env: { HOME: repoRoot },
      nodeVersion: "v22.11.0",
      npmVersion: "10.9.3",
      packageInstalled: (name: string) => name !== "miniprogram-ci",
      commandExists: () => false,
      runCommand: () => ({ status: 1, stdout: "", stderr: "", error: null })
    }
  );

  assert.ok(report.counts.fail >= 3);
  const output = renderDoctorReport(report);
  assert.match(output, /npx playwright install --with-deps chromium/);
  assert.match(output, /docker compose -f docker-compose.redis.yml up -d/);
  assert.match(output, /Copy `.env.example` to `.env`/);
  assert.match(output, /miniprogram-ci/);
});
