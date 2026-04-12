import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO_ROOT = process.cwd();

function createTempWorkspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veil-release-evidence-lifecycle-"));
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath: string, content: string): void {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function setAgeDays(targetPath: string, ageDays: number): void {
  const timestamp = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  fs.utimesSync(targetPath, timestamp, timestamp);
}

function createFile(filePath: string, ageDays: number, content = "artifact\n"): void {
  writeText(filePath, content);
  setAgeDays(filePath, ageDays);
}

function createDirectory(dirPath: string, ageDays: number): void {
  ensureDirectory(dirPath);
  writeText(path.join(dirPath, "marker.txt"), "bundle\n");
  const timestamp = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
  fs.utimesSync(path.join(dirPath, "marker.txt"), timestamp, timestamp);
  fs.utimesSync(dirPath, timestamp, timestamp);
}

function runLifecycle(args: string[]): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", ["--import", "tsx", "./scripts/release-evidence-lifecycle.ts", ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: "pipe",
    });
    return { stdout, status: 0 };
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & { stdout?: string; status?: number };
    return {
      stdout: execError.stdout ?? "",
      status: execError.status ?? 1,
    };
  }
}

test("release evidence lifecycle dry-run reports retained reviewer front doors and archive candidates", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessDir = path.join(workspace, "artifacts", "release-readiness");
  const wechatArtifactsDir = path.join(workspace, "artifacts", "wechat-release");
  const archiveDir = path.join(workspace, "artifacts", "release-archive");
  const outputPath = path.join(workspace, "lifecycle-report.json");
  const markdownOutputPath = path.join(workspace, "lifecycle-report.md");

  createFile(path.join(releaseReadinessDir, "current-release-evidence-index-def5678.json"), 1);
  createFile(path.join(releaseReadinessDir, "current-release-evidence-index-def5678.md"), 1);
  createFile(path.join(releaseReadinessDir, "runtime-observability-evidence-alpha-1111111.json"), 45);
  createFile(path.join(releaseReadinessDir, "runtime-observability-evidence-alpha-1111111.md"), 45);
  createFile(path.join(releaseReadinessDir, "runtime-observability-evidence-alpha-2222222.json"), 30);
  createFile(path.join(releaseReadinessDir, "runtime-observability-evidence-alpha-2222222.md"), 30);
  createDirectory(path.join(releaseReadinessDir, "phase1-candidate-rehearsal", "phase1-mainline-old"), 40);
  createDirectory(path.join(releaseReadinessDir, "phase1-candidate-rehearsal", "phase1-mainline-new"), 20);
  createFile(path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json"), 2);
  createFile(path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.md"), 2);

  createDirectory(path.join(archiveDir, "runs", "2025-01-01T00-00-00Z"), 120);

  const result = runLifecycle([
    "--release-readiness-dir",
    releaseReadinessDir,
    "--wechat-artifacts-dir",
    wechatArtifactsDir,
    "--archive-dir",
    archiveDir,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath,
    "--retention-days",
    "14",
    "--archive-retention-days",
    "30",
    "--keep-latest-per-family",
    "1",
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Planned evidence lifecycle maintenance/);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    mode: string;
    summary: { archiveCandidateCount: number; cleanupCandidateCount: number; reviewerEntryPointCount: number };
    archiveCandidates: Array<{ displayName: string }>;
    reviewerEntryPoints: Array<{ familyId: string; livePaths: string[] }>;
  };

  assert.equal(report.mode, "dry-run");
  assert.equal(report.summary.archiveCandidateCount >= 2, true);
  assert.equal(report.summary.cleanupCandidateCount, 1);
  assert.equal(report.summary.reviewerEntryPointCount >= 2, true);
  assert.equal(
    report.archiveCandidates.some((entry) => entry.displayName === "runtime-observability-evidence-alpha-1111111.json"),
    true
  );
  assert.equal(
    report.archiveCandidates.some((entry) => entry.displayName === "phase1-mainline-old"),
    true
  );
  assert.equal(
    report.reviewerEntryPoints.some((entry) => entry.familyId === "current-release-evidence-index"),
    true
  );
  assert.equal(
    report.reviewerEntryPoints.some((entry) => entry.familyId === "wechat-release-summary"),
    true
  );

  assert.equal(fs.existsSync(path.join(releaseReadinessDir, "runtime-observability-evidence-alpha-1111111.json")), true);
  assert.equal(fs.existsSync(path.join(archiveDir, "runs", "2025-01-01T00-00-00Z")), true);

  const markdown = fs.readFileSync(markdownOutputPath, "utf8");
  assert.match(markdown, /Reviewers should treat retained front-door artifacts in the live directories as current/);
  assert.match(markdown, /Archive Candidates/);
});

test("release evidence lifecycle apply mode archives stale live artifacts and deletes expired archive runs", () => {
  const workspace = createTempWorkspace();
  const releaseReadinessDir = path.join(workspace, "artifacts", "release-readiness");
  const archiveDir = path.join(workspace, "artifacts", "release-archive");
  const outputPath = path.join(workspace, "apply-lifecycle-report.json");

  createFile(path.join(releaseReadinessDir, "runtime-observability-evidence-beta-aaaaaaa.json"), 50);
  createFile(path.join(releaseReadinessDir, "runtime-observability-evidence-beta-aaaaaaa.md"), 50);
  createFile(path.join(releaseReadinessDir, "runtime-observability-evidence-beta-bbbbbbb.json"), 25);
  createFile(path.join(releaseReadinessDir, "runtime-observability-evidence-beta-bbbbbbb.md"), 25);
  createDirectory(path.join(releaseReadinessDir, "phase1-candidate-rehearsal", "phase1-beta-old"), 80);
  createDirectory(path.join(releaseReadinessDir, "phase1-candidate-rehearsal", "phase1-beta-new"), 22);

  createDirectory(path.join(archiveDir, "runs", "2025-01-01T00-00-00Z"), 150);

  const result = runLifecycle([
    "--release-readiness-dir",
    releaseReadinessDir,
    "--wechat-artifacts-dir",
    path.join(workspace, "artifacts", "wechat-release"),
    "--archive-dir",
    archiveDir,
    "--output",
    outputPath,
    "--retention-days",
    "14",
    "--archive-retention-days",
    "30",
    "--keep-latest-per-family",
    "1",
    "--apply",
  ]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Applied evidence lifecycle maintenance/);

  const report = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    mode: string;
    summary: { archivedCount: number; cleanedUpCount: number };
    archived: Array<{ archivePaths: string[]; displayName: string }>;
  };

  assert.equal(report.mode, "apply");
  assert.equal(report.summary.archivedCount >= 2, true);
  assert.equal(report.summary.cleanedUpCount, 1);
  assert.equal(fs.existsSync(path.join(releaseReadinessDir, "runtime-observability-evidence-beta-aaaaaaa.json")), false);
  assert.equal(fs.existsSync(path.join(releaseReadinessDir, "runtime-observability-evidence-beta-bbbbbbb.json")), true);
  assert.equal(fs.existsSync(path.join(releaseReadinessDir, "phase1-candidate-rehearsal", "phase1-beta-old")), false);
  assert.equal(fs.existsSync(path.join(releaseReadinessDir, "phase1-candidate-rehearsal", "phase1-beta-new")), true);
  assert.equal(fs.existsSync(path.join(archiveDir, "runs", "2025-01-01T00-00-00Z")), false);

  const archivedRuntimeEvidence = report.archived.find(
    (entry) => entry.displayName === "runtime-observability-evidence-beta-aaaaaaa.json"
  );
  assert.notEqual(archivedRuntimeEvidence, undefined);
  for (const archivedPath of archivedRuntimeEvidence?.archivePaths ?? []) {
    assert.equal(fs.existsSync(archivedPath), true);
  }

  const runsDir = path.join(archiveDir, "runs");
  const runEntries = fs.readdirSync(runsDir);
  assert.equal(runEntries.length > 0, true);

  const latestRun = path.join(runsDir, runEntries[0] ?? "");
  assert.equal(fs.existsSync(path.join(latestRun, "archive-manifest.json")), true);
});
