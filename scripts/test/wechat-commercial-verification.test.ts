import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

interface CommercialVerificationReport {
  candidate: {
    revision: string | null;
    status: "ready" | "blocked";
  };
  technicalGate: {
    status: "ready" | "blocked";
  };
  summary: {
    status: "ready" | "blocked";
    blockerCount: number;
    acceptedRiskCount: number;
    requiredPendingChecks: number;
    requiredMetadataFailures: number;
  };
  blockers: Array<{
    id: string;
    summary: string;
  }>;
  acceptedRisks: Array<{
    id: string;
    checkId: string;
    summary: string;
  }>;
}

function createWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-commercial-verification-"));
}

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function isoHoursAgo(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function runCommercialVerification(workspaceDir: string, checksPath?: string): CommercialVerificationReport {
  const artifactsDir = path.join(workspaceDir, "artifacts", "wechat-release");
  const outputPath = path.join(artifactsDir, "commercial.json");

  execFileSync(
    "node",
    [
      "--import",
      "tsx",
      "./scripts/wechat-commercial-verification.ts",
      "--artifacts-dir",
      artifactsDir,
      "--candidate",
      "issue-1176-slice",
      "--candidate-revision",
      "abc1234",
      "--output",
      outputPath,
      ...(checksPath ? ["--checks", checksPath] : [])
    ],
    {
      cwd: repoRoot,
      stdio: "pipe"
    }
  );

  return JSON.parse(fs.readFileSync(outputPath, "utf8")) as CommercialVerificationReport;
}

test("commercial verification becomes ready when technical gate and all required checks pass", () => {
  const workspaceDir = createWorkspace();
  const artifactsDir = path.join(workspaceDir, "artifacts", "wechat-release");
  const checksPath = path.join(workspaceDir, "commercial-checks.json");
  const candidateSummaryPath = path.join(artifactsDir, "codex.wechat.release-candidate-summary.json");

  writeJson(candidateSummaryPath, {
    candidate: {
      revision: "abc1234",
      version: "1.0.0",
      status: "ready"
    },
    blockers: []
  });

  writeJson(checksPath, [
    {
      id: "wechat-payment-e2e",
      title: "WeChat payment end-to-end verified",
      status: "passed",
      owner: "commerce-oncall",
      recordedAt: isoHoursAgo(2),
      revision: "abc1234",
      artifactPath: "artifacts/wechat-release/payment-e2e.md",
      acceptedRisks: [
        {
          id: "payment-risk-1",
          summary: "Keep fraud-monitoring alerts on-call for the first rollout window."
        }
      ]
    },
    {
      id: "wechat-subscribe-delivery",
      title: "WeChat subscribe-message delivery verified",
      status: "passed",
      owner: "commerce-oncall",
      recordedAt: isoHoursAgo(2),
      revision: "abc1234",
      artifactPath: "artifacts/wechat-release/subscribe-review.md"
    },
    {
      id: "wechat-analytics-acceptance",
      title: "Commercial analytics acceptance verified",
      status: "passed",
      owner: "data-oncall",
      recordedAt: isoHoursAgo(2),
      revision: "abc1234",
      artifactPath: "artifacts/wechat-release/analytics-review.md"
    },
    {
      id: "wechat-compliance-review",
      title: "Commercial compliance and submission material reviewed",
      status: "passed",
      owner: "legal-oncall",
      recordedAt: isoHoursAgo(2),
      revision: "abc1234",
      artifactPath: "artifacts/wechat-release/compliance-review.md"
    },
    {
      id: "wechat-device-experience-review",
      title: "Physical-device experience reviewed",
      status: "passed",
      owner: "qa-oncall",
      recordedAt: isoHoursAgo(2),
      revision: "abc1234",
      artifactPath: "artifacts/wechat-release/device-experience-review.md"
    }
  ]);

  const report = runCommercialVerification(workspaceDir, checksPath);

  assert.equal(report.technicalGate.status, "ready");
  assert.equal(report.summary.status, "ready");
  assert.equal(report.summary.blockerCount, 0);
  assert.equal(report.summary.acceptedRiskCount, 1);
  assert.deepEqual(report.acceptedRisks.map((risk) => risk.id), ["payment-risk-1"]);
});

test("commercial verification stays blocked when required metadata is stale or missing", () => {
  const workspaceDir = createWorkspace();
  const artifactsDir = path.join(workspaceDir, "artifacts", "wechat-release");
  const checksPath = path.join(workspaceDir, "commercial-checks.json");
  const candidateSummaryPath = path.join(artifactsDir, "codex.wechat.release-candidate-summary.json");

  writeJson(candidateSummaryPath, {
    candidate: {
      revision: "abc1234",
      version: "1.0.0",
      status: "ready"
    },
    blockers: []
  });

  writeJson(checksPath, [
    {
      id: "wechat-payment-e2e",
      title: "WeChat payment end-to-end verified",
      status: "passed",
      owner: "commerce-oncall",
      recordedAt: isoHoursAgo(30),
      revision: "abc1234",
      artifactPath: "artifacts/wechat-release/payment-e2e.md"
    }
  ]);

  const report = runCommercialVerification(workspaceDir, checksPath);

  assert.equal(report.summary.status, "blocked");
  assert.ok(report.summary.requiredPendingChecks > 0);
  assert.ok(report.summary.requiredMetadataFailures > 0);
  assert.ok(report.blockers.some((entry) => entry.id === "wechat-payment-e2e-metadata"));
  assert.ok(report.blockers.some((entry) => entry.id === "wechat-subscribe-delivery-pending"));
});
