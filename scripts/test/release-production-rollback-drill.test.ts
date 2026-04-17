import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionRollbackDrillReport,
  renderProductionRollbackDrillMarkdown
} from "../release-production-rollback-drill.ts";

test("buildProductionRollbackDrillReport keeps simulated rollback drills pending until they run against a cluster", () => {
  const report = buildProductionRollbackDrillReport(
    {
      candidate: "abc123def456",
      mode: "simulate",
      namespace: "project-veil",
      stableDeployment: "project-veil-server",
      canaryDeployment: "project-veil-server-canary",
      stableService: "project-veil-server",
      canaryService: "project-veil-server-canary",
      canaryIngress: "project-veil-server-canary",
      canaryManifestDir: "/tmp/k8s/canary",
      canaryWeight: 10,
      smokeCommand: "curl -fsS http://127.0.0.1:2567/api/runtime/health",
      simulateSmokeStatus: "failed",
      simulateRollbackStatus: "succeeded"
    },
    {
      now: () => new Date("2026-04-17T08:00:00.000Z")
    }
  );

  assert.equal(report.status, "pending");
  assert.equal(report.summary.autoRollbackCovered, true);
  assert.equal(report.summary.executedAgainstCluster, false);
  assert.equal(report.rollback.status, "succeeded");
  assert.match(report.summary.headline, /live production execution is still required/i);
});

test("buildProductionRollbackDrillReport passes when an executed drill fails smoke and recovers via rollback", () => {
  const responses = new Map<string, { status: number | null; stdout?: string; stderr?: string }>([
    ["kubectl apply -k /tmp/k8s/canary -n project-veil", { status: 0 }],
    ["kubectl set image deployment/project-veil-server-canary server=ghcr.io/dannagrace/projectveil-server:sha-123 -n project-veil", { status: 0 }],
    ["kubectl annotate ingress project-veil-server-canary nginx.ingress.kubernetes.io/canary-weight=10 --overwrite -n project-veil", { status: 0 }],
    ["sh -lc curl -fsS http://127.0.0.1:2567/api/runtime/health", { status: 1, stderr: "smoke failed" }],
    ["kubectl rollout undo deployment/project-veil-server-canary -n project-veil", { status: 0 }]
  ]);

  const report = buildProductionRollbackDrillReport(
    {
      candidate: "abc123def456",
      mode: "execute",
      namespace: "project-veil",
      stableDeployment: "project-veil-server",
      canaryDeployment: "project-veil-server-canary",
      stableService: "project-veil-server",
      canaryService: "project-veil-server-canary",
      canaryIngress: "project-veil-server-canary",
      canaryManifestDir: "/tmp/k8s/canary",
      canaryWeight: 10,
      imageTag: "ghcr.io/dannagrace/projectveil-server:sha-123",
      smokeCommand: "curl -fsS http://127.0.0.1:2567/api/runtime/health",
      simulateSmokeStatus: "failed",
      simulateRollbackStatus: "succeeded"
    },
    {
      now: () => new Date("2026-04-17T08:30:00.000Z"),
      runCommand: (command, args) => {
        const key = [command, ...args].join(" ");
        const response = responses.get(key);
        assert.ok(response, `unexpected command: ${key}`);
        return {
          status: response.status,
          stdout: response.stdout ?? "",
          stderr: response.stderr ?? ""
        };
      }
    }
  );

  assert.equal(report.status, "passed");
  assert.equal(report.summary.autoRollbackCovered, true);
  assert.equal(report.summary.executedAgainstCluster, true);
  assert.equal(report.rollback.attempted, true);
  assert.equal(report.rollback.status, "succeeded");
  assert.match(renderProductionRollbackDrillMarkdown(report), /auto rollback covered: yes/i);
});

test("buildProductionRollbackDrillReport fails when smoke passes and the rollback path never runs", () => {
  const responses = new Map<string, { status: number | null; stdout?: string; stderr?: string }>([
    ["kubectl apply -k /tmp/k8s/canary -n project-veil", { status: 0 }],
    ["kubectl annotate ingress project-veil-server-canary nginx.ingress.kubernetes.io/canary-weight=10 --overwrite -n project-veil", { status: 0 }],
    ["sh -lc curl -fsS http://127.0.0.1:2567/api/runtime/health", { status: 0 }]
  ]);

  const report = buildProductionRollbackDrillReport(
    {
      candidate: "abc123def456",
      mode: "execute",
      namespace: "project-veil",
      stableDeployment: "project-veil-server",
      canaryDeployment: "project-veil-server-canary",
      stableService: "project-veil-server",
      canaryService: "project-veil-server-canary",
      canaryIngress: "project-veil-server-canary",
      canaryManifestDir: "/tmp/k8s/canary",
      canaryWeight: 10,
      smokeCommand: "curl -fsS http://127.0.0.1:2567/api/runtime/health",
      simulateSmokeStatus: "failed",
      simulateRollbackStatus: "succeeded"
    },
    {
      now: () => new Date("2026-04-17T08:45:00.000Z"),
      runCommand: (command, args) => {
        const key = [command, ...args].join(" ");
        const response = responses.get(key);
        assert.ok(response, `unexpected command: ${key}`);
        return {
          status: response.status,
          stdout: response.stdout ?? "",
          stderr: response.stderr ?? ""
        };
      }
    }
  );

  assert.equal(report.status, "failed");
  assert.equal(report.summary.autoRollbackCovered, false);
  assert.equal(report.rollback.attempted, false);
  assert.match(report.summary.headline, /did not complete the required auto-rollback recovery path/i);
});
