import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildGoNoGoDecisionPacket, renderMarkdown } from "../release-go-no-go-decision-packet.ts";

const repoRoot = path.resolve(__dirname, "../..");

function writeJson(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-go-no-go-packet-"));
}

test("buildGoNoGoDecisionPacket aggregates candidate, gate, and manual review evidence", () => {
  const workspace = createTempWorkspace();
  const releaseDir = path.join(workspace, "artifacts", "release-readiness");
  const dossierDir = path.join(releaseDir, "phase1-candidate-dossier-phase1-rc-abc1234");
  const wechatDir = path.join(workspace, "artifacts", "wechat-release");
  const dossierPath = path.join(dossierDir, "phase1-candidate-dossier.json");
  const runtimeObservabilityDossierPath = path.join(dossierDir, "runtime-observability-dossier.json");
  const releaseGateSummaryPath = path.join(releaseDir, "release-gate-summary-abc1234.json");
  const wechatCandidateSummaryPath = path.join(wechatDir, "codex.wechat.release-candidate-summary.json");

  writeJson(runtimeObservabilityDossierPath, {
    generatedAt: "2026-04-03T02:01:00.000Z",
    summary: {
      status: "passed"
    }
  });

  writeJson(dossierPath, {
    generatedAt: "2026-04-03T02:00:00.000Z",
    candidate: {
      name: "phase1-rc",
      revision: "abc1234def5678",
      shortRevision: "abc1234",
      branch: "release/phase1",
      dirty: false,
      targetSurface: "wechat"
    },
    summary: {
      status: "accepted_risk",
      totalSections: 3,
      requiredFailed: [],
      requiredPending: [],
      acceptedRiskCount: 1
    },
    phase1ExitEvidenceGate: {
      result: "accepted_risk",
      summary: "All required evidence passed, but one accepted-risk section remains open.",
      blockingSections: [],
      pendingSections: [],
      acceptedRiskSections: ["Release health summary"]
    },
    artifacts: {
      outputDir: dossierDir,
      dossierJsonPath: dossierPath,
      dossierMarkdownPath: path.join(dossierDir, "phase1-candidate-dossier.md"),
      runtimeObservabilityDossierPath,
      runtimeObservabilityDossierMarkdownPath: path.join(dossierDir, "runtime-observability-dossier.md"),
      releaseGateSummaryPath,
      releaseGateMarkdownPath: path.join(dossierDir, "release-gate-summary.md"),
      releaseHealthSummaryPath: path.join(dossierDir, "release-health-summary.json"),
      releaseHealthMarkdownPath: path.join(dossierDir, "release-health-summary.md")
    },
    sections: [
      {
        id: "release-readiness",
        label: "Release readiness",
        required: true,
        result: "passed",
        summary: "Automated release readiness checks passed.",
        artifactPath: path.join(releaseDir, "release-readiness-abc1234.json"),
        freshness: "fresh"
      },
      {
        id: "release-health",
        label: "Release health summary",
        required: true,
        result: "accepted_risk",
        summary: "Trend review accepted a known auth alert follow-up.",
        artifactPath: path.join(releaseDir, "release-health-summary-abc1234.json"),
        freshness: "fresh"
      }
    ]
  });

  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-04-03T02:05:00.000Z",
    targetSurface: "wechat",
    summary: {
      status: "passed",
      failedGateIds: []
    },
    inputs: {
      wechatArtifactsDir: wechatDir,
      wechatCandidateSummaryPath
    },
    triage: {
      blockers: [],
      warnings: [
        {
          id: "config-change-risk",
          title: "Config change risk",
          summary: "Config changes are HIGH risk for wechat and still need release-owner review.",
          nextStep: "Review the config change risk summary before promotion.",
          artifacts: [
            {
              label: "Config publish audit",
              path: path.join(workspace, "configs", ".config-center-library.json")
            }
          ]
        }
      ]
    },
    releaseSurface: {
      status: "passed",
      summary: "Release surface evidence is passing for the selected wechat target.",
      evidence: []
    }
  });

  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-03T02:10:00.000Z",
    candidate: {
      revision: "abc1234def5678",
      version: "1.2.3",
      status: "blocked"
    },
    evidence: {
      manualReview: {
        status: "blocked",
        requiredPendingChecks: 1,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-runtime-observability-signoff",
            title: "WeChat runtime observability reviewed for this candidate",
            required: true,
            status: "pending",
            owner: "release-oncall",
            recordedAt: "2026-04-03T02:08:00.000Z",
            revision: "abc1234def5678",
            artifactPath: "artifacts/wechat-release/runtime-observability-signoff-phase1-rc-abc1234.md",
            notes: "Need release-environment health/auth-readiness/metrics captures."
          },
          {
            id: "wechat-release-checklist",
            title: "WeChat RC checklist and blockers reviewed",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: "2026-04-03T02:07:00.000Z",
            revision: "abc1234def5678",
            artifactPath: "artifacts/wechat-release/checklist-review.json"
          }
        ]
      }
    },
    blockers: [
      {
        id: "manual:wechat-runtime-observability-signoff",
        summary: "Runtime observability sign-off is still pending for this candidate.",
        artifactPath: "artifacts/wechat-release/runtime-observability-signoff-phase1-rc-abc1234.md",
        nextCommand: "Complete the runtime observability sign-off and rerun validate:wechat-rc."
      }
    ]
  });

  const packet = buildGoNoGoDecisionPacket({
    dossierPath,
    releaseGateSummaryPath,
    wechatCandidateSummaryPath
  });

  assert.equal(packet.decision.status, "no_go");
  assert.equal(packet.candidate.name, "phase1-rc");
  assert.equal(packet.inputs.runtimeObservabilityDossierPath, runtimeObservabilityDossierPath);
  assert.equal(packet.sections.runtimeObservabilitySignoffLinks.length, 1);
  assert.equal(packet.sections.unresolvedManualChecks.length, 1);
  assert.match(packet.sections.validationSummary.summary, /Phase 1 exit evidence gate is accepted_risk/);
  assert.equal(packet.sections.blockerSummary.blockers.some((item) => item.id === "manual:wechat-runtime-observability-signoff"), true);
  assert.equal(packet.sections.blockerSummary.warnings.some((item) => item.id === "config-change-risk"), true);

  const markdown = renderMarkdown(packet);
  assert.match(markdown, /Decision: `no_go`/);
  assert.match(markdown, /Runtime observability dossier: `.*runtime-observability-dossier\.json`/);
  assert.match(markdown, /## Runtime Observability Sign-Off Links/);
  assert.match(markdown, /WeChat runtime observability reviewed for this candidate/);
  assert.match(markdown, /## Unresolved Manual Checks \(1\)/);
});

test("buildGoNoGoDecisionPacket folds commercial review blockers into the final decision", () => {
  const workspace = createTempWorkspace();
  const releaseDir = path.join(workspace, "artifacts", "release-readiness");
  const dossierDir = path.join(releaseDir, "phase1-candidate-dossier-phase1-rc-abc1234");
  const wechatDir = path.join(workspace, "artifacts", "wechat-release");
  const dossierPath = path.join(dossierDir, "phase1-candidate-dossier.json");
  const releaseGateSummaryPath = path.join(releaseDir, "release-gate-summary-abc1234.json");
  const wechatCandidateSummaryPath = path.join(wechatDir, "codex.wechat.release-candidate-summary.json");
  const commercialReviewPath = path.join(wechatDir, "codex.wechat.commercial-review.json");

  writeJson(dossierPath, {
    generatedAt: "2026-04-10T09:00:00.000Z",
    candidate: {
      name: "phase1-rc",
      revision: "abc1234def5678",
      shortRevision: "abc1234",
      branch: "release/phase1",
      dirty: false,
      targetSurface: "wechat"
    },
    summary: {
      status: "passed",
      totalSections: 1,
      requiredFailed: [],
      requiredPending: [],
      acceptedRiskCount: 0
    },
    phase1ExitEvidenceGate: {
      result: "passed",
      summary: "All required evidence passed.",
      blockingSections: [],
      pendingSections: [],
      acceptedRiskSections: []
    },
    sections: [
      {
        id: "release-readiness",
        label: "Release readiness",
        required: true,
        result: "passed",
        summary: "Automated release readiness checks passed.",
        artifactPath: path.join(releaseDir, "release-readiness-abc1234.json"),
        freshness: "fresh"
      }
    ]
  });

  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-04-10T09:05:00.000Z",
    targetSurface: "wechat",
    summary: {
      status: "passed",
      failedGateIds: []
    },
    inputs: {
      wechatArtifactsDir: wechatDir,
      wechatCandidateSummaryPath
    },
    triage: {
      blockers: [],
      warnings: []
    },
    releaseSurface: {
      status: "passed",
      summary: "Release surface evidence is passing for the selected wechat target.",
      evidence: []
    }
  });

  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-10T09:10:00.000Z",
    candidate: {
      revision: "abc1234def5678",
      version: "1.2.3",
      status: "ready"
    },
    evidence: {
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: []
      }
    },
    blockers: []
  });

  writeJson(commercialReviewPath, {
    generatedAt: "2026-04-10T09:12:00.000Z",
    candidate: {
      revision: "abc1234def5678",
      version: "1.2.3",
      status: "blocked"
    },
    checks: [
      {
        id: "payment-e2e",
        title: "支付链路端到端验证",
        category: "payment",
        required: true,
        status: "pending",
        owner: "release-commerce",
        recordedAt: "2026-04-10T09:11:00.000Z",
        revision: "abc1234def5678",
        artifactPath: "artifacts/wechat-release/commercial-payment-review.json",
        notes: "Waiting on live payment callback proof."
      },
      {
        id: "analytics-funnel-audit",
        title: "核心漏斗与付费埋点验收",
        category: "analytics",
        required: true,
        status: "passed",
        owner: "release-analytics",
        recordedAt: "2026-04-10T09:11:30.000Z",
        revision: "abc1234def5678",
        artifactPath: "artifacts/analytics/onboarding-funnel-report.json",
        notes: "Funnel and payment events are available."
      }
    ],
    blockers: [
      {
        id: "commercial-signoff-missing",
        summary: "Commercial sign-off is still blocked by unfinished payment verification.",
        artifactPath: "artifacts/wechat-release/codex.wechat.commercial-review.json",
        nextCommand: "Complete the payment review and regenerate the packet."
      }
    ]
  });

  const packet = buildGoNoGoDecisionPacket({
    dossierPath,
    releaseGateSummaryPath,
    wechatCandidateSummaryPath,
    commercialReviewPath
  });

  assert.equal(packet.decision.status, "no_go");
  assert.equal(packet.inputs.commercialReviewPath, commercialReviewPath);
  assert.equal(packet.sections.commercialReadinessSummary.status, "blocked");
  assert.equal(packet.sections.commercialReadinessSummary.requiredPendingChecks, 1);
  assert.equal(packet.sections.unresolvedCommercialChecks.length, 1);
  assert.equal(packet.sections.blockerSummary.blockers.some((item) => item.id === "commercial:payment-e2e"), true);
  assert.equal(packet.sections.blockerSummary.blockers.some((item) => item.id === "commercial:commercial-signoff-missing"), true);

  const markdown = renderMarkdown(packet);
  assert.match(markdown, /## Commercial Readiness Summary/);
  assert.match(markdown, /## Unresolved Commercial Checks \(1\)/);
  assert.match(markdown, /支付 - 支付链路端到端验证/);
});

test("go/no-go packet CLI fails with an actionable error when the dossier is missing", () => {
  const workspace = createTempWorkspace();
  const result = spawnSync(
    "node",
    ["--import", "tsx", "./scripts/release-go-no-go-decision-packet.ts", "--dossier", path.join(workspace, "missing.json")],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Phase 1 candidate dossier is missing/);
  assert.match(result.stderr, /release:phase1:candidate-dossier/);
});

test("go/no-go packet CLI writes the default packet outputs", () => {
  const workspace = createTempWorkspace();
  const releaseDir = path.join(workspace, "artifacts", "release-readiness");
  const dossierDir = path.join(releaseDir, "phase1-candidate-dossier-phase1-rc-abc1234");
  const wechatDir = path.join(workspace, "artifacts", "wechat-release");
  const dossierPath = path.join(dossierDir, "phase1-candidate-dossier.json");
  const releaseGateSummaryPath = path.join(releaseDir, "release-gate-summary-abc1234.json");
  const wechatCandidateSummaryPath = path.join(wechatDir, "codex.wechat.release-candidate-summary.json");

  writeJson(dossierPath, {
    generatedAt: "2026-04-03T02:00:00.000Z",
    candidate: {
      name: "phase1-rc",
      revision: "abc1234def5678",
      shortRevision: "abc1234",
      branch: "release/phase1",
      dirty: false,
      targetSurface: "wechat"
    },
    summary: {
      status: "passed",
      totalSections: 1,
      requiredFailed: [],
      requiredPending: [],
      acceptedRiskCount: 0
    },
    phase1ExitEvidenceGate: {
      result: "passed",
      summary: "All required evidence passed.",
      blockingSections: [],
      pendingSections: [],
      acceptedRiskSections: []
    },
    sections: [
      {
        id: "release-readiness",
        label: "Release readiness",
        required: true,
        result: "passed",
        summary: "Automated release readiness checks passed.",
        artifactPath: path.join(releaseDir, "release-readiness-abc1234.json"),
        freshness: "fresh"
      }
    ]
  });

  writeJson(releaseGateSummaryPath, {
    generatedAt: "2026-04-03T02:05:00.000Z",
    targetSurface: "wechat",
    summary: {
      status: "passed",
      failedGateIds: []
    },
    inputs: {
      wechatArtifactsDir: wechatDir,
      wechatCandidateSummaryPath
    },
    triage: {
      blockers: [],
      warnings: []
    },
    releaseSurface: {
      status: "passed",
      summary: "Release surface evidence is passing for the selected wechat target.",
      evidence: []
    }
  });

  writeJson(wechatCandidateSummaryPath, {
    generatedAt: "2026-04-03T02:10:00.000Z",
    candidate: {
      revision: "abc1234def5678",
      version: "1.2.3",
      status: "ready"
    },
    evidence: {
      manualReview: {
        status: "ready",
        requiredPendingChecks: 0,
        requiredFailedChecks: 0,
        requiredMetadataFailures: 0,
        checks: [
          {
            id: "wechat-runtime-observability-signoff",
            title: "WeChat runtime observability reviewed for this candidate",
            required: true,
            status: "passed",
            owner: "release-oncall",
            recordedAt: "2026-04-03T02:08:00.000Z",
            revision: "abc1234def5678",
            artifactPath: "artifacts/wechat-release/runtime-observability-signoff-phase1-rc-abc1234.md"
          }
        ]
      }
    },
    blockers: []
  });

  const outputPath = path.join(releaseDir, "go-no-go-decision-packet-phase1-rc-abc1234.json");
  const markdownOutputPath = path.join(releaseDir, "go-no-go-decision-packet-phase1-rc-abc1234.md");
  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      path.join(repoRoot, "scripts", "release-go-no-go-decision-packet.ts"),
      "--dossier",
      dossierPath,
      "--release-gate-summary",
      releaseGateSummaryPath,
      "--wechat-candidate-summary",
      wechatCandidateSummaryPath,
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Wrote release go\/no-go decision packet JSON:/);
  assert.equal(fs.existsSync(outputPath), true);
  assert.equal(fs.existsSync(markdownOutputPath), true);
  const packet = JSON.parse(fs.readFileSync(outputPath, "utf8"));
  assert.equal(packet.decision.status, "go");
});
