import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type TargetSurface = "h5" | "wechat";
type BuildSurface = "creator_preview" | "wechat_preview" | "wechat_upload_candidate" | "other";
type ManifestStatus = "passed" | "failed";
type ValidationCode =
  | "missing"
  | "stale"
  | "revision_mismatch"
  | "candidate_mismatch"
  | "linked_artifact_mismatch"
  | "missing_timestamp"
  | "invalid_timestamp";

interface Args {
  candidate: string;
  candidateRevision: string;
  targetSurface: TargetSurface;
  buildSurface: BuildSurface;
  outputDir: string;
  releaseOwner: string;
  snapshotPath?: string;
  h5SmokePath?: string;
  reconnectSoakPath?: string;
  persistencePath?: string;
  manualEvidenceLedgerPath?: string;
  cocosRcBundlePath?: string;
  releaseGateSummaryPath?: string;
  dashboardPath?: string;
  wechatArtifactsDir?: string;
  wechatCandidateSummaryPath?: string;
  wechatSmokeReportPath?: string;
  maxAgeHours: number;
  manualChecksPath?: string;
  server?: string;
  creatorVersion?: string;
  wechatClient?: string;
  device?: string;
  notes?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface ReleaseReadinessSnapshot {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
    branch?: string;
    dirty?: boolean;
  };
  summary?: {
    status?: string;
    requiredFailed?: number;
    requiredPending?: number;
  };
}

interface H5SmokeReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  execution?: {
    status?: string;
    finishedAt?: string;
  };
}

interface ReconnectSoakArtifact {
  generatedAt?: string;
  candidate?: {
    name?: string;
    revision?: string;
  };
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  verdict?: {
    status?: string;
    summary?: string;
  };
  status?: string;
  summary?: {
    failedScenarios?: number;
  };
  soakSummary?: {
    reconnectAttempts?: number;
    invariantChecks?: number;
  } | null;
}

interface Phase1PersistenceReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  summary?: {
    status?: string;
    assertionCount?: number;
  };
  contentValidation?: {
    valid?: boolean;
  };
}

interface ReleaseGateSummaryReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  summary?: {
    status?: string;
  };
  inputs?: {
    snapshotPath?: string;
  };
}

interface CocosRcBundleManifest {
  bundle?: {
    generatedAt?: string;
    candidate?: string;
    commit?: string;
    shortCommit?: string;
    overallStatus?: string;
    summary?: string;
  };
  artifacts?: {
    snapshot?: string;
    summaryMarkdown?: string;
    checklistMarkdown?: string;
    blockersMarkdown?: string;
    presentationSignoff?: string;
  };
  linkedEvidence?: {
    releaseReadinessSnapshot?: {
      path?: string;
    };
  };
}

interface ReleaseReadinessDashboardReport {
  generatedAt?: string;
  overallStatus?: string;
  inputs?: {
    candidate?: string;
    snapshotPath?: string;
    cocosRcPath?: string;
    reconnectSoakPath?: string;
    persistencePath?: string;
    candidateRevision?: string;
  };
  goNoGo?: {
    decision?: string;
    summary?: string;
    candidateRevision?: string;
    revisionStatus?: string;
    requiredFailed?: number;
    requiredPending?: number;
  };
}

interface ManualLedger {
  metadata: {
    candidate?: string;
    targetRevision?: string;
    releaseOwner?: string;
    lastUpdated?: string;
    linkedReadinessSnapshot?: string;
  };
  rows: Array<{
    evidenceType: string;
    candidate?: string;
    revision?: string;
    owner?: string;
    status?: string;
    lastUpdated?: string;
    artifactPath?: string;
    notes?: string;
  }>;
}

interface ValidationFinding {
  code: ValidationCode;
  summary: string;
  artifactPath: string;
}

interface ManifestArtifactRef {
  path: string;
  exists: boolean;
  generatedAt?: string;
  revision?: string;
  candidate?: string;
  summary?: string;
}

interface EvidenceBundleManifest {
  schemaVersion: 1;
  generatedAt: string;
  summary: {
    status: ManifestStatus;
    findingCount: number;
    summary: string;
  };
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    dirty: boolean;
    targetSurface: TargetSurface;
    buildSurface: BuildSurface;
  };
  bundle: {
    outputDir: string;
    manifestPath: string;
    markdownPath: string;
  };
  artifacts: {
    releaseReadinessSnapshot: ManifestArtifactRef;
    h5Smoke?: ManifestArtifactRef;
    reconnectSoak: ManifestArtifactRef;
    phase1Persistence: ManifestArtifactRef;
    releaseGateSummary: ManifestArtifactRef;
    releaseReadinessDashboard: ManifestArtifactRef;
    cocosRcBundle: ManifestArtifactRef;
    cocosRcSnapshot?: ManifestArtifactRef;
    cocosRcChecklist?: ManifestArtifactRef;
    cocosRcBlockers?: ManifestArtifactRef;
    manualEvidenceLedger: ManifestArtifactRef;
    runtimeObservabilityPlaceholder?: ManifestArtifactRef;
    wechatCandidateSummary?: ManifestArtifactRef;
    wechatSmokeReport?: ManifestArtifactRef;
  };
  manualEvidencePlaceholders: Array<{
    id: string;
    label: string;
    path: string;
    status: "pending";
  }>;
  downstream: {
    releaseGateSummaryStatus?: string;
    dashboardStatus?: string;
    dashboardDecision?: string;
    cocosRcOverallStatus?: string;
  };
  validation: {
    maxAgeHours: number;
    findings: ValidationFinding[];
  };
}

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_MANUAL_CHECKS = path.resolve("docs", "release-readiness-manual-checks.example.json");
const DEFAULT_MAX_AGE_HOURS = 72;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let targetSurface: TargetSurface = "h5";
  let buildSurface: BuildSurface | undefined;
  let outputDir: string | undefined;
  let releaseOwner = "release-oncall";
  let snapshotPath: string | undefined;
  let h5SmokePath: string | undefined;
  let reconnectSoakPath: string | undefined;
  let persistencePath: string | undefined;
  let manualEvidenceLedgerPath: string | undefined;
  let cocosRcBundlePath: string | undefined;
  let releaseGateSummaryPath: string | undefined;
  let dashboardPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let wechatCandidateSummaryPath: string | undefined;
  let wechatSmokeReportPath: string | undefined;
  let maxAgeHours = DEFAULT_MAX_AGE_HOURS;
  let manualChecksPath: string | undefined;
  let server: string | undefined;
  let creatorVersion: string | undefined;
  let wechatClient: string | undefined;
  let device: string | undefined;
  let notes: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--candidate" && next) {
      candidate = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--candidate-revision" && next) {
      candidateRevision = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--target-surface" && next) {
      if (next !== "h5" && next !== "wechat") {
        fail(`Unsupported --target-surface value: ${next}`);
      }
      targetSurface = next;
      index += 1;
      continue;
    }
    if (arg === "--build-surface" && next) {
      if (
        next !== "creator_preview" &&
        next !== "wechat_preview" &&
        next !== "wechat_upload_candidate" &&
        next !== "other"
      ) {
        fail(`Unsupported --build-surface value: ${next}`);
      }
      buildSurface = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--release-owner" && next) {
      releaseOwner = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--snapshot" && next) {
      snapshotPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--h5-smoke" && next) {
      h5SmokePath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--reconnect-soak" && next) {
      reconnectSoakPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--phase1-persistence" && next) {
      persistencePath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--manual-evidence-ledger" && next) {
      manualEvidenceLedgerPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--cocos-rc-bundle" && next) {
      cocosRcBundlePath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--dashboard" && next) {
      dashboardPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-artifacts-dir" && next) {
      wechatArtifactsDir = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-candidate-summary" && next) {
      wechatCandidateSummaryPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-smoke-report" && next) {
      wechatSmokeReportPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--max-age-hours" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`Invalid --max-age-hours value: ${next}`);
      }
      maxAgeHours = parsed;
      index += 1;
      continue;
    }
    if (arg === "--manual-checks" && next) {
      manualChecksPath = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--server" && next) {
      server = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--creator-version" && next) {
      creatorVersion = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-client" && next) {
      wechatClient = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--device" && next) {
      device = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--notes" && next) {
      notes = next.trim();
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (!candidate) {
    fail("Missing required argument: --candidate");
  }
  if (!candidateRevision) {
    fail("Missing required argument: --candidate-revision");
  }

  const normalizedBuildSurface = buildSurface ?? (targetSurface === "wechat" ? "wechat_preview" : "creator_preview");
  const defaultOutputDir = path.join(
    DEFAULT_OUTPUT_DIR,
    `phase1-same-revision-evidence-bundle-${slugify(candidate)}-${candidateRevision.slice(0, 12)}`
  );

  return {
    candidate,
    candidateRevision,
    targetSurface,
    buildSurface: normalizedBuildSurface,
    outputDir: path.resolve(outputDir ?? defaultOutputDir),
    releaseOwner,
    ...(snapshotPath ? { snapshotPath: path.resolve(snapshotPath) } : {}),
    ...(h5SmokePath ? { h5SmokePath: path.resolve(h5SmokePath) } : {}),
    ...(reconnectSoakPath ? { reconnectSoakPath: path.resolve(reconnectSoakPath) } : {}),
    ...(persistencePath ? { persistencePath: path.resolve(persistencePath) } : {}),
    ...(manualEvidenceLedgerPath ? { manualEvidenceLedgerPath: path.resolve(manualEvidenceLedgerPath) } : {}),
    ...(cocosRcBundlePath ? { cocosRcBundlePath: path.resolve(cocosRcBundlePath) } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath: path.resolve(releaseGateSummaryPath) } : {}),
    ...(dashboardPath ? { dashboardPath: path.resolve(dashboardPath) } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir: path.resolve(wechatArtifactsDir) } : {}),
    ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath: path.resolve(wechatCandidateSummaryPath) } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath: path.resolve(wechatSmokeReportPath) } : {}),
    maxAgeHours,
    ...(manualChecksPath ? { manualChecksPath: path.resolve(manualChecksPath) } : {}),
    ...(server ? { server } : {}),
    ...(creatorVersion ? { creatorVersion } : {}),
    ...(wechatClient ? { wechatClient } : {}),
    ...(device ? { device } : {}),
    ...(notes ? { notes } : {})
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "candidate";
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath: string, payload: unknown): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, content: string): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readGitValue(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function getGitRevision(): GitRevision {
  return {
    commit: readGitValue(["rev-parse", "HEAD"]),
    shortCommit: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
  };
}

function revisionsMatch(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeRevision(left);
  const normalizedRight = normalizeRevision(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function normalizeRevision(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]+$/.test(normalized) ? normalized : undefined;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NaN : parsed;
}

function isStale(value: string | undefined, maxAgeHours: number): boolean | "missing" | "invalid" {
  const parsed = parseTimestamp(value);
  if (parsed === undefined) {
    return "missing";
  }
  if (Number.isNaN(parsed)) {
    return "invalid";
  }
  return Date.now() - parsed > maxAgeHours * 60 * 60 * 1000;
}

function runNodeScript(scriptPath: string, args: string[]): void {
  const result = spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `Command failed: ${scriptPath}`;
    fail(detail);
  }
}

function resolveSnapshot(args: Args): string {
  if (args.snapshotPath) {
    return args.snapshotPath;
  }
  const outputPath = path.join(args.outputDir, `release-readiness-snapshot-${slugify(args.candidate)}-${args.candidateRevision.slice(0, 12)}.json`);
  const commandArgs = ["--output", outputPath, "--manual-checks", args.manualChecksPath ?? DEFAULT_MANUAL_CHECKS];
  runNodeScript("./scripts/release-readiness-snapshot.ts", commandArgs);
  return outputPath;
}

function resolveH5Smoke(args: Args): string | undefined {
  if (args.h5SmokePath) {
    return args.h5SmokePath;
  }
  return undefined;
}

function resolveReconnectSoak(args: Args): string {
  if (args.reconnectSoakPath) {
    return args.reconnectSoakPath;
  }
  const outputPath = path.join(args.outputDir, `colyseus-reconnect-soak-summary-${slugify(args.candidate)}-${args.candidateRevision.slice(0, 12)}.json`);
  const markdownOutputPath = outputPath.replace(/\.json$/, ".md");
  runNodeScript("./scripts/release-candidate-reconnect-soak.ts", [
    "--candidate",
    args.candidate,
    "--candidate-revision",
    args.candidateRevision,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ]);
  return outputPath;
}

function resolvePersistence(args: Args): string {
  if (args.persistencePath) {
    return args.persistencePath;
  }
  const outputPath = path.join(args.outputDir, `phase1-release-persistence-regression-${args.candidateRevision.slice(0, 12)}.json`);
  runNodeScript("./scripts/phase1-release-persistence-regression.ts", ["--output", outputPath]);
  return outputPath;
}

function createManualEvidenceLedger(args: Args, snapshotPath: string, reconnectPath: string, bundleDir: string): string {
  if (args.manualEvidenceLedgerPath) {
    return args.manualEvidenceLedgerPath;
  }

  const now = new Date().toISOString();
  const shortRevision = args.candidateRevision.slice(0, 12);
  const ledgerPath = path.join(bundleDir, `manual-release-evidence-owner-ledger-${slugify(args.candidate)}-${shortRevision}.md`);
  const checklistPath = path.join(bundleDir, `cocos-rc-checklist-${slugify(args.candidate)}-${shortRevision}.md`);
  const blockersPath = path.join(bundleDir, `cocos-rc-blockers-${slugify(args.candidate)}-${shortRevision}.md`);
  const presentationPath = path.join(bundleDir, `cocos-presentation-signoff-${slugify(args.candidate)}-${shortRevision}.json`);
  const rows = [
    {
      evidenceType: "cocos-rc-checklist-review",
      owner: args.releaseOwner,
      status: "pending",
      artifactPath: checklistPath,
      notes: "Review the generated RC checklist for this candidate revision."
    },
    {
      evidenceType: "cocos-rc-blockers-review",
      owner: args.releaseOwner,
      status: "pending",
      artifactPath: blockersPath,
      notes: "Review the generated blocker register for this candidate revision."
    },
    {
      evidenceType: "cocos-presentation-signoff",
      owner: "client-lead",
      status: "pending",
      artifactPath: presentationPath,
      notes: "Confirm presentation gaps or waivers for the same candidate revision."
    },
    {
      evidenceType: "runtime-observability-review",
      owner: "oncall-ops",
      status: args.targetSurface === "wechat" ? "pending" : "waived",
      artifactPath:
        args.targetSurface === "wechat"
          ? path.join(bundleDir, `runtime-observability-signoff-${slugify(args.candidate)}-${shortRevision}.md`)
          : snapshotPath,
      notes:
        args.targetSurface === "wechat"
          ? "Capture runtime observability sign-off for the release environment."
          : "Waived for H5 bundle generation; keep the row for the manifest contract."
    },
    {
      evidenceType: "reconnect-release-followup",
      owner: "server-oncall",
      status: "pending",
      artifactPath: reconnectPath,
      notes: "Review reconnect soak verdict and any cleanup follow-ups before release call."
    }
  ];

  if (args.targetSurface === "wechat") {
    rows.push(
      {
        evidenceType: "wechat-devtools-export-review",
        owner: "qa-release",
        status: "pending",
        artifactPath: args.wechatCandidateSummaryPath ?? path.join(args.wechatArtifactsDir ?? bundleDir, "codex.wechat.release-candidate-summary.json"),
        notes: "Verify the exported WeChat build for the same revision."
      },
      {
        evidenceType: "wechat-device-runtime-smoke",
        owner: "qa-release",
        status: "pending",
        artifactPath: args.wechatSmokeReportPath ?? path.join(args.wechatArtifactsDir ?? bundleDir, "codex.wechat.smoke-report.json"),
        notes: "Attach same-revision device/runtime smoke evidence."
      }
    );
  }

  const renderedRows = rows
    .map(
      (row) =>
        `| \`${row.evidenceType}\` | \`${args.candidate}\` | \`${args.candidateRevision}\` | \`${row.owner}\` | \`${row.status}\` | \`${now}\` | \`${toRelativePath(row.artifactPath)}\` | ${row.notes} |`
    )
    .join("\n");

  writeText(
    ledgerPath,
    `# Manual Release Evidence Owner Ledger

## Candidate

- Candidate: \`${args.candidate}\`
- Target revision: \`${args.candidateRevision}\`
- Release owner: \`${args.releaseOwner}\`
- Last updated: \`${now}\`
- Linked readiness snapshot: \`${toRelativePath(snapshotPath)}\`

## Ledger

| Evidence type | Candidate | Revision | Owner | Status | Last updated | Artifact path / link | Notes / blocker context |
| --- | --- | --- | --- | --- | --- | --- | --- |
${renderedRows}
`
  );

  return ledgerPath;
}

function createRuntimeObservabilityPlaceholder(args: Args, ledgerPath: string, bundleDir: string): string | undefined {
  if (args.targetSurface !== "wechat") {
    return undefined;
  }
  const outputPath = path.join(
    bundleDir,
    `runtime-observability-signoff-${slugify(args.candidate)}-${args.candidateRevision.slice(0, 12)}.md`
  );
  if (fs.existsSync(outputPath)) {
    return outputPath;
  }
  const recordedAt = new Date().toISOString();
  writeText(
    outputPath,
    `# WeChat Runtime Observability Sign-Off

## Candidate

- Candidate: \`${args.candidate}\`
- Surface: \`${args.buildSurface}\`
- Target revision: \`${args.candidateRevision}\`
- Environment: \`<fill-release-environment>\`
- Reviewer: \`<fill-reviewer>\`
- Reviewer role: \`ops | oncall | release-owner\`
- Recorded at: \`${recordedAt}\`
- Related owner ledger: \`${toRelativePath(ledgerPath)}\`

## Linked Evidence

- [ ] \`GET /api/runtime/health\`
  Artifact / link:
  Captured at:
- [ ] \`GET /api/runtime/auth-readiness\`
  Artifact / link:
  Captured at:
- [ ] \`GET /api/runtime/metrics\`
  Artifact / link:
  Captured at:

## Release Decision

- Conclusion: \`passed | hold | ship-with-followups\`
- Summary:
- Accepted risks:
- Follow-ups / owners:
- Blocker IDs:
`
  );
  return outputPath;
}

function resolveCocosBundle(args: Args, snapshotPath: string, bundleDir: string): string {
  if (args.cocosRcBundlePath) {
    return args.cocosRcBundlePath;
  }
  runNodeScript("./scripts/cocos-rc-evidence-bundle.ts", [
    "--candidate",
    args.candidate,
    "--output-dir",
    bundleDir,
    "--build-surface",
    args.buildSurface,
    "--release-readiness-snapshot",
    snapshotPath,
    ...(args.server ? ["--server", args.server] : []),
    ...(args.creatorVersion ? ["--creator-version", args.creatorVersion] : []),
    ...(args.wechatClient ? ["--wechat-client", args.wechatClient] : []),
    ...(args.device ? ["--device", args.device] : []),
    ...(args.notes ? ["--notes", args.notes] : []),
    ...(args.wechatSmokeReportPath ? ["--wechat-smoke-report", args.wechatSmokeReportPath] : [])
  ]);
  return path.join(bundleDir, `cocos-rc-evidence-bundle-${slugify(args.candidate)}-${readGitValue(["rev-parse", "--short", "HEAD"])}.json`);
}

function resolveReleaseGateSummary(
  args: Args,
  snapshotPath: string,
  ledgerPath: string,
  reconnectPath: string,
  h5SmokePath: string | undefined,
  outputDir: string
): string {
  if (args.releaseGateSummaryPath) {
    return args.releaseGateSummaryPath;
  }
  const outputPath = path.join(outputDir, `release-gate-summary-${slugify(args.candidate)}-${args.candidateRevision.slice(0, 12)}.json`);
  const markdownOutputPath = outputPath.replace(/\.json$/, ".md");
  const commandArgs = [
    "--target-surface",
    args.targetSurface,
    "--snapshot",
    snapshotPath,
    "--reconnect-soak",
    reconnectPath,
    "--manual-evidence-ledger",
    ledgerPath,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ];

  if (h5SmokePath) {
    commandArgs.push("--h5-smoke", h5SmokePath);
  }
  if (args.wechatArtifactsDir) {
    commandArgs.push("--wechat-artifacts-dir", args.wechatArtifactsDir);
  }

  runNodeScript("./scripts/release-gate-summary.ts", commandArgs);
  return outputPath;
}

function resolveDashboard(
  args: Args,
  snapshotPath: string,
  cocosRcSnapshotPath: string | undefined,
  reconnectPath: string,
  persistencePath: string,
  outputDir: string
): string {
  if (args.dashboardPath) {
    return args.dashboardPath;
  }
  const outputPath = path.join(outputDir, `release-readiness-dashboard-${slugify(args.candidate)}-${args.candidateRevision.slice(0, 12)}.json`);
  const markdownOutputPath = outputPath.replace(/\.json$/, ".md");
  const commandArgs = [
    "--snapshot",
    snapshotPath,
    "--reconnect-soak",
    reconnectPath,
    "--phase1-persistence",
    persistencePath,
    "--output",
    outputPath,
    "--markdown-output",
    markdownOutputPath
  ];

  if (cocosRcSnapshotPath) {
    commandArgs.push("--cocos-rc", cocosRcSnapshotPath);
  }
  if (args.wechatArtifactsDir) {
    commandArgs.push("--wechat-artifacts-dir", args.wechatArtifactsDir);
  }

  runNodeScript("./scripts/release-readiness-dashboard.ts", commandArgs);
  return outputPath;
}

function readManualLedger(filePath: string): ManualLedger {
  const content = fs.readFileSync(filePath, "utf8");
  const metadataLine = (label: string): string | undefined => {
    const pattern = new RegExp(`^- ${label}: \`([^\\n]+)\`$`, "m");
    return content.match(pattern)?.[1]?.trim();
  };

  const rows = content
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `"))
    .map((line) => {
      const parts = line
        .split("|")
        .slice(1, -1)
        .map((value) => value.trim().replace(/^`|`$/g, ""));
      return {
        evidenceType: parts[0] ?? "",
        candidate: parts[1],
        revision: parts[2],
        owner: parts[3],
        status: parts[4],
        lastUpdated: parts[5],
        artifactPath: parts[6],
        notes: parts[7]
      };
    });

  return {
    metadata: {
      candidate: metadataLine("Candidate"),
      targetRevision: metadataLine("Target revision"),
      releaseOwner: metadataLine("Release owner"),
      lastUpdated: metadataLine("Last updated"),
      linkedReadinessSnapshot: metadataLine("Linked readiness snapshot")
    },
    rows
  };
}

function addTimestampFinding(findings: ValidationFinding[], artifactPath: string, label: string, value: string | undefined, maxAgeHours: number): void {
  const freshness = isStale(value, maxAgeHours);
  if (freshness === "missing") {
    findings.push({
      code: "missing_timestamp",
      summary: `${label} is missing its required timestamp.`,
      artifactPath
    });
    return;
  }
  if (freshness === "invalid") {
    findings.push({
      code: "invalid_timestamp",
      summary: `${label} has an invalid timestamp: ${value ?? "<missing>"}.`,
      artifactPath
    });
    return;
  }
  if (freshness === true) {
    findings.push({
      code: "stale",
      summary: `${label} is older than ${maxAgeHours}h: ${value}.`,
      artifactPath
    });
  }
}

function addRevisionFinding(
  findings: ValidationFinding[],
  artifactPath: string,
  label: string,
  expectedRevision: string,
  observedRevision: string | undefined
): void {
  if (!observedRevision) {
    findings.push({
      code: "revision_mismatch",
      summary: `${label} is missing revision metadata; expected ${expectedRevision}.`,
      artifactPath
    });
    return;
  }
  if (!revisionsMatch(expectedRevision, observedRevision)) {
    findings.push({
      code: "revision_mismatch",
      summary: `${label} targets ${observedRevision}, expected ${expectedRevision}.`,
      artifactPath
    });
  }
}

function addCandidateFinding(
  findings: ValidationFinding[],
  artifactPath: string,
  label: string,
  expectedCandidate: string,
  observedCandidate: string | undefined
): void {
  if (!observedCandidate?.trim()) {
    return;
  }
  if (observedCandidate.trim() !== expectedCandidate) {
    findings.push({
      code: "candidate_mismatch",
      summary: `${label} names candidate ${observedCandidate}, expected ${expectedCandidate}.`,
      artifactPath
    });
  }
}

function addLinkedPathFinding(
  findings: ValidationFinding[],
  artifactPath: string,
  label: string,
  expectedPath: string,
  observedPath: string | undefined
): void {
  if (!observedPath?.trim()) {
    findings.push({
      code: "linked_artifact_mismatch",
      summary: `${label} is missing the linked artifact path for ${toRelativePath(expectedPath)}.`,
      artifactPath
    });
    return;
  }
  if (path.resolve(observedPath) !== path.resolve(expectedPath)) {
    findings.push({
      code: "linked_artifact_mismatch",
      summary: `${label} links ${toRelativePath(path.resolve(observedPath))}, expected ${toRelativePath(expectedPath)}.`,
      artifactPath
    });
  }
}

function createArtifactRef(
  filePath: string | undefined,
  input: {
    generatedAt?: string;
    revision?: string;
    candidate?: string;
    summary?: string;
  } = {}
): ManifestArtifactRef | undefined {
  if (!filePath) {
    return undefined;
  }
  return {
    path: toRelativePath(filePath),
    exists: fs.existsSync(filePath),
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
    ...(input.revision ? { revision: input.revision } : {}),
    ...(input.candidate ? { candidate: input.candidate } : {}),
    ...(input.summary ? { summary: input.summary } : {})
  };
}

function renderMarkdown(manifest: EvidenceBundleManifest): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Same-Revision Evidence Bundle");
  lines.push("");
  lines.push(`- Status: **${manifest.summary.status.toUpperCase()}**`);
  lines.push(`- Summary: ${manifest.summary.summary}`);
  lines.push(`- Candidate: \`${manifest.candidate.name}\``);
  lines.push(`- Revision: \`${manifest.candidate.revision}\``);
  lines.push(`- Surface: \`${manifest.candidate.targetSurface}\``);
  lines.push(`- Build surface: \`${manifest.candidate.buildSurface}\``);
  lines.push("");
  lines.push("## Artifact Set");
  lines.push("");

  const artifactEntries = [
    ["Release readiness snapshot", manifest.artifacts.releaseReadinessSnapshot],
    ["H5 smoke", manifest.artifacts.h5Smoke],
    ["Reconnect soak", manifest.artifacts.reconnectSoak],
    ["Phase 1 persistence", manifest.artifacts.phase1Persistence],
    ["Release gate summary", manifest.artifacts.releaseGateSummary],
    ["Release readiness dashboard", manifest.artifacts.releaseReadinessDashboard],
    ["Cocos RC bundle", manifest.artifacts.cocosRcBundle],
    ["Cocos RC snapshot", manifest.artifacts.cocosRcSnapshot],
    ["Cocos RC checklist", manifest.artifacts.cocosRcChecklist],
    ["Cocos RC blockers", manifest.artifacts.cocosRcBlockers],
    ["Manual evidence owner ledger", manifest.artifacts.manualEvidenceLedger],
    ["Runtime observability placeholder", manifest.artifacts.runtimeObservabilityPlaceholder],
    ["WeChat candidate summary", manifest.artifacts.wechatCandidateSummary],
    ["WeChat smoke report", manifest.artifacts.wechatSmokeReport]
  ];

  for (const [label, artifact] of artifactEntries) {
    if (!artifact) {
      continue;
    }
    lines.push(`- ${label}: \`${artifact.path}\``);
  }

  lines.push("");
  lines.push("## Validation");
  lines.push("");

  if (manifest.validation.findings.length === 0) {
    lines.push("- No same-revision validation findings.");
  } else {
    for (const finding of manifest.validation.findings) {
      lines.push(`- [${finding.code}] ${finding.summary} (\`${toRelativePath(path.resolve(finding.artifactPath))}\`)`);
    }
  }

  lines.push("");
  lines.push("## Downstream Status");
  lines.push("");
  lines.push(`- Release gate summary: \`${manifest.downstream.releaseGateSummaryStatus ?? "<unknown>"}\``);
  lines.push(`- Dashboard: \`${manifest.downstream.dashboardStatus ?? "<unknown>"}\``);
  lines.push(`- Dashboard decision: \`${manifest.downstream.dashboardDecision ?? "<unknown>"}\``);
  lines.push(`- Cocos RC overall status: \`${manifest.downstream.cocosRcOverallStatus ?? "<unknown>"}\``);
  return `${lines.join("\n")}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const gitRevision = getGitRevision();
  fs.mkdirSync(args.outputDir, { recursive: true });

  const snapshotPath = resolveSnapshot(args);
  const h5SmokePath = resolveH5Smoke(args);
  const reconnectPath = resolveReconnectSoak(args);
  const persistencePath = resolvePersistence(args);
  const ledgerPath = createManualEvidenceLedger(args, snapshotPath, reconnectPath, args.outputDir);
  const runtimePlaceholderPath = createRuntimeObservabilityPlaceholder(args, ledgerPath, args.outputDir);
  const cocosBundlePath = resolveCocosBundle(args, snapshotPath, args.outputDir);

  const cocosBundle = readJson<CocosRcBundleManifest>(cocosBundlePath);
  const cocosSnapshotPath = cocosBundle.artifacts?.snapshot ? path.resolve(cocosBundle.artifacts.snapshot) : undefined;
  const releaseGateSummaryPath = resolveReleaseGateSummary(args, snapshotPath, ledgerPath, reconnectPath, h5SmokePath, args.outputDir);
  const dashboardPath = resolveDashboard(args, snapshotPath, cocosSnapshotPath, reconnectPath, persistencePath, args.outputDir);

  const findings: ValidationFinding[] = [];
  const manifestPath = path.join(args.outputDir, "phase1-same-revision-evidence-bundle-manifest.json");
  const markdownPath = path.join(args.outputDir, "phase1-same-revision-evidence-bundle.md");

  const snapshot = readJson<ReleaseReadinessSnapshot>(snapshotPath);
  const reconnect = readJson<ReconnectSoakArtifact>(reconnectPath);
  const persistence = readJson<Phase1PersistenceReport>(persistencePath);
  const ledger = readManualLedger(ledgerPath);
  const gateSummary = readJson<ReleaseGateSummaryReport>(releaseGateSummaryPath);
  const dashboard = readJson<ReleaseReadinessDashboardReport>(dashboardPath);
  const cocosSnapshot = cocosSnapshotPath && fs.existsSync(cocosSnapshotPath) ? readJson<Record<string, unknown>>(cocosSnapshotPath) : undefined;

  const requiredPaths = [snapshotPath, reconnectPath, persistencePath, ledgerPath, cocosBundlePath, releaseGateSummaryPath, dashboardPath];
  for (const filePath of requiredPaths) {
    if (!fs.existsSync(filePath)) {
      findings.push({
        code: "missing",
        summary: `Required artifact is missing: ${toRelativePath(filePath)}.`,
        artifactPath: filePath
      });
    }
  }

  addTimestampFinding(findings, snapshotPath, "Release readiness snapshot", snapshot.generatedAt, args.maxAgeHours);
  addTimestampFinding(findings, reconnectPath, "Reconnect soak artifact", reconnect.generatedAt, args.maxAgeHours);
  addTimestampFinding(findings, persistencePath, "Phase 1 persistence artifact", persistence.generatedAt, args.maxAgeHours);
  addTimestampFinding(findings, ledgerPath, "Manual evidence owner ledger", ledger.metadata.lastUpdated, args.maxAgeHours);
  addTimestampFinding(findings, cocosBundlePath, "Cocos RC bundle", cocosBundle.bundle?.generatedAt, args.maxAgeHours);
  addTimestampFinding(findings, releaseGateSummaryPath, "Release gate summary", gateSummary.generatedAt, args.maxAgeHours);
  addTimestampFinding(findings, dashboardPath, "Release readiness dashboard", dashboard.generatedAt, args.maxAgeHours);

  addRevisionFinding(findings, snapshotPath, "Release readiness snapshot", args.candidateRevision, snapshot.revision?.commit);
  addRevisionFinding(
    findings,
    reconnectPath,
    "Reconnect soak artifact",
    args.candidateRevision,
    reconnect.candidate?.revision ?? reconnect.revision?.commit
  );
  addRevisionFinding(findings, persistencePath, "Phase 1 persistence artifact", args.candidateRevision, persistence.revision?.commit);
  addRevisionFinding(findings, cocosBundlePath, "Cocos RC bundle", args.candidateRevision, cocosBundle.bundle?.commit);
  addRevisionFinding(findings, releaseGateSummaryPath, "Release gate summary", args.candidateRevision, gateSummary.revision?.commit);
  const dashboardRevision = dashboard.goNoGo?.candidateRevision ?? dashboard.inputs?.candidateRevision;
  if (dashboardRevision) {
    addRevisionFinding(findings, dashboardPath, "Release readiness dashboard", args.candidateRevision, dashboardRevision);
  }
  addRevisionFinding(findings, ledgerPath, "Manual evidence owner ledger", args.candidateRevision, ledger.metadata.targetRevision);

  addCandidateFinding(findings, reconnectPath, "Reconnect soak artifact", args.candidate, reconnect.candidate?.name);
  addCandidateFinding(findings, cocosBundlePath, "Cocos RC bundle", args.candidate, cocosBundle.bundle?.candidate);
  addCandidateFinding(findings, ledgerPath, "Manual evidence owner ledger", args.candidate, ledger.metadata.candidate);
  if (dashboard.inputs?.candidate) {
    addCandidateFinding(findings, dashboardPath, "Release readiness dashboard", args.candidate, dashboard.inputs.candidate);
  }

  addLinkedPathFinding(findings, ledgerPath, "Manual evidence owner ledger", snapshotPath, ledger.metadata.linkedReadinessSnapshot);
  addLinkedPathFinding(findings, cocosBundlePath, "Cocos RC bundle", snapshotPath, cocosBundle.linkedEvidence?.releaseReadinessSnapshot?.path);
  addLinkedPathFinding(findings, releaseGateSummaryPath, "Release gate summary", snapshotPath, gateSummary.inputs?.snapshotPath);
  addLinkedPathFinding(findings, dashboardPath, "Release readiness dashboard", snapshotPath, dashboard.inputs?.snapshotPath);
  if (cocosSnapshotPath) {
    addLinkedPathFinding(findings, dashboardPath, "Release readiness dashboard", cocosSnapshotPath, dashboard.inputs?.cocosRcPath);
  }
  addLinkedPathFinding(findings, dashboardPath, "Release readiness dashboard", reconnectPath, dashboard.inputs?.reconnectSoakPath);
  addLinkedPathFinding(findings, dashboardPath, "Release readiness dashboard", persistencePath, dashboard.inputs?.persistencePath);

  const h5Smoke = h5SmokePath && fs.existsSync(h5SmokePath) ? readJson<H5SmokeReport>(h5SmokePath) : undefined;
  if (h5SmokePath && !fs.existsSync(h5SmokePath)) {
    findings.push({
      code: "missing",
      summary: `Required H5 smoke artifact is missing: ${toRelativePath(h5SmokePath)}.`,
      artifactPath: h5SmokePath
    });
  }
  if (h5SmokePath && h5Smoke) {
    addTimestampFinding(findings, h5SmokePath, "H5 smoke artifact", h5Smoke.generatedAt ?? h5Smoke.execution?.finishedAt, args.maxAgeHours);
    addRevisionFinding(findings, h5SmokePath, "H5 smoke artifact", args.candidateRevision, h5Smoke.revision?.commit);
  }

  const wechatCandidateSummary =
    args.wechatCandidateSummaryPath && fs.existsSync(args.wechatCandidateSummaryPath)
      ? readJson<Record<string, unknown>>(args.wechatCandidateSummaryPath)
      : undefined;
  const wechatSmokeReport =
    args.wechatSmokeReportPath && fs.existsSync(args.wechatSmokeReportPath)
      ? readJson<Record<string, unknown>>(args.wechatSmokeReportPath)
      : undefined;

  const manualEvidencePlaceholders = readManualLedger(ledgerPath).rows.map((row) => ({
    id: row.evidenceType,
    label: row.evidenceType,
    path: row.artifactPath ?? "<missing-artifact-path>",
    status: "pending" as const
  }));

  const manifest: EvidenceBundleManifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      status: findings.length === 0 ? "passed" : "failed",
      findingCount: findings.length,
      summary:
        findings.length === 0
          ? `Same-revision Phase 1 evidence bundle is complete for ${args.candidate} at ${args.candidateRevision}.`
          : findings[0]?.summary ?? "Same-revision evidence bundle validation failed."
    },
    candidate: {
      name: args.candidate,
      revision: args.candidateRevision,
      shortRevision: args.candidateRevision.slice(0, 12),
      branch: gitRevision.branch,
      dirty: gitRevision.dirty,
      targetSurface: args.targetSurface,
      buildSurface: args.buildSurface
    },
    bundle: {
      outputDir: toRelativePath(args.outputDir),
      manifestPath: toRelativePath(manifestPath),
      markdownPath: toRelativePath(markdownPath)
    },
    artifacts: {
      releaseReadinessSnapshot: createArtifactRef(snapshotPath, {
        generatedAt: snapshot.generatedAt,
        revision: snapshot.revision?.commit,
        summary: snapshot.summary?.status
      })!,
      ...(h5SmokePath && h5Smoke
        ? {
            h5Smoke: createArtifactRef(h5SmokePath, {
              generatedAt: h5Smoke.generatedAt ?? h5Smoke.execution?.finishedAt,
              revision: h5Smoke.revision?.commit,
              summary: h5Smoke.execution?.status
            })
          }
        : {}),
      reconnectSoak: createArtifactRef(reconnectPath, {
        generatedAt: reconnect.generatedAt,
        revision: reconnect.candidate?.revision ?? reconnect.revision?.commit,
        candidate: reconnect.candidate?.name,
        summary: reconnect.verdict?.summary ?? reconnect.status
      })!,
      phase1Persistence: createArtifactRef(persistencePath, {
        generatedAt: persistence.generatedAt,
        revision: persistence.revision?.commit,
        summary: persistence.summary?.status
      })!,
      releaseGateSummary: createArtifactRef(releaseGateSummaryPath, {
        generatedAt: gateSummary.generatedAt,
        revision: gateSummary.revision?.commit,
        summary: gateSummary.summary?.status
      })!,
      releaseReadinessDashboard: createArtifactRef(dashboardPath, {
        generatedAt: dashboard.generatedAt,
        revision: dashboard.goNoGo?.candidateRevision ?? dashboard.inputs?.candidateRevision,
        candidate: dashboard.inputs?.candidate,
        summary: dashboard.goNoGo?.summary ?? dashboard.overallStatus
      })!,
      cocosRcBundle: createArtifactRef(cocosBundlePath, {
        generatedAt: cocosBundle.bundle?.generatedAt,
        revision: cocosBundle.bundle?.commit,
        candidate: cocosBundle.bundle?.candidate,
        summary: cocosBundle.bundle?.summary ?? cocosBundle.bundle?.overallStatus
      })!,
      ...(cocosSnapshotPath
        ? {
            cocosRcSnapshot: createArtifactRef(cocosSnapshotPath, {
              generatedAt: String((cocosSnapshot as { execution?: { executedAt?: string } }).execution?.executedAt ?? ""),
              revision: String((cocosSnapshot as { candidate?: { commit?: string } }).candidate?.commit ?? "")
            })
          }
        : {}),
      ...(cocosBundle.artifacts?.checklistMarkdown
        ? { cocosRcChecklist: createArtifactRef(path.resolve(cocosBundle.artifacts.checklistMarkdown)) }
        : {}),
      ...(cocosBundle.artifacts?.blockersMarkdown
        ? { cocosRcBlockers: createArtifactRef(path.resolve(cocosBundle.artifacts.blockersMarkdown)) }
        : {}),
      manualEvidenceLedger: createArtifactRef(ledgerPath, {
        generatedAt: ledger.metadata.lastUpdated,
        revision: ledger.metadata.targetRevision,
        candidate: ledger.metadata.candidate,
        summary: `${ledger.rows.length} rows`
      })!,
      ...(runtimePlaceholderPath ? { runtimeObservabilityPlaceholder: createArtifactRef(runtimePlaceholderPath) } : {}),
      ...(args.wechatCandidateSummaryPath && wechatCandidateSummary ? { wechatCandidateSummary: createArtifactRef(args.wechatCandidateSummaryPath) } : {}),
      ...(args.wechatSmokeReportPath && wechatSmokeReport ? { wechatSmokeReport: createArtifactRef(args.wechatSmokeReportPath) } : {})
    },
    manualEvidencePlaceholders,
    downstream: {
      releaseGateSummaryStatus: gateSummary.summary?.status,
      dashboardStatus: dashboard.overallStatus,
      dashboardDecision: dashboard.goNoGo?.decision,
      cocosRcOverallStatus: cocosBundle.bundle?.overallStatus
    },
    validation: {
      maxAgeHours: args.maxAgeHours,
      findings
    }
  };

  writeJson(manifestPath, manifest);
  writeText(markdownPath, renderMarkdown(manifest));

  console.log(`Wrote Phase 1 same-revision evidence manifest: ${toRelativePath(manifestPath)}`);
  console.log(`Wrote Phase 1 same-revision evidence summary: ${toRelativePath(markdownPath)}`);

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`[${finding.code}] ${finding.summary} (${toRelativePath(path.resolve(finding.artifactPath))})`);
    }
    process.exitCode = 1;
  }
}

main();
