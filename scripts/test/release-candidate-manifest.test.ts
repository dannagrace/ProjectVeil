import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { updateReleaseCandidateManifest } from "../release-candidate-manifest.ts";

function createWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-release-candidate-manifest-"));
}

test("release candidate manifest records required schema fields and reviewer entrypoints", () => {
  const workspace = createWorkspace();
  const releaseReadinessDir = path.join(workspace, "artifacts", "release-readiness");
  const runtimeDir = path.join(releaseReadinessDir, "runtime-observability-bundle-phase1-rc-abc1234");
  fs.mkdirSync(runtimeDir, { recursive: true });

  const result = updateReleaseCandidateManifest({
    candidate: "phase1-rc",
    candidateRevision: "abc1234def5678",
    releaseReadinessDir,
    entries: [
      {
        id: "runtime-observability-bundle",
        label: "Runtime observability bundle",
        category: "reviewer-entrypoint",
        required: true,
        producedAt: "2026-04-12T02:30:00.000Z",
        summary: "Bundle is ready for reviewer entry.",
        producerScript: "./scripts/runtime-observability-bundle.ts",
        artifacts: {
          jsonPath: path.join(runtimeDir, "runtime-observability-bundle.json"),
          markdownPath: path.join(runtimeDir, "runtime-observability-bundle.md"),
          directoryPath: runtimeDir
        },
        metadata: {
          targetSurface: "wechat",
          targetEnvironment: "staging"
        },
        sources: [
          {
            label: "Runtime health endpoint",
            kind: "endpoint",
            url: "https://veil-staging.example.com/api/runtime/health"
          },
          {
            label: "Runtime gate artifact",
            kind: "artifact",
            path: path.join(runtimeDir, "runtime-observability-gate-phase1-rc-abc1234.json")
          }
        ]
      }
    ]
  });

  assert.equal(result.manifest.schemaVersion, 1);
  assert.equal(result.manifest.candidate.name, "phase1-rc");
  assert.equal(result.manifest.candidate.revision, "abc1234def5678");
  assert.equal(result.manifest.candidate.shortRevision, "abc1234def56");
  assert.equal(result.manifest.summary.entryCount, 1);
  assert.equal(result.manifest.summary.requiredEntryCount, 1);
  assert.deepEqual(result.manifest.reviewerWorkflow.requiredEntryIds, ["runtime-observability-bundle"]);
  assert.equal(result.manifest.entries[0]?.artifacts.directoryPath?.includes("runtime-observability-bundle-phase1-rc-abc1234"), true);
  assert.equal(result.manifest.entries[0]?.sources?.[0]?.url, "https://veil-staging.example.com/api/runtime/health");

  const markdown = fs.readFileSync(result.manifestMarkdownPath, "utf8");
  assert.match(markdown, /# Candidate Evidence Manifest/);
  assert.match(markdown, /Start from this manifest instead of manually browsing release-readiness directories/);
  assert.match(markdown, /Runtime observability bundle/);
});

test("release candidate manifest upserts entries by id and keeps latest producer metadata", () => {
  const workspace = createWorkspace();
  const releaseReadinessDir = path.join(workspace, "artifacts", "release-readiness");

  updateReleaseCandidateManifest({
    candidate: "phase1-rc",
    candidateRevision: "abc1234",
    releaseReadinessDir,
    entries: [
      {
        id: "candidate-evidence-audit",
        label: "Candidate evidence audit",
        category: "reviewer-entrypoint",
        required: true,
        producedAt: "2026-04-12T02:35:00.000Z",
        summary: "Initial audit.",
        producerScript: "./scripts/same-candidate-evidence-audit.ts",
        artifacts: {
          jsonPath: path.join(releaseReadinessDir, "candidate-evidence-audit-phase1-rc-abc1234.json")
        }
      }
    ]
  });

  const result = updateReleaseCandidateManifest({
    candidate: "phase1-rc",
    candidateRevision: "abc1234",
    releaseReadinessDir,
    entries: [
      {
        id: "candidate-evidence-audit",
        label: "Candidate evidence audit",
        category: "reviewer-entrypoint",
        required: true,
        producedAt: "2026-04-12T02:40:00.000Z",
        summary: "Updated audit after runtime evidence refresh.",
        producerScript: "./scripts/same-candidate-evidence-audit.ts",
        artifacts: {
          jsonPath: path.join(releaseReadinessDir, "candidate-evidence-audit-phase1-rc-abc1234.json"),
          markdownPath: path.join(releaseReadinessDir, "candidate-evidence-audit-phase1-rc-abc1234.md")
        },
        metadata: {
          status: "passed"
        }
      },
      {
        id: "release-gate-summary",
        label: "Release gate summary",
        category: "supporting-summary",
        required: false,
        producedAt: "2026-04-12T02:41:00.000Z",
        summary: "Release gate is green.",
        producerScript: "./scripts/phase1-candidate-dossier.ts",
        artifacts: {
          jsonPath: path.join(releaseReadinessDir, "release-gate-summary-phase1-rc-abc1234.json")
        }
      }
    ]
  });

  assert.equal(result.manifest.summary.entryCount, 2);
  assert.equal(result.manifest.entries.filter((entry) => entry.id === "candidate-evidence-audit").length, 1);
  assert.equal(
    result.manifest.entries.find((entry) => entry.id === "candidate-evidence-audit")?.artifacts.markdownPath?.endsWith(".md"),
    true
  );
  assert.equal(
    result.manifest.entries.find((entry) => entry.id === "candidate-evidence-audit")?.summary,
    "Updated audit after runtime evidence refresh."
  );
});
