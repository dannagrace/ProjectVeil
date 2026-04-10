import fs from "node:fs";
import path from "node:path";

type TargetSurface = "h5" | "wechat";
type DossierResult = "passed" | "failed" | "pending" | "accepted_risk";
type GateStatus = "passed" | "failed";
type ManualCheckStatus = "passed" | "failed" | "pending" | "not_applicable";
type PacketSeverity = "pass" | "warning" | "blocker";
type PacketDecision = "go" | "no_go";

interface Args {
  candidate?: string;
  candidateRevision?: string;
  dossierPath?: string;
  releaseGateSummaryPath?: string;
  wechatArtifactsDir?: string;
  wechatCandidateSummaryPath?: string;
  commercialVerificationPath?: string;
  commercialReviewPath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface Phase1CandidateDossier {
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    dirty: boolean;
    targetSurface: TargetSurface;
  };
  summary: {
    status: DossierResult;
    totalSections: number;
    requiredFailed: string[];
    requiredPending: string[];
    acceptedRiskCount: number;
  };
  phase1ExitEvidenceGate: {
    result: DossierResult;
    summary: string;
    blockingSections: string[];
    pendingSections: string[];
    acceptedRiskSections: string[];
  };
  artifacts?: {
    outputDir: string;
    dossierJsonPath: string;
    dossierMarkdownPath: string;
    runtimeObservabilityDossierPath: string;
    runtimeObservabilityDossierMarkdownPath: string;
    releaseGateSummaryPath: string;
    releaseGateMarkdownPath: string;
    releaseHealthSummaryPath: string;
    releaseHealthMarkdownPath: string;
  };
  sections: Array<{
    id: string;
    label: string;
    required: boolean;
    result: DossierResult;
    summary: string;
    artifactPath?: string;
    observedAt?: string;
    freshness: string;
    revision?: string;
  }>;
}

interface ReleaseGateSummaryReport {
  generatedAt: string;
  targetSurface: TargetSurface;
  summary: {
    status: GateStatus;
    failedGateIds: string[];
  };
  inputs: {
    wechatArtifactsDir?: string;
    wechatCandidateSummaryPath?: string;
  };
  triage: {
    blockers: Array<{
      id: string;
      title: string;
      summary: string;
      nextStep: string;
      artifacts: Array<{
        label: string;
        path: string;
      }>;
    }>;
    warnings: Array<{
      id: string;
      title: string;
      summary: string;
      nextStep: string;
      artifacts: Array<{
        label: string;
        path: string;
      }>;
    }>;
  };
  releaseSurface: {
    status: GateStatus;
    summary: string;
    evidence: Array<{
      id: string;
      label: string;
      required: boolean;
      status: GateStatus;
      summary: string;
      freshness: string;
      observedAt?: string;
      owner?: string;
      revision?: string;
      artifactPath?: string;
      blockerIds: string[];
      waiverReason?: string;
    }>;
  };
}

interface WechatCandidateSummary {
  generatedAt?: string;
  candidate?: {
    revision?: string | null;
    version?: string | null;
    status?: "ready" | "blocked";
  };
  evidence?: {
    manualReview?: {
      status?: "ready" | "blocked";
      requiredPendingChecks?: number;
      requiredFailedChecks?: number;
      requiredMetadataFailures?: number;
      checks?: WechatManualReviewCheck[];
    };
  };
  blockers?: Array<{
    id?: string;
    summary?: string;
    artifactPath?: string;
    nextCommand?: string;
  }>;
}

interface WechatManualReviewCheck {
  id?: string;
  title?: string;
  required?: boolean;
  status?: ManualCheckStatus;
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  notes?: string;
  waiver?: {
    approvedBy?: string;
    approvedAt?: string;
    reason?: string;
    expiresAt?: string;
  };
}

interface CommercialReviewCheck {
  id?: string;
  title?: string;
  category?: "payment" | "subscription" | "analytics" | "compliance" | "device_experience";
  required?: boolean;
  status?: ManualCheckStatus;
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  notes?: string;
  metadataFailures?: string[];
  waiver?: {
    approvedBy?: string;
    approvedAt?: string;
    reason?: string;
    expiresAt?: string;
  };
}

interface CommercialReviewDocument {
  generatedAt?: string;
  candidate?: {
    revision?: string | null;
    version?: string | null;
    status?: "ready" | "blocked";
  };
  summary?: {
    status?: "ready" | "blocked";
    requiredPendingChecks?: number;
    requiredFailedChecks?: number;
    requiredMetadataFailures?: number;
  };
  checks?: CommercialReviewCheck[];
  blockers?: Array<{
    id?: string;
    summary?: string;
    artifactPath?: string;
    nextCommand?: string;
  }>;
}

interface PacketItem {
  id: string;
  title: string;
  severity: PacketSeverity;
  summary: string;
  source: "candidate-dossier" | "release-gate-summary" | "wechat-manual-review" | "commercial-review";
  artifactPath?: string;
  nextStep?: string;
}

interface RuntimeObservabilityLink {
  id: string;
  title: string;
  status: ManualCheckStatus;
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  notes?: string;
}

interface UnresolvedManualCheck {
  id: string;
  title: string;
  status: ManualCheckStatus;
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  notes?: string;
  waiverReason?: string;
}

interface GoNoGoDecisionPacket {
  schemaVersion: 1;
  generatedAt: string;
  decision: {
    status: PacketDecision;
    summary: string;
  };
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    dirty: boolean;
    targetSurface: TargetSurface;
    version?: string;
  };
  inputs: {
    dossierPath: string;
    runtimeObservabilityDossierPath?: string;
    releaseGateSummaryPath: string;
    wechatCandidateSummaryPath?: string;
    commercialReviewPath?: string;
  };
  sections: {
    candidateMetadata: {
      dossierGeneratedAt: string;
      releaseGateGeneratedAt: string;
      wechatCandidateSummaryGeneratedAt?: string;
      commercialReviewGeneratedAt?: string;
    };
    validationSummary: {
      releaseGateStatus: GateStatus;
      phase1ExitEvidenceGate: DossierResult;
      summary: string;
    };
    commercialReadinessSummary: {
      status: "not_provided" | "ready" | "blocked";
      summary: string;
      requiredPendingChecks: number;
      requiredFailedChecks: number;
      requiredMetadataFailures: number;
    };
    blockerSummary: {
      blockers: PacketItem[];
      warnings: PacketItem[];
      passing: PacketItem[];
    };
    runtimeObservabilitySignoffLinks: RuntimeObservabilityLink[];
    unresolvedManualChecks: UnresolvedManualCheck[];
    unresolvedCommercialChecks: UnresolvedManualCheck[];
  };
}

interface CommercialVerificationAcceptedRisk {
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
  status: ManualCheckStatus;
  required: boolean;
  notes: string;
  evidence: string[];
  owner?: string;
  recordedAt?: string;
  revision?: string;
  artifactPath?: string;
  blockerIds: string[];
  acceptedRisks: CommercialVerificationAcceptedRisk[];
  freshness: "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp";
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
    status: "ready" | "blocked";
  };
  technicalGate: {
    status: "ready" | "blocked";
    summary: string;
    artifactPath: string;
    blockerCount: number;
  };
  summary: {
    status: "ready" | "blocked";
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
  acceptedRisks: CommercialVerificationAcceptedRisk[];
  checks: CommercialVerificationCheck[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_WECHAT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const COMMERCIAL_VERIFICATION_FILE_PREFIX = "codex.wechat.commercial-verification";
const COMMERCIAL_REVIEW_LEGACY_FILENAMES = [
  "codex.wechat.commercial-review.json",
  "wechat-commercial-review.json",
  "commercial-review.json"
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let dossierPath: string | undefined;
  let releaseGateSummaryPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let wechatCandidateSummaryPath: string | undefined;
  let commercialVerificationPath: string | undefined;
  let commercialReviewPath: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;

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
    if (arg === "--dossier" && next) {
      dossierPath = next;
      index += 1;
      continue;
    }
    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-artifacts-dir" && next) {
      wechatArtifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-candidate-summary" && next) {
      wechatCandidateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--commercial-verification" && next) {
      commercialVerificationPath = next;
      index += 1;
      continue;
    }
    if (arg === "--commercial-review" && next) {
      commercialReviewPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    ...(dossierPath ? { dossierPath } : {}),
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {}),
    ...(commercialVerificationPath ? { commercialVerificationPath } : {}),
    ...(commercialReviewPath ? { commercialReviewPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function requireExistingFile(filePath: string, label: string, remediation: string): string {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    fail(`${label} is missing at ${toDisplayPath(resolvedPath)}. ${remediation}`);
  }
  return resolvedPath;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function toDisplayPath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function resolveLatestFile(dirPath: string, matcher: (entryPath: string, entryName: string) => boolean): string | undefined {
  if (!fs.existsSync(dirPath)) {
    return undefined;
  }

  const candidates: string[] = [];
  const queue = [dirPath];

  while (queue.length > 0) {
    const currentDir = queue.shift();
    if (!currentDir) {
      continue;
    }
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (matcher(entryPath, entry.name)) {
        candidates.push(entryPath);
      }
    }
  }

  return candidates.sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs)[0];
}

function resolveWechatArtifactsDir(args: Args, releaseGateReportPath?: string): string | undefined {
  if (args.wechatArtifactsDir) {
    return path.resolve(args.wechatArtifactsDir);
  }
  if (releaseGateReportPath) {
    const gateReport = readJsonFile<ReleaseGateSummaryReport>(releaseGateReportPath);
    const fromInputs = gateReport.inputs.wechatArtifactsDir;
    if (fromInputs && fs.existsSync(fromInputs)) {
      return fromInputs;
    }
  }
  return fs.existsSync(DEFAULT_WECHAT_ARTIFACTS_DIR) ? DEFAULT_WECHAT_ARTIFACTS_DIR : undefined;
}

function resolveDossierPath(args: Args): string {
  if (args.dossierPath) {
    return requireExistingFile(
      args.dossierPath,
      "Phase 1 candidate dossier",
      "Run `npm run release:phase1:candidate-dossier -- --candidate <candidate> --candidate-revision <git-sha>` or pass a valid `--dossier <path>`."
    );
  }

  if (args.candidate && args.candidateRevision) {
    const direct = path.join(
      DEFAULT_RELEASE_READINESS_DIR,
      `phase1-candidate-dossier-${args.candidate}-${args.candidateRevision.slice(0, 7)}`,
      "phase1-candidate-dossier.json"
    );
    if (fs.existsSync(direct)) {
      return direct;
    }
  }

  const latest = resolveLatestFile(DEFAULT_RELEASE_READINESS_DIR, (_entryPath, entryName) => entryName === "phase1-candidate-dossier.json");
  if (latest) {
    return latest;
  }

  fail(
    "Phase 1 candidate dossier is required. Run `npm run release:phase1:candidate-dossier -- --candidate <candidate> --candidate-revision <git-sha>` or pass `--dossier <path>`."
  );
}

function resolveReleaseGateSummaryPath(args: Args): string {
  if (args.releaseGateSummaryPath) {
    return requireExistingFile(
      args.releaseGateSummaryPath,
      "Release gate summary",
      "Run `npm run release:gate:summary -- --target-surface wechat` or pass a valid `--release-gate-summary <path>`."
    );
  }

  if (args.candidateRevision) {
    const direct = path.join(DEFAULT_RELEASE_READINESS_DIR, `release-gate-summary-${args.candidateRevision.slice(0, 7)}.json`);
    if (fs.existsSync(direct)) {
      return direct;
    }
  }

  const latest = resolveLatestFile(
    DEFAULT_RELEASE_READINESS_DIR,
    (_entryPath, entryName) => entryName.startsWith("release-gate-summary-") && entryName.endsWith(".json")
  );
  if (latest) {
    return latest;
  }

  fail(
    "Release gate summary is required. Run `npm run release:gate:summary -- --target-surface wechat` or pass `--release-gate-summary <path>`."
  );
}

function resolveWechatCandidateSummaryPath(
  args: Args,
  releaseGateSummaryPath: string,
  dossier: Phase1CandidateDossier
): string | undefined {
  if (args.wechatCandidateSummaryPath) {
    return requireExistingFile(
      args.wechatCandidateSummaryPath,
      "WeChat release candidate summary",
      "Run `npm run validate:wechat-rc -- --artifacts-dir artifacts/wechat-release --expected-revision <git-sha>` or pass a valid `--wechat-candidate-summary <path>`."
    );
  }

  const gateReport = readJsonFile<ReleaseGateSummaryReport>(releaseGateSummaryPath);
  const fromInputs = gateReport.inputs.wechatCandidateSummaryPath;
  if (fromInputs && fs.existsSync(fromInputs)) {
    return fromInputs;
  }

  const wechatArtifactsDir = resolveWechatArtifactsDir(args, releaseGateSummaryPath);
  if (wechatArtifactsDir) {
    const direct = path.join(wechatArtifactsDir, "codex.wechat.release-candidate-summary.json");
    if (fs.existsSync(direct)) {
      return direct;
    }
  }

  if (dossier.candidate.targetSurface === "wechat") {
    fail(
      "WeChat release candidate summary is required for a WeChat go/no-go packet. Run `npm run validate:wechat-rc -- --artifacts-dir artifacts/wechat-release --expected-revision <git-sha>` or pass `--wechat-candidate-summary <path>`."
    );
  }

  return undefined;
}

function resolveCommercialEvidencePath(args: Args, releaseGateSummaryPath: string): string | undefined {
  if (args.commercialVerificationPath) {
    return requireExistingFile(
      args.commercialVerificationPath,
      "Commercial verification evidence",
      "Pass a valid `--commercial-verification <path>` or place `codex.wechat.commercial-verification-<short-sha>.json` under the WeChat artifacts dir."
    );
  }
  if (args.commercialReviewPath) {
    return requireExistingFile(
      args.commercialReviewPath,
      "Commercial evidence",
      "Pass a valid `--commercial-review <path>` or `--commercial-verification <path>`, or place the generated commercial verification/report file under the WeChat artifacts dir."
    );
  }

  const wechatArtifactsDir = resolveWechatArtifactsDir(args, releaseGateSummaryPath);
  if (!wechatArtifactsDir) {
    return undefined;
  }

  const verificationReport = resolveLatestFile(
    wechatArtifactsDir,
    (_entryPath, entryName) =>
      entryName.startsWith(COMMERCIAL_VERIFICATION_FILE_PREFIX) && entryName.endsWith(".json")
  );
  if (verificationReport) {
    return verificationReport;
  }

  for (const fileName of COMMERCIAL_REVIEW_LEGACY_FILENAMES) {
    const candidate = path.join(wechatArtifactsDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function toPacketSeverity(result: DossierResult | GateStatus): PacketSeverity {
  if (result === "failed") {
    return "blocker";
  }
  if (result === "pending" || result === "accepted_risk") {
    return "warning";
  }
  return "pass";
}

function manualCheckSeverity(check: WechatManualReviewCheck): PacketSeverity {
  if (check.status === "failed" || check.status === "pending") {
    return "blocker";
  }
  if (check.waiver?.reason) {
    return "warning";
  }
  return "pass";
}

function commercialCheckSeverity(check: CommercialReviewCheck, metadataFailures: string[]): PacketSeverity {
  if (metadataFailures.length > 0) {
    return "blocker";
  }
  if (check.status === "failed") {
    return "blocker";
  }
  if (check.status === "pending") {
    return check.required === false ? "warning" : "blocker";
  }
  if (check.status === "not_applicable") {
    if (check.required === false) {
      return "pass";
    }
    return check.waiver?.reason ? "warning" : "blocker";
  }
  if (check.waiver?.reason) {
    return "warning";
  }
  return "pass";
}

function normalizeItemId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeCheckCategory(check: CommercialReviewCheck): string {
  switch (check.category) {
    case "payment":
      return "支付";
    case "subscription":
      return "订阅消息";
    case "analytics":
      return "埋点/分析";
    case "compliance":
      return "合规";
    case "device_experience":
      return "真机体验";
    default:
      return "商运";
  }
}

function inferCommercialCategory(input: { id?: string; title?: string; category?: CommercialReviewCheck["category"] }): CommercialReviewCheck["category"] {
  if (input.category) {
    return input.category;
  }

  const haystack = `${input.id ?? ""} ${input.title ?? ""}`.toLowerCase();
  if (haystack.includes("payment")) {
    return "payment";
  }
  if (haystack.includes("subscribe") || haystack.includes("subscription")) {
    return "subscription";
  }
  if (haystack.includes("analytics") || haystack.includes("funnel") || haystack.includes("retention")) {
    return "analytics";
  }
  if (haystack.includes("compliance") || haystack.includes("minor") || haystack.includes("privacy")) {
    return "compliance";
  }
  if (haystack.includes("device") || haystack.includes("audio") || haystack.includes("memory") || haystack.includes("frame")) {
    return "device_experience";
  }
  return undefined;
}

function isCommercialVerificationReport(payload: CommercialReviewDocument | CommercialVerificationReport): payload is CommercialVerificationReport {
  return Array.isArray((payload as CommercialVerificationReport).checks) && "technicalGate" in payload && "summary" in payload;
}

function normalizeCommercialEvidence(
  payload: CommercialReviewDocument | CommercialVerificationReport
): CommercialReviewDocument {
  if (!isCommercialVerificationReport(payload)) {
    return payload;
  }

  return {
    generatedAt: payload.generatedAt,
    candidate: {
      revision: payload.candidate.revision,
      version: payload.candidate.version,
      status: payload.candidate.status
    },
    summary: {
      status: payload.summary.status,
      requiredPendingChecks: payload.summary.requiredPendingChecks,
      requiredFailedChecks: payload.summary.requiredFailedChecks,
      requiredMetadataFailures: payload.summary.requiredMetadataFailures
    },
    checks: payload.checks.map((check) => ({
      id: check.id,
      title: check.title,
      category: inferCommercialCategory(check),
      required: check.required,
      status: check.status,
      owner: check.owner,
      recordedAt: check.recordedAt,
      revision: check.revision,
      artifactPath: check.artifactPath,
      notes: [
        check.notes?.trim() || null,
        check.evidence.length > 0 ? `Evidence: ${check.evidence.join("; ")}` : null
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(" "),
      metadataFailures: check.metadataFailures
    })),
    blockers: payload.blockers.map((blocker) => ({
      id: blocker.id,
      summary: blocker.summary,
      artifactPath: blocker.artifactPath,
      nextCommand: blocker.nextStep
    }))
  };
}

function collectCommercialMetadataFailures(
  check: CommercialReviewCheck,
  candidateRevision: string
): string[] {
  const failures: string[] = [];
  if (check.required === false) {
    return failures;
  }
  if (Array.isArray(check.metadataFailures) && check.metadataFailures.length > 0) {
    return [...check.metadataFailures];
  }
  if (!check.owner?.trim()) {
    failures.push("missing owner");
  }
  if (!check.recordedAt?.trim()) {
    failures.push("missing recordedAt");
  }
  if (!check.revision?.trim()) {
    failures.push("missing revision");
  } else if (check.revision !== candidateRevision) {
    failures.push(`revision mismatch (${check.revision})`);
  }
  if (!check.artifactPath?.trim()) {
    failures.push("missing artifactPath");
  }
  return failures;
}

function summarizeValidation(dossier: Phase1CandidateDossier, releaseGate: ReleaseGateSummaryReport): string {
  const parts = [
    `Phase 1 exit evidence gate is ${dossier.phase1ExitEvidenceGate.result}.`,
    `Release gate summary is ${releaseGate.summary.status}.`
  ];
  if (releaseGate.summary.failedGateIds.length > 0) {
    parts.push(`Failed gates: ${releaseGate.summary.failedGateIds.join(", ")}.`);
  }
  if (dossier.phase1ExitEvidenceGate.pendingSections.length > 0) {
    parts.push(`Pending sections: ${dossier.phase1ExitEvidenceGate.pendingSections.join(", ")}.`);
  }
  if (dossier.phase1ExitEvidenceGate.acceptedRiskSections.length > 0) {
    parts.push(`Accepted-risk sections: ${dossier.phase1ExitEvidenceGate.acceptedRiskSections.join(", ")}.`);
  }
  return parts.join(" ");
}

export function buildGoNoGoDecisionPacket(args: Args): GoNoGoDecisionPacket {
  const dossierPath = resolveDossierPath(args);
  const dossier = readJsonFile<Phase1CandidateDossier>(dossierPath);
  const releaseGateSummaryPath =
    args.releaseGateSummaryPath && fs.existsSync(path.resolve(args.releaseGateSummaryPath))
      ? path.resolve(args.releaseGateSummaryPath)
      : dossier.artifacts?.releaseGateSummaryPath && fs.existsSync(dossier.artifacts.releaseGateSummaryPath)
        ? dossier.artifacts.releaseGateSummaryPath
        : resolveReleaseGateSummaryPath(args);
  const runtimeObservabilityDossierPath =
    dossier.artifacts?.runtimeObservabilityDossierPath && fs.existsSync(dossier.artifacts.runtimeObservabilityDossierPath)
      ? dossier.artifacts.runtimeObservabilityDossierPath
      : undefined;
  const releaseGate = readJsonFile<ReleaseGateSummaryReport>(releaseGateSummaryPath);
  const wechatCandidateSummaryPath = resolveWechatCandidateSummaryPath(args, releaseGateSummaryPath, dossier);
  const wechatCandidateSummary = wechatCandidateSummaryPath
    ? readJsonFile<WechatCandidateSummary>(wechatCandidateSummaryPath)
    : undefined;
  const commercialReviewPath = resolveCommercialEvidencePath(args, releaseGateSummaryPath);
  const commercialReview = commercialReviewPath
    ? normalizeCommercialEvidence(readJsonFile<CommercialReviewDocument | CommercialVerificationReport>(commercialReviewPath))
    : undefined;

  const passing: PacketItem[] = [];
  const warnings: PacketItem[] = [];
  const blockers: PacketItem[] = [];

  const phase1GateItem: PacketItem = {
    id: "phase1-exit-evidence-gate",
    title: "Phase 1 exit evidence gate",
    severity: toPacketSeverity(dossier.phase1ExitEvidenceGate.result),
    summary: dossier.phase1ExitEvidenceGate.summary,
    source: "candidate-dossier",
    artifactPath: dossierPath
  };
  const releaseGateItem: PacketItem = {
    id: "release-gate-summary",
    title: "Release gate summary",
    severity: toPacketSeverity(releaseGate.summary.status),
    summary: releaseGate.releaseSurface.summary,
    source: "release-gate-summary",
    artifactPath: releaseGateSummaryPath
  };

  for (const item of [phase1GateItem, releaseGateItem]) {
    if (item.severity === "blocker") {
      blockers.push(item);
    } else if (item.severity === "warning") {
      warnings.push(item);
    } else {
      passing.push(item);
    }
  }

  for (const warning of releaseGate.triage.warnings) {
    warnings.push({
      id: warning.id,
      title: warning.title,
      severity: "warning",
      summary: warning.summary,
      nextStep: warning.nextStep,
      source: "release-gate-summary",
      artifactPath: warning.artifacts[0]?.path
    });
  }

  for (const blocker of releaseGate.triage.blockers) {
    blockers.push({
      id: blocker.id,
      title: blocker.title,
      severity: "blocker",
      summary: blocker.summary,
      nextStep: blocker.nextStep,
      source: "release-gate-summary",
      artifactPath: blocker.artifacts[0]?.path
    });
  }

  for (const section of dossier.sections.filter((entry) => entry.id !== "phase1-exit-evidence-gate" && entry.required)) {
    const item: PacketItem = {
      id: normalizeItemId(section.id),
      title: section.label,
      severity: toPacketSeverity(section.result),
      summary: section.summary,
      source: "candidate-dossier",
      artifactPath: section.artifactPath
    };
    if (item.severity === "blocker") {
      blockers.push(item);
    } else if (item.severity === "warning") {
      warnings.push(item);
    } else {
      passing.push(item);
    }
  }

  const manualChecks = wechatCandidateSummary?.evidence?.manualReview?.checks?.filter((check) => check.required !== false) ?? [];
  const unresolvedManualChecks = manualChecks
    .filter((check) => check.status === "pending" || check.status === "failed")
    .map<UnresolvedManualCheck>((check) => ({
      id: check.id ?? "manual-check",
      title: check.title ?? check.id ?? "Manual review check",
      status: check.status ?? "pending",
      owner: check.owner,
      recordedAt: check.recordedAt,
      revision: check.revision,
      artifactPath: check.artifactPath,
      notes: check.notes,
      waiverReason: check.waiver?.reason
    }));

  for (const check of manualChecks) {
    const item: PacketItem = {
      id: check.id ?? normalizeItemId(check.title ?? "manual-review"),
      title: check.title ?? check.id ?? "Manual review check",
      severity: manualCheckSeverity(check),
      summary: check.notes ?? `Manual review status is ${check.status ?? "pending"}.`,
      source: "wechat-manual-review",
      artifactPath: check.artifactPath
    };
    if (item.severity === "blocker") {
      blockers.push(item);
    } else if (item.severity === "warning") {
      warnings.push(item);
    } else {
      passing.push(item);
    }
  }

  for (const blocker of wechatCandidateSummary?.blockers ?? []) {
    blockers.push({
      id: blocker.id ?? "wechat-blocker",
      title: blocker.id ?? "WeChat blocker",
      severity: "blocker",
      summary: blocker.summary ?? "WeChat candidate summary reported a blocker.",
      source: "wechat-manual-review",
      artifactPath: blocker.artifactPath,
      nextStep: blocker.nextCommand
    });
  }

  const runtimeObservabilitySignoffLinks = manualChecks
    .filter((check) => {
      const matcher = `${check.id ?? ""} ${check.title ?? ""}`.toLowerCase();
      return matcher.includes("observability");
    })
    .map<RuntimeObservabilityLink>((check) => ({
      id: check.id ?? "runtime-observability-signoff",
      title: check.title ?? check.id ?? "Runtime observability sign-off",
      status: check.status ?? "pending",
      owner: check.owner,
      recordedAt: check.recordedAt,
      revision: check.revision,
      artifactPath: check.artifactPath,
      notes: check.notes
    }));

  const commercialChecks = commercialReview?.checks ?? [];
  const unresolvedCommercialChecks: UnresolvedManualCheck[] = [];
  let commercialRequiredPendingChecks = 0;
  let commercialRequiredFailedChecks = 0;
  let commercialRequiredMetadataFailures = 0;

  for (const check of commercialChecks) {
    const metadataFailures = collectCommercialMetadataFailures(check, dossier.candidate.revision);
    if (check.required !== false) {
      if (check.status === "pending") {
        commercialRequiredPendingChecks += 1;
      }
      if (check.status === "failed") {
        commercialRequiredFailedChecks += 1;
      }
      if (metadataFailures.length > 0) {
        commercialRequiredMetadataFailures += 1;
      }
    }

    const category = normalizeCheckCategory(check);
    const severity = commercialCheckSeverity(check, metadataFailures);
    const detailSummary = [
      `${category}检查状态为 ${check.status ?? "pending"}.`,
      check.notes?.trim() ?? null,
      metadataFailures.length > 0 ? `Metadata: ${metadataFailures.join(", ")}.` : null,
      check.waiver?.reason ? `Waiver: ${check.waiver.reason}` : null
    ]
      .filter((entry): entry is string => Boolean(entry))
      .join(" ");

    const item: PacketItem = {
      id: check.id ? `commercial:${check.id}` : `commercial:${normalizeItemId(check.title ?? category)}`,
      title: `${category} - ${check.title ?? check.id ?? "商业化复核项"}`,
      severity,
      summary: detailSummary,
      source: "commercial-review",
      artifactPath: check.artifactPath
    };

    if (severity === "blocker") {
      blockers.push(item);
    } else if (severity === "warning") {
      warnings.push(item);
    } else {
      passing.push(item);
    }

    if (severity !== "pass") {
      unresolvedCommercialChecks.push({
        id: check.id ?? "commercial-check",
        title: `${category} - ${check.title ?? check.id ?? "商业化复核项"}`,
        status: check.status ?? "pending",
        owner: check.owner,
        recordedAt: check.recordedAt,
        revision: check.revision,
        artifactPath: check.artifactPath,
        notes: detailSummary,
        waiverReason: check.waiver?.reason
      });
    }
  }

  for (const blocker of commercialReview?.blockers ?? []) {
    blockers.push({
      id: blocker.id ? `commercial:${blocker.id}` : "commercial:blocker",
      title: blocker.id ?? "Commercial blocker",
      severity: "blocker",
      summary: blocker.summary ?? "Commercial review reported a blocker.",
      source: "commercial-review",
      artifactPath: blocker.artifactPath,
      nextStep: blocker.nextCommand
    });
  }

  const commercialReadinessStatus =
    !commercialReview
      ? "not_provided"
      : commercialRequiredPendingChecks > 0 || commercialRequiredFailedChecks > 0 || commercialRequiredMetadataFailures > 0 || (commercialReview.blockers?.length ?? 0) > 0
        ? "blocked"
        : "ready";
  const commercialReadinessSummary =
    commercialReadinessStatus === "not_provided"
      ? "No commercial review evidence was attached to this packet."
      : commercialReadinessStatus === "ready"
        ? "Commercial release review is ready for this candidate."
        : `Commercial release review is blocked: pending=${commercialRequiredPendingChecks}, failed=${commercialRequiredFailedChecks}, metadataFailures=${commercialRequiredMetadataFailures}, explicitBlockers=${commercialReview?.blockers?.length ?? 0}.`;

  const decision: PacketDecision = blockers.length > 0 ? "no_go" : "go";
  const decisionSummary =
    decision === "go"
      ? `All blocking release signals are clear for ${dossier.candidate.targetSurface}. Review ${warnings.length} warning item(s) before promotion.`
      : `Blocking release evidence remains for ${dossier.candidate.targetSurface}: ${blockers.length} blocker item(s) must be cleared before promotion.`;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    decision: {
      status: decision,
      summary: decisionSummary
    },
    candidate: {
      name: dossier.candidate.name,
      revision: dossier.candidate.revision,
      shortRevision: dossier.candidate.shortRevision,
      branch: dossier.candidate.branch,
      dirty: dossier.candidate.dirty,
      targetSurface: releaseGate.targetSurface,
      ...(wechatCandidateSummary?.candidate?.version ? { version: wechatCandidateSummary.candidate.version } : {})
    },
    inputs: {
      dossierPath,
      ...(runtimeObservabilityDossierPath ? { runtimeObservabilityDossierPath } : {}),
      releaseGateSummaryPath,
      ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {}),
      ...(commercialReviewPath ? { commercialReviewPath } : {})
    },
    sections: {
      candidateMetadata: {
        dossierGeneratedAt: dossier.generatedAt,
        releaseGateGeneratedAt: releaseGate.generatedAt,
        ...(wechatCandidateSummary?.generatedAt ? { wechatCandidateSummaryGeneratedAt: wechatCandidateSummary.generatedAt } : {}),
        ...(commercialReview?.generatedAt ? { commercialReviewGeneratedAt: commercialReview.generatedAt } : {})
      },
      validationSummary: {
        releaseGateStatus: releaseGate.summary.status,
        phase1ExitEvidenceGate: dossier.phase1ExitEvidenceGate.result,
        summary: summarizeValidation(dossier, releaseGate)
      },
      commercialReadinessSummary: {
        status: commercialReadinessStatus,
        summary: commercialReadinessSummary,
        requiredPendingChecks: commercialRequiredPendingChecks,
        requiredFailedChecks: commercialRequiredFailedChecks,
        requiredMetadataFailures: commercialRequiredMetadataFailures
      },
      blockerSummary: {
        blockers,
        warnings,
        passing
      },
      runtimeObservabilitySignoffLinks,
      unresolvedManualChecks,
      unresolvedCommercialChecks
    }
  };
}

export function renderMarkdown(packet: GoNoGoDecisionPacket): string {
  const lines: string[] = [];

  lines.push("# Release Go/No-Go Decision Packet");
  lines.push("");
  lines.push(`- Decision: \`${packet.decision.status}\``);
  lines.push(`- Candidate: \`${packet.candidate.name}\``);
  lines.push(`- Revision: \`${packet.candidate.revision}\``);
  lines.push(`- Target surface: \`${packet.candidate.targetSurface}\``);
  if (packet.candidate.version) {
    lines.push(`- WeChat version: \`${packet.candidate.version}\``);
  }
  lines.push(`- Branch: \`${packet.candidate.branch}\``);
  lines.push(`- Worktree dirty: \`${packet.candidate.dirty}\``);
  lines.push(`- Generated at: \`${packet.generatedAt}\``);
  lines.push("");
  lines.push("## Decision Summary");
  lines.push("");
  lines.push(packet.decision.summary);
  lines.push("");
  lines.push("## Candidate Metadata");
  lines.push("");
  lines.push(`- Candidate dossier: \`${toDisplayPath(packet.inputs.dossierPath)}\``);
  if (packet.inputs.runtimeObservabilityDossierPath) {
    lines.push(`- Runtime observability dossier: \`${toDisplayPath(packet.inputs.runtimeObservabilityDossierPath)}\``);
  }
  lines.push(`- Release gate summary: \`${toDisplayPath(packet.inputs.releaseGateSummaryPath)}\``);
  if (packet.inputs.wechatCandidateSummaryPath) {
    lines.push(`- WeChat candidate summary: \`${toDisplayPath(packet.inputs.wechatCandidateSummaryPath)}\``);
  }
  if (packet.inputs.commercialReviewPath) {
    lines.push(`- Commercial evidence: \`${toDisplayPath(packet.inputs.commercialReviewPath)}\``);
  }
  lines.push(`- Dossier generated at: \`${packet.sections.candidateMetadata.dossierGeneratedAt}\``);
  lines.push(`- Release gate generated at: \`${packet.sections.candidateMetadata.releaseGateGeneratedAt}\``);
  if (packet.sections.candidateMetadata.wechatCandidateSummaryGeneratedAt) {
    lines.push(`- WeChat candidate summary generated at: \`${packet.sections.candidateMetadata.wechatCandidateSummaryGeneratedAt}\``);
  }
  if (packet.sections.candidateMetadata.commercialReviewGeneratedAt) {
    lines.push(`- Commercial review generated at: \`${packet.sections.candidateMetadata.commercialReviewGeneratedAt}\``);
  }
  lines.push("");
  lines.push("## Validation Summary");
  lines.push("");
  lines.push(`- Phase 1 exit evidence gate: \`${packet.sections.validationSummary.phase1ExitEvidenceGate}\``);
  lines.push(`- Release gate status: \`${packet.sections.validationSummary.releaseGateStatus}\``);
  lines.push(`- Summary: ${packet.sections.validationSummary.summary}`);
  lines.push("");
  lines.push("## Commercial Readiness Summary");
  lines.push("");
  lines.push(`- Status: \`${packet.sections.commercialReadinessSummary.status}\``);
  lines.push(`- Required pending checks: \`${packet.sections.commercialReadinessSummary.requiredPendingChecks}\``);
  lines.push(`- Required failed checks: \`${packet.sections.commercialReadinessSummary.requiredFailedChecks}\``);
  lines.push(`- Required metadata failures: \`${packet.sections.commercialReadinessSummary.requiredMetadataFailures}\``);
  lines.push(`- Summary: ${packet.sections.commercialReadinessSummary.summary}`);
  lines.push("");
  lines.push(`## Blocker Summary (${packet.sections.blockerSummary.blockers.length})`);
  lines.push("");
  if (packet.sections.blockerSummary.blockers.length === 0) {
    lines.push("No blocker items.");
  } else {
    for (const item of packet.sections.blockerSummary.blockers) {
      lines.push(`- ${item.title}: ${item.summary}`);
      if (item.artifactPath) {
        lines.push(`  Artifact: \`${toDisplayPath(path.resolve(item.artifactPath))}\``);
      }
      if (item.nextStep) {
        lines.push(`  Next step: ${item.nextStep}`);
      }
    }
  }
  lines.push("");
  lines.push(`## Warning Summary (${packet.sections.blockerSummary.warnings.length})`);
  lines.push("");
  if (packet.sections.blockerSummary.warnings.length === 0) {
    lines.push("No warning items.");
  } else {
    for (const item of packet.sections.blockerSummary.warnings) {
      lines.push(`- ${item.title}: ${item.summary}`);
      if (item.artifactPath) {
        lines.push(`  Artifact: \`${toDisplayPath(path.resolve(item.artifactPath))}\``);
      }
      if (item.nextStep) {
        lines.push(`  Next step: ${item.nextStep}`);
      }
    }
  }
  lines.push("");
  lines.push(`## Passing Signals (${packet.sections.blockerSummary.passing.length})`);
  lines.push("");
  for (const item of packet.sections.blockerSummary.passing) {
    lines.push(`- ${item.title}: ${item.summary}`);
  }
  lines.push("");
  lines.push("## Runtime Observability Sign-Off Links");
  lines.push("");
  if (packet.sections.runtimeObservabilitySignoffLinks.length === 0) {
    lines.push("No runtime observability sign-off link was found in the current manual-review evidence.");
  } else {
    for (const link of packet.sections.runtimeObservabilitySignoffLinks) {
      lines.push(`- ${link.title}: \`${link.status}\``);
      if (link.artifactPath) {
        lines.push(`  Artifact: \`${link.artifactPath}\``);
      }
      if (link.owner) {
        lines.push(`  Owner: \`${link.owner}\``);
      }
      if (link.recordedAt) {
        lines.push(`  Recorded at: \`${link.recordedAt}\``);
      }
      if (link.notes) {
        lines.push(`  Notes: ${link.notes}`);
      }
    }
  }
  lines.push("");
  lines.push(`## Unresolved Manual Checks (${packet.sections.unresolvedManualChecks.length})`);
  lines.push("");
  if (packet.sections.unresolvedManualChecks.length === 0) {
    lines.push("No unresolved required manual checks.");
  } else {
    for (const check of packet.sections.unresolvedManualChecks) {
      lines.push(`- ${check.title}: \`${check.status}\``);
      if (check.owner) {
        lines.push(`  Owner: \`${check.owner}\``);
      }
      if (check.recordedAt) {
        lines.push(`  Recorded at: \`${check.recordedAt}\``);
      }
      if (check.artifactPath) {
        lines.push(`  Artifact: \`${check.artifactPath}\``);
      }
      if (check.notes) {
        lines.push(`  Notes: ${check.notes}`);
      }
      if (check.waiverReason) {
        lines.push(`  Waiver: ${check.waiverReason}`);
      }
    }
  }

  lines.push("");
  lines.push(`## Unresolved Commercial Checks (${packet.sections.unresolvedCommercialChecks.length})`);
  lines.push("");
  if (packet.sections.unresolvedCommercialChecks.length === 0) {
    lines.push("No unresolved commercial checks.");
  } else {
    for (const check of packet.sections.unresolvedCommercialChecks) {
      lines.push(`- ${check.title}: \`${check.status}\``);
      if (check.owner) {
        lines.push(`  Owner: \`${check.owner}\``);
      }
      if (check.recordedAt) {
        lines.push(`  Recorded at: \`${check.recordedAt}\``);
      }
      if (check.artifactPath) {
        lines.push(`  Artifact: \`${check.artifactPath}\``);
      }
      if (check.notes) {
        lines.push(`  Notes: ${check.notes}`);
      }
      if (check.waiverReason) {
        lines.push(`  Waiver: ${check.waiverReason}`);
      }
    }
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function resolveOutputPaths(packet: GoNoGoDecisionPacket, args: Args): { outputPath: string; markdownOutputPath: string } {
  if (args.outputPath || args.markdownOutputPath) {
    return {
      outputPath:
        args.outputPath ??
        path.resolve(DEFAULT_RELEASE_READINESS_DIR, `go-no-go-decision-packet-${packet.candidate.name}-${packet.candidate.shortRevision}.json`),
      markdownOutputPath:
        args.markdownOutputPath ??
        path.resolve(DEFAULT_RELEASE_READINESS_DIR, `go-no-go-decision-packet-${packet.candidate.name}-${packet.candidate.shortRevision}.md`)
    };
  }

  return {
    outputPath: path.resolve(
      DEFAULT_RELEASE_READINESS_DIR,
      `go-no-go-decision-packet-${packet.candidate.name}-${packet.candidate.shortRevision}.json`
    ),
    markdownOutputPath: path.resolve(
      DEFAULT_RELEASE_READINESS_DIR,
      `go-no-go-decision-packet-${packet.candidate.name}-${packet.candidate.shortRevision}.md`
    )
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const packet = buildGoNoGoDecisionPacket(args);
  const { outputPath, markdownOutputPath } = resolveOutputPaths(packet, args);
  writeJsonFile(outputPath, packet);
  writeFile(markdownOutputPath, renderMarkdown(packet));
  console.log(`Wrote release go/no-go decision packet JSON: ${toDisplayPath(outputPath)}`);
  console.log(`Wrote release go/no-go decision packet Markdown: ${toDisplayPath(markdownOutputPath)}`);
}

const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entrypointPath === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`Release go/no-go decision packet failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
