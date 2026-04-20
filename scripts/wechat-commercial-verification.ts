import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

type CommercialCheckStatus = "passed" | "failed" | "pending" | "not_applicable";
type CommercialVerificationStatus = "ready" | "blocked";
type EvidenceFreshness = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp";

interface Args {
  artifactsDir: string;
  checksPath?: string;
  wechatCandidateSummaryPath?: string;
  candidate?: string;
  candidateRevision?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  freshnessHours: number;
}

interface AcceptedRiskInput {
  id: string;
  summary: string;
  owner?: string;
  expiresAt?: string;
  artifactPath?: string;
}

interface CommercialCheckInput {
  id: string;
  title: string;
  status?: CommercialCheckStatus;
  required?: boolean;
  notes?: string;
  evidence?: string[];
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  blockerIds?: string[];
  acceptedRisks?: AcceptedRiskInput[];
}

interface WechatCandidateSummary {
  generatedAt?: string;
  candidate?: {
    revision?: string | null;
    version?: string | null;
    status?: "ready" | "blocked";
  };
  blockers?: Array<{
    id?: string;
    summary?: string;
    artifactPath?: string;
    nextCommand?: string;
  }>;
}

interface AcceptedRisk {
  id: string;
  checkId: string;
  summary: string;
  owner?: string;
  expiresAt?: string;
  artifactPath?: string;
}

interface CommercialVerificationCheck {
  id: string;
  title: string;
  status: CommercialCheckStatus;
  required: boolean;
  notes: string;
  evidence: string[];
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  blockerIds: string[];
  acceptedRisks: AcceptedRisk[];
  freshness: EvidenceFreshness;
  metadataStatus: "passed" | "failed";
  metadataFailures: string[];
}

interface CommercialVerificationReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string | null;
    shortRevision: string | null;
    version: string | null;
    status: CommercialVerificationStatus;
  };
  inputs: {
    artifactsDir: string;
    checksPath?: string;
    wechatCandidateSummaryPath: string;
  };
  technicalGate: {
    status: "ready" | "blocked";
    summary: string;
    artifactPath: string;
    blockerCount: number;
  };
  summary: {
    status: CommercialVerificationStatus;
    totalChecks: number;
    completedRequiredChecks: number;
    requiredPendingChecks: number;
    requiredFailedChecks: number;
    requiredMetadataFailures: number;
    blockerCount: number;
    acceptedRiskCount: number;
    conclusion: string;
  };
  blockers: Array<{
    id: string;
    summary: string;
    artifactPath?: string;
    nextStep?: string;
  }>;
  acceptedRisks: AcceptedRisk[];
  checks: CommercialVerificationCheck[];
}

const DEFAULT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const DEFAULT_CHECKS_PATH = "docs/release-evidence/wechat-commercial-verification.example.json";
const DEFAULT_FRESHNESS_HOURS = 24;

const DEFAULT_CHECKS: CommercialCheckInput[] = [
  {
    id: "wechat-payment-e2e",
    title: "WeChat payment end-to-end verified",
    required: true,
    status: "pending",
    notes:
      "Confirm payment initiation, callback, entitlement到账, failure compensation, and fraud/integrity signal capture against the same candidate revision."
  },
  {
    id: "wechat-subscribe-delivery",
    title: "WeChat subscribe-message delivery verified",
    required: true,
    status: "pending",
    notes: "Confirm authorization, send preconditions, delivery outcome, and fallback path for the same candidate revision."
  },
  {
    id: "wechat-analytics-acceptance",
    title: "Commercial analytics acceptance verified",
    required: true,
    status: "pending",
    notes:
      "Confirm the release candidate exposes the required funnel, retention, monetization, and error signals needed for external rollout review."
  },
  {
    id: "wechat-compliance-review",
    title: "Commercial compliance and submission material reviewed",
    required: true,
    status: "pending",
    notes:
      "Confirm privacy, minor-protection wording, customer-feedback entry, and submission notes/materials are aligned to the packaged candidate."
  },
  {
    id: "wechat-device-experience-review",
    title: "Physical-device experience reviewed",
    required: true,
    status: "pending",
    notes:
      "Confirm startup, reconnect, weak-network handling, audio, frame rate, memory, and safe-area/orientation experience on physical-device or equivalent WeChat real-device debugging."
  }
];

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let artifactsDir = DEFAULT_ARTIFACTS_DIR;
  let checksPath: string | undefined;
  let wechatCandidateSummaryPath: string | undefined;
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let freshnessHours = DEFAULT_FRESHNESS_HOURS;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--artifacts-dir" && next) {
      artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--checks" && next) {
      checksPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-candidate-summary" && next) {
      wechatCandidateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--candidate" && next) {
      candidate = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--candidate-revision" && next) {
      candidateRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--markdown" && next) {
      markdownOutputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--freshness-hours" && next) {
      freshnessHours = Number.parseInt(next, 10);
      if (!Number.isFinite(freshnessHours) || freshnessHours <= 0) {
        fail(`--freshness-hours must be a positive integer, received: ${next}`);
      }
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    artifactsDir: path.resolve(artifactsDir),
    ...(checksPath ? { checksPath: path.resolve(checksPath) } : {}),
    ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath: path.resolve(wechatCandidateSummaryPath) } : {}),
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    ...(outputPath ? { outputPath: path.resolve(outputPath) } : {}),
    ...(markdownOutputPath ? { markdownOutputPath: path.resolve(markdownOutputPath) } : {}),
    freshnessHours
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonFile(filePath: string, payload: unknown): void {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeTextFile(filePath: string, contents: string): void {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, contents, "utf8");
}

function getCurrentGitRevision(): string | null {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (result.status !== 0) {
    return null;
  }
  const revision = result.stdout.trim();
  return revision || null;
}

function normalizeStatus(value: unknown, id: string): CommercialCheckStatus {
  if (value === undefined) {
    return "pending";
  }
  if (value === "passed" || value === "failed" || value === "pending" || value === "not_applicable") {
    return value;
  }
  fail(`Unsupported status for commercial check ${id}: ${String(value)}`);
}

function normalizeCheck(entry: CommercialCheckInput): CommercialCheckInput {
  const id = entry.id?.trim();
  const title = entry.title?.trim();
  if (!id) {
    fail("Commercial verification check is missing id.");
  }
  if (!title) {
    fail(`Commercial verification check ${id} is missing title.`);
  }

  return {
    id,
    title,
    required: entry.required ?? true,
    status: normalizeStatus(entry.status, id),
    notes: entry.notes?.trim() ?? "",
    evidence: Array.isArray(entry.evidence)
      ? entry.evidence.map((value) => String(value).trim()).filter((value) => value.length > 0)
      : [],
    ...(entry.owner?.trim() ? { owner: entry.owner.trim() } : {}),
    ...(entry.recordedAt?.trim() ? { recordedAt: entry.recordedAt.trim() } : {}),
    ...(entry.revision?.trim() ? { revision: entry.revision.trim() } : {}),
    ...(entry.artifactPath?.trim() ? { artifactPath: entry.artifactPath.trim() } : {}),
    ...(Array.isArray(entry.blockerIds)
      ? { blockerIds: entry.blockerIds.map((value) => String(value).trim()).filter((value) => value.length > 0) }
      : {}),
    ...(Array.isArray(entry.acceptedRisks)
      ? {
          acceptedRisks: entry.acceptedRisks.map((risk) => {
            const riskId = risk.id?.trim();
            const summary = risk.summary?.trim();
            if (!riskId || !summary) {
              fail(`Commercial check ${id} contains an accepted risk with missing id or summary.`);
            }
            return {
              id: riskId,
              summary,
              ...(risk.owner?.trim() ? { owner: risk.owner.trim() } : {}),
              ...(risk.expiresAt?.trim() ? { expiresAt: risk.expiresAt.trim() } : {}),
              ...(risk.artifactPath?.trim() ? { artifactPath: risk.artifactPath.trim() } : {})
            };
          })
        }
      : {})
  };
}

function readChecks(checksPath?: string): CommercialCheckInput[] {
  const effectivePath = checksPath ?? path.resolve(DEFAULT_CHECKS_PATH);
  if (!fs.existsSync(effectivePath)) {
    return DEFAULT_CHECKS.map((check) => ({ ...check, evidence: [...(check.evidence ?? [])] }));
  }

  const payload = readJsonFile<CommercialCheckInput[] | { checks?: CommercialCheckInput[] }>(effectivePath);
  const rawChecks = Array.isArray(payload) ? payload : payload.checks;
  if (!Array.isArray(rawChecks)) {
    fail(`Commercial check file must be an array or an object with a "checks" array: ${effectivePath}`);
  }

  const normalized = rawChecks.map((entry) => normalizeCheck(entry));
  const byId = new Map<string, CommercialCheckInput>();
  for (const check of normalized) {
    if (byId.has(check.id)) {
      fail(`Duplicate commercial verification check id: ${check.id}`);
    }
    byId.set(check.id, check);
  }

  return DEFAULT_CHECKS.map((baseCheck) => {
    const override = byId.get(baseCheck.id);
    return override
      ? {
          ...baseCheck,
          ...override
        }
      : {
          ...baseCheck,
          evidence: [...(baseCheck.evidence ?? [])]
        };
  });
}

function evaluateFreshness(recordedAt: string | undefined, now: number, maxAgeMs: number): EvidenceFreshness {
  if (!recordedAt) {
    return "missing_timestamp";
  }
  const parsed = Date.parse(recordedAt);
  if (!Number.isFinite(parsed)) {
    return "invalid_timestamp";
  }
  if (now - parsed > maxAgeMs) {
    return "stale";
  }
  return "fresh";
}

function checkMetadataFailures(
  check: CommercialCheckInput,
  candidateRevision: string | null,
  freshness: EvidenceFreshness
): string[] {
  const failures: string[] = [];
  if (check.required !== false && check.status !== "not_applicable") {
    if (!check.owner?.trim()) {
      failures.push("missing owner");
    }
    if (!check.artifactPath?.trim()) {
      failures.push("missing artifact path");
    }
    if (freshness !== "fresh") {
      failures.push(
        freshness === "stale"
          ? "stale recordedAt"
          : freshness === "missing_timestamp"
            ? "missing recordedAt"
            : "invalid recordedAt"
      );
    }
    if (!check.revision?.trim()) {
      failures.push("missing revision");
    } else if (candidateRevision && check.revision.trim() !== candidateRevision) {
      failures.push(`revision mismatch (${check.revision.trim()} != ${candidateRevision})`);
    }
  }
  return failures;
}

function buildCommercialCheck(
  check: CommercialCheckInput,
  candidateRevision: string | null,
  now: number,
  maxAgeMs: number
): CommercialVerificationCheck {
  const freshness = evaluateFreshness(check.recordedAt, now, maxAgeMs);
  const metadataFailures = checkMetadataFailures(check, candidateRevision, freshness);

  return {
    id: check.id,
    title: check.title,
    status: check.status ?? "pending",
    required: check.required ?? true,
    notes: check.notes ?? "",
    evidence: check.evidence ?? [],
    ...(check.owner ? { owner: check.owner } : {}),
    ...(check.recordedAt ? { recordedAt: check.recordedAt } : {}),
    ...(check.revision ? { revision: check.revision } : {}),
    ...(check.artifactPath ? { artifactPath: check.artifactPath } : {}),
    blockerIds: check.blockerIds ?? [],
    acceptedRisks: (check.acceptedRisks ?? []).map((risk) => ({
      id: risk.id,
      checkId: check.id,
      summary: risk.summary,
      ...(risk.owner ? { owner: risk.owner } : {}),
      ...(risk.expiresAt ? { expiresAt: risk.expiresAt } : {}),
      ...(risk.artifactPath ? { artifactPath: risk.artifactPath } : {})
    })),
    freshness,
    metadataStatus: metadataFailures.length === 0 ? "passed" : "failed",
    metadataFailures
  };
}

function readWechatCandidateSummary(filePath: string): WechatCandidateSummary | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return readJsonFile<WechatCandidateSummary>(filePath);
}

function getShortRevision(revision: string | null): string | null {
  return revision ? revision.slice(0, 7) : null;
}

function getDefaultOutputPath(args: Args, revision: string | null): string {
  if (args.outputPath) {
    return args.outputPath;
  }
  const shortRevision = getShortRevision(revision) ?? "unknown";
  return path.join(args.artifactsDir, `codex.wechat.commercial-verification-${shortRevision}.json`);
}

function getDefaultMarkdownPath(outputPath: string, explicitPath?: string): string {
  if (explicitPath) {
    return explicitPath;
  }
  return outputPath.replace(/\.json$/i, ".md");
}

function renderMarkdown(report: CommercialVerificationReport): string {
  const lines: string[] = [];
  lines.push("# WeChat Commercial Verification");
  lines.push("");
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.revision ?? "unknown"}\``);
  lines.push(`- Status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Technical gate: **${report.technicalGate.status.toUpperCase()}**`);
  lines.push(`- Conclusion: ${report.summary.conclusion}`);
  lines.push("");
  lines.push("## Blockers");
  if (report.blockers.length === 0) {
    lines.push("- No blocking commercial verification findings.");
  } else {
    for (const blocker of report.blockers) {
      const artifactSuffix = blocker.artifactPath ? ` (artifact: \`${blocker.artifactPath}\`)` : "";
      const nextStepSuffix = blocker.nextStep ? ` Next: ${blocker.nextStep}` : "";
      lines.push(`- ${blocker.summary}${artifactSuffix}${nextStepSuffix}`);
    }
  }
  lines.push("");
  lines.push("## Accepted Risks");
  if (report.acceptedRisks.length === 0) {
    lines.push("- No accepted commercial risks recorded.");
  } else {
    for (const risk of report.acceptedRisks) {
      const ownerSuffix = risk.owner ? ` owner=${risk.owner}` : "";
      const expirySuffix = risk.expiresAt ? ` expires=${risk.expiresAt}` : "";
      lines.push(`- [${risk.checkId}] ${risk.summary}${ownerSuffix}${expirySuffix}`);
    }
  }
  lines.push("");
  lines.push("## Checks");
  for (const check of report.checks) {
    const metadataSummary =
      check.metadataFailures.length === 0 ? "metadata ok" : `metadata: ${check.metadataFailures.join(", ")}`;
    lines.push(`- ${check.title}: ${check.status} (${metadataSummary})`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function buildReport(args: Args): CommercialVerificationReport {
  const effectiveWechatSummaryPath =
    args.wechatCandidateSummaryPath ?? path.join(args.artifactsDir, "codex.wechat.release-candidate-summary.json");
  const wechatSummary = readWechatCandidateSummary(effectiveWechatSummaryPath);
  const candidateRevision =
    args.candidateRevision ?? wechatSummary?.candidate?.revision?.trim() ?? getCurrentGitRevision();
  const candidateName = args.candidate ?? "wechat-commercial";
  const now = Date.now();
  const maxAgeMs = args.freshnessHours * 60 * 60 * 1000;

  const checks = readChecks(args.checksPath).map((check) => buildCommercialCheck(check, candidateRevision, now, maxAgeMs));
  const acceptedRisks = checks.flatMap((check) => check.acceptedRisks);

  const blockers: CommercialVerificationReport["blockers"] = [];
  const technicalGateReady = wechatSummary?.candidate?.status === "ready";

  if (!wechatSummary) {
    blockers.push({
      id: "technical-gate-missing",
      summary: "Missing WeChat candidate summary; run validate:wechat-rc before commercial verification.",
      artifactPath: effectiveWechatSummaryPath,
      nextStep: "npm run validate -- wechat-rc -- --artifacts-dir <release-artifacts-dir>"
    });
  } else if (!technicalGateReady) {
    blockers.push({
      id: "technical-gate-blocked",
      summary: "WeChat technical gate is not ready; commercial verification cannot promote a blocked candidate.",
      artifactPath: effectiveWechatSummaryPath,
      nextStep: "Resolve codex.wechat.release-candidate-summary.json blockers first."
    });
  }

  for (const check of checks) {
    if (!check.required || check.status === "not_applicable") {
      continue;
    }
    if (check.status === "pending") {
      blockers.push({
        id: `${check.id}-pending`,
        summary: `${check.title} is still pending.`,
        ...(check.artifactPath ? { artifactPath: check.artifactPath } : {}),
        nextStep: "Record owner, revision, artifact path, and the final verification result."
      });
    }
    if (check.status === "failed") {
      blockers.push({
        id: `${check.id}-failed`,
        summary: `${check.title} failed: ${check.notes || "see linked artifact for diagnostics."}`,
        ...(check.artifactPath ? { artifactPath: check.artifactPath } : {})
      });
    }
    if (check.metadataFailures.length > 0) {
      blockers.push({
        id: `${check.id}-metadata`,
        summary: `${check.title} has incomplete evidence metadata: ${check.metadataFailures.join(", ")}.`,
        ...(check.artifactPath ? { artifactPath: check.artifactPath } : {}),
        nextStep: "Backfill owner, recordedAt, revision, and artifact path on the commercial review record."
      });
    }
  }

  const requiredChecks = checks.filter((check) => check.required && check.status !== "not_applicable");
  const completedRequiredChecks = requiredChecks.filter((check) => check.status === "passed" && check.metadataFailures.length === 0).length;
  const requiredPendingChecks = requiredChecks.filter((check) => check.status === "pending").length;
  const requiredFailedChecks = requiredChecks.filter((check) => check.status === "failed").length;
  const requiredMetadataFailures = requiredChecks.filter((check) => check.metadataFailures.length > 0).length;
  const status: CommercialVerificationStatus = blockers.length === 0 ? "ready" : "blocked";

  const technicalGateSummary = !wechatSummary
    ? "WeChat candidate summary is missing."
    : technicalGateReady
      ? "WeChat candidate summary is ready."
      : `WeChat candidate summary remains blocked with ${wechatSummary.blockers?.length ?? 0} blocker(s).`;

  const conclusion =
    status === "ready"
      ? "Commercial verification evidence is complete for external rollout review."
      : "Commercial verification is incomplete or blocked; do not use this candidate for external rollout yet.";

  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    candidate: {
      name: candidateName,
      revision: candidateRevision ?? null,
      shortRevision: getShortRevision(candidateRevision ?? null),
      version: wechatSummary?.candidate?.version ?? null,
      status
    },
    inputs: {
      artifactsDir: args.artifactsDir,
      ...(args.checksPath ? { checksPath: args.checksPath } : {}),
      wechatCandidateSummaryPath: effectiveWechatSummaryPath
    },
    technicalGate: {
      status: technicalGateReady ? "ready" : "blocked",
      summary: technicalGateSummary,
      artifactPath: effectiveWechatSummaryPath,
      blockerCount: wechatSummary?.blockers?.length ?? (technicalGateReady ? 0 : 1)
    },
    summary: {
      status,
      totalChecks: checks.length,
      completedRequiredChecks,
      requiredPendingChecks,
      requiredFailedChecks,
      requiredMetadataFailures,
      blockerCount: blockers.length,
      acceptedRiskCount: acceptedRisks.length,
      conclusion
    },
    blockers,
    acceptedRisks,
    checks
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const report = buildReport(args);
  const outputPath = getDefaultOutputPath(args, report.candidate.revision);
  const markdownPath = getDefaultMarkdownPath(outputPath, args.markdownOutputPath);
  writeJsonFile(outputPath, report);
  writeTextFile(markdownPath, renderMarkdown(report));

  console.log(`Wrote WeChat commercial verification JSON: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`Wrote WeChat commercial verification Markdown: ${path.relative(process.cwd(), markdownPath).replace(/\\/g, "/")}`);
  console.log(`Commercial verification status: ${report.summary.status}`);
}

main();
