import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildLaunchComplianceGateReport,
  loadLaunchComplianceDossier,
  renderLaunchComplianceGateMarkdown,
  runLaunchComplianceGateCli
} from "../release-launch-compliance-gate";

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "launch-compliance-gate-"));
}

test("buildLaunchComplianceGateReport warns for incomplete but unexpired dossier entries", () => {
  const report = buildLaunchComplianceGateReport(
    {
      license: {
        label: "版号",
        value: "国新出审〔2026〕001 号",
        version: "2026Q2",
        reviewedAt: "2026-04-10T00:00:00.000Z"
      },
      icp: {
        label: "ICP",
        value: "沪ICP备20260001号",
        version: "上海示例主体",
        reviewedAt: "2026-04-11T00:00:00.000Z"
      }
    },
    "configs/launch-compliance.json",
    {
      commit: "abc123def456",
      shortCommit: "abc123",
      branch: "test"
    }
  );

  assert.equal(report.status, "warn");
  assert.match(report.summary, /待补全项/);
  assert.ok(report.checks.some((check) => check.id === "privacy-policy" && check.status === "warn"));
  assert.match(renderLaunchComplianceGateMarkdown(report), /Launch Compliance Gate/);
});

test("buildLaunchComplianceGateReport fails expired credentials", () => {
  const report = buildLaunchComplianceGateReport(
    {
      policies: {
        privacyPolicy: {
          label: "隐私政策",
          value: "https://example.com/privacy",
          version: "v1",
          reviewedAt: "2026-04-01T00:00:00.000Z",
          expiresAt: "2026-04-02T00:00:00.000Z"
        }
      }
    },
    "configs/launch-compliance.json",
    {
      commit: "abc123def456",
      shortCommit: "abc123",
      branch: "test"
    }
  );

  assert.equal(report.status, "fail");
  assert.ok(report.checks.some((check) => check.id === "privacy-policy" && check.status === "fail"));
});

test("loadLaunchComplianceDossier supports VEIL_LAUNCH_COMPLIANCE_JSON override", () => {
  const result = loadLaunchComplianceDossier(
    {},
    {
      VEIL_LAUNCH_COMPLIANCE_JSON: JSON.stringify({
        gameTitle: "Project Veil",
        license: {
          value: "版号",
          version: "批次",
          reviewedAt: "2026-04-10T00:00:00.000Z"
        }
      })
    }
  );

  assert.equal(result.configPath, "<env:VEIL_LAUNCH_COMPLIANCE_JSON>");
  assert.equal(result.dossier.gameTitle, "Project Veil");
});

test("runLaunchComplianceGateCli writes JSON and markdown artifacts", async () => {
  const workspace = createTempWorkspace();
  const configPath = path.join(workspace, "launch-compliance.json");
  const outputPath = path.join(workspace, "report.json");
  const markdownPath = path.join(workspace, "report.md");
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        license: {
          value: "国新出审〔2026〕001 号",
          version: "2026Q2",
          reviewedAt: "2026-04-10T00:00:00.000Z"
        },
        icp: {
          value: "沪ICP备20260001号",
          version: "上海示例主体",
          reviewedAt: "2026-04-11T00:00:00.000Z"
        },
        policies: {
          privacyPolicy: {
            value: "https://example.com/privacy",
            version: "v1",
            reviewedAt: "2026-04-12T00:00:00.000Z"
          },
          termsOfService: {
            value: "https://example.com/terms",
            version: "v1",
            reviewedAt: "2026-04-12T00:00:00.000Z"
          },
          minorProtection: {
            value: "https://example.com/minor",
            version: "v1",
            reviewedAt: "2026-04-12T00:00:00.000Z"
          },
          dataExportNotice: {
            value: "https://example.com/export",
            version: "v1",
            reviewedAt: "2026-04-12T00:00:00.000Z"
          }
        },
        identityVerification: {
          vendorName: "Tencent Realname",
          sandboxCredential: "sandbox-contract-001",
          productionCredential: "prod-contract-001",
          reviewedAt: "2026-04-12T00:00:00.000Z"
        },
        paymentChannels: {
          wechatPayMerchantId: "1900000109",
          appleAppStoreAccount: "appstore@example.com",
          googlePlayDeveloperId: "play-dev-example",
          reviewedAt: "2026-04-12T00:00:00.000Z"
        }
      },
      null,
      2
    )
  );

  const code = await runLaunchComplianceGateCli(
    [
      "node",
      "release-launch-compliance-gate.ts",
      "--config",
      configPath,
      "--output",
      outputPath,
      "--markdown-output",
      markdownPath
    ],
    {}
  );

  assert.equal(code, 0);
  assert.ok(fs.existsSync(outputPath));
  assert.ok(fs.existsSync(markdownPath));
  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as { status: string };
  assert.equal(report.status, "pass");
  assert.match(fs.readFileSync(markdownPath, "utf8"), /Launch Compliance Gate/);
});
