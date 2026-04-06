import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildPhase1CandidateDossier } from "./phase1-candidate-dossier.ts";

type TargetSurface = "h5" | "wechat";
type DossierResult = "passed" | "failed" | "pending" | "accepted_risk";
type CriterionStatus = "pass" | "fail" | "pending";
type OverallStatus = CriterionStatus;
type EvidenceFreshness = "fresh" | "stale" | "missing_timestamp" | "invalid_timestamp" | "unknown";

interface Args {
  candidate?: string;
  candidateRevision?: string;
  serverUrl?: string;
  runtimeObservabilityGatePath?: string;
  snapshotPath?: string;
  h5SmokePath?: string;
  reconnectSoakPath?: string;
  wechatArtifactsDir?: string;
  wechatCandidateSummaryPath?: string;
  wechatRcValidationPath?: string;
  wechatSmokeReportPath?: string;
  cocosBundlePath?: string;
  persistencePath?: string;
  syncGovernancePath?: string;
  ciTrendSummaryPath?: string;
  coverageSummaryPath?: string;
  configCenterLibraryPath?: string;
  targetSurface: TargetSurface;
  outputDir?: string;
  outputPath?: string;
  markdownOutputPath?: string;
  maxEvidenceAgeHours: number;
}

interface DossierEvidenceRef {
  label: string;
  path: string;
  summary: string;
  observedAt?: string;
  revision?: string;
  freshness: EvidenceFreshness;
}

interface DossierSection {
  id: string;
  label: string;
  required: boolean;
  result: DossierResult;
  summary: string;
  artifactPath?: string;
  observedAt?: string;
  freshness: EvidenceFreshness;
  revision?: string;
  details: string[];
  evidence: DossierEvidenceRef[];
}

interface DossierAcceptedRisk {
  id: string;
  label: string;
  reason: string;
  approvedBy?: string;
  approvedAt?: string;
  expiresAt?: string;
  artifactPath?: string;
  revision?: string;
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
  inputs: {
    serverUrl?: string;
    runtimeObservabilityGatePath?: string;
    snapshotPath?: string;
    h5SmokePath?: string;
    reconnectSoakPath?: string;
    wechatArtifactsDir?: string;
    wechatCandidateSummaryPath?: string;
    wechatRcValidationPath?: string;
    wechatSmokeReportPath?: string;
    cocosBundlePath?: string;
    persistencePath?: string;
    syncGovernancePath?: string;
    ciTrendSummaryPath?: string;
    coverageSummaryPath?: string;
    configCenterLibraryPath?: string;
  };
  sections: DossierSection[];
  acceptedRisks: DossierAcceptedRisk[];
}

interface SnapshotCheck {
  id?: string;
  title?: string;
  status?: "passed" | "failed" | "pending" | "not_applicable";
  command?: string;
}

interface ReleaseReadinessSnapshot {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  summary?: {
    status?: string;
    requiredFailed?: number;
    requiredPending?: number;
  };
  checks?: SnapshotCheck[];
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
  review?: {
    phase1Gate?: string;
    attachHint?: string;
  };
  journey?: Array<{
    id?: string;
    title?: string;
    status?: string;
  }>;
  requiredEvidence?: Array<{
    id?: string;
    label?: string;
    filled?: boolean;
  }>;
  artifacts?: {
    snapshot?: string;
    summaryMarkdown?: string;
    checklistMarkdown?: string;
    blockersMarkdown?: string;
    presentationSignoff?: string;
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
    };
  };
  blockers?: Array<{
    id?: string;
    summary?: string;
    artifactPath?: string;
  }>;
}

interface PersistenceReport {
  generatedAt?: string;
  revision?: {
    commit?: string;
    shortCommit?: string;
  };
  requestedStorageMode?: string;
  effectiveStorageMode?: string;
  storageDescription?: string;
  summary?: {
    status?: string;
    assertionCount?: number;
  };
  contentValidation?: {
    valid?: boolean;
    summary?: string;
    issueCount?: number;
  };
  persistenceRegression?: {
    mapPackId?: string;
    assertions?: string[];
  };
}

interface SourceArtifact {
  label: string;
  path: string;
}

interface ExitCriterionReport {
  number: number;
  id:
    | "bounded-scope"
    | "core-automated-gates"
    | "release-readiness-snapshot"
    | "cocos-primary-client-evidence"
    | "wechat-release-evidence"
    | "runtime-observability"
    | "phase1-data-persistence"
    | "known-blockers";
  title: string;
  status: CriterionStatus;
  summary: string;
  details: string[];
  sourceArtifacts: SourceArtifact[];
}

interface Phase1ExitAuditReport {
  schemaVersion: 1;
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
    status: OverallStatus;
    blockedCriteria: string[];
    pendingCriteria: string[];
    acceptedRiskCount: number;
    summary: string;
  };
  inputs: Phase1CandidateDossier["inputs"];
  phase1ExitEvidenceGate: Phase1CandidateDossier["phase1ExitEvidenceGate"];
  acceptedRisks: DossierAcceptedRisk[];
  criteria: ExitCriterionReport[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const SCORECARD_DOC_PATH = path.resolve("docs", "phase1-maturity-scorecard.md");
const README_PATH = path.resolve("README.md");
const PHASE1_DESIGN_DOC_PATH = path.resolve("docs", "phase1-design.md");
const COCOS_PRESENTATION_SIGNOFF_DOC_PATH = path.resolve("docs", "cocos-phase1-presentation-signoff.md");
const WECHAT_RELEASE_DOC_PATH = path.resolve("docs", "wechat-minigame-release.md");

const REQUIRED_CORE_GATES = [
  {
    label: "npm test",
    command: "npm test",
    aliases: ["npm-test"]
  },
  {
    label: "npm run typecheck:ci",
    command: "npm run typecheck:ci",
    aliases: ["typecheck-ci"]
  },
  {
    label: "npm run test:e2e:smoke",
    command: "npm run test:e2e:smoke",
    aliases: ["e2e-smoke"]
  },
  {
    label: "npm run test:e2e:multiplayer:smoke",
    command: "npm run test:e2e:multiplayer:smoke",
    aliases: ["e2e-multiplayer-smoke"]
  },
  {
    label: "npm run check:cocos-release-readiness",
    command: "npm run check:cocos-release-readiness",
    aliases: ["cocos-release-readiness", "check-cocos-release-readiness"]
  }
] as const;

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
  let serverUrl: string | undefined;
  let runtimeObservabilityGatePath: string | undefined;
  let snapshotPath: string | undefined;
  let h5SmokePath: string | undefined;
  let reconnectSoakPath: string | undefined;
  let wechatArtifactsDir: string | undefined;
  let wechatCandidateSummaryPath: string | undefined;
  let wechatRcValidationPath: string | undefined;
  let wechatSmokeReportPath: string | undefined;
  let cocosBundlePath: string | undefined;
  let persistencePath: string | undefined;
  let syncGovernancePath: string | undefined;
  let ciTrendSummaryPath: string | undefined;
  let coverageSummaryPath: string | undefined;
  let configCenterLibraryPath: string | undefined;
  let targetSurface: TargetSurface = "wechat";
  let outputDir: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let maxEvidenceAgeHours = 72;

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
    if (arg === "--server-url" && next) {
      serverUrl = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--runtime-observability-gate" && next) {
      runtimeObservabilityGatePath = next;
      index += 1;
      continue;
    }
    if (arg === "--snapshot" && next) {
      snapshotPath = next;
      index += 1;
      continue;
    }
    if (arg === "--h5-smoke" && next) {
      h5SmokePath = next;
      index += 1;
      continue;
    }
    if (arg === "--reconnect-soak" && next) {
      reconnectSoakPath = next;
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
    if (arg === "--wechat-rc-validation" && next) {
      wechatRcValidationPath = next;
      index += 1;
      continue;
    }
    if (arg === "--wechat-smoke-report" && next) {
      wechatSmokeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--cocos-bundle" && next) {
      cocosBundlePath = next;
      index += 1;
      continue;
    }
    if (arg === "--phase1-persistence" && next) {
      persistencePath = next;
      index += 1;
      continue;
    }
    if (arg === "--sync-governance" && next) {
      syncGovernancePath = next;
      index += 1;
      continue;
    }
    if (arg === "--ci-trend-summary" && next) {
      ciTrendSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--coverage-summary" && next) {
      coverageSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--config-center-library" && next) {
      configCenterLibraryPath = next;
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
    if (arg === "--output-dir" && next) {
      outputDir = next;
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
    if (arg === "--max-evidence-age-hours" && next) {
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`--max-evidence-age-hours must be a positive number, received: ${next}`);
      }
      maxEvidenceAgeHours = parsed;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    ...(serverUrl ? { serverUrl } : {}),
    ...(runtimeObservabilityGatePath ? { runtimeObservabilityGatePath } : {}),
    ...(snapshotPath ? { snapshotPath } : {}),
    ...(h5SmokePath ? { h5SmokePath } : {}),
    ...(reconnectSoakPath ? { reconnectSoakPath } : {}),
    ...(wechatArtifactsDir ? { wechatArtifactsDir } : {}),
    ...(wechatCandidateSummaryPath ? { wechatCandidateSummaryPath } : {}),
    ...(wechatRcValidationPath ? { wechatRcValidationPath } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
    ...(cocosBundlePath ? { cocosBundlePath } : {}),
    ...(persistencePath ? { persistencePath } : {}),
    ...(syncGovernancePath ? { syncGovernancePath } : {}),
    ...(ciTrendSummaryPath ? { ciTrendSummaryPath } : {}),
    ...(coverageSummaryPath ? { coverageSummaryPath } : {}),
    ...(configCenterLibraryPath ? { configCenterLibraryPath } : {}),
    targetSurface,
    ...(outputDir ? { outputDir } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    maxEvidenceAgeHours
  };
}

function readJsonFile<T>(filePath: string | undefined): T | undefined {
  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonFile(filePath: string, payload: unknown): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeFile(filePath: string, content: string): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function normalizeStatus(result: DossierResult): CriterionStatus {
  if (result === "failed") {
    return "fail";
  }
  if (result === "pending") {
    return "pending";
  }
  return "pass";
}

function getSection(dossier: Phase1CandidateDossier, id: string): DossierSection {
  const section = dossier.sections.find((entry) => entry.id === id);
  if (!section) {
    fail(`Phase 1 candidate dossier is missing section: ${id}`);
  }
  return section;
}

function uniqueSourceArtifacts(entries: Array<SourceArtifact | undefined>): SourceArtifact[] {
  const seen = new Set<string>();
  const result: SourceArtifact[] = [];
  for (const entry of entries) {
    if (!entry || !entry.path.trim()) {
      continue;
    }
    const key = `${entry.label}::${entry.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function sectionSourceArtifacts(section: DossierSection): SourceArtifact[] {
  return uniqueSourceArtifacts([
    section.artifactPath ? { label: section.label, path: section.artifactPath } : undefined,
    ...section.evidence.map((entry) => ({ label: entry.label, path: entry.path }))
  ]);
}

function resolveOutputPaths(args: Args, dossier: Phase1CandidateDossier): { outputPath: string; markdownOutputPath: string } {
  const outputDir = path.resolve(
    args.outputDir ?? DEFAULT_RELEASE_READINESS_DIR,
    args.outputDir ? "" : "."
  );
  const defaultJsonPath = args.outputDir
    ? path.join(outputDir, "phase1-exit-audit.json")
    : path.join(DEFAULT_RELEASE_READINESS_DIR, `phase1-exit-audit-${slugify(dossier.candidate.name)}-${dossier.candidate.shortRevision}.json`);
  const defaultMarkdownPath = args.outputDir
    ? path.join(outputDir, "phase1-exit-audit.md")
    : path.join(DEFAULT_RELEASE_READINESS_DIR, `phase1-exit-audit-${slugify(dossier.candidate.name)}-${dossier.candidate.shortRevision}.md`);
  return {
    outputPath: path.resolve(args.outputPath ?? defaultJsonPath),
    markdownOutputPath: path.resolve(args.markdownOutputPath ?? defaultMarkdownPath)
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "candidate";
}

function matchRequiredCoreCheck(check: SnapshotCheck, requirement: (typeof REQUIRED_CORE_GATES)[number]): boolean {
  const command = check.command?.trim();
  if (command && command === requirement.command) {
    return true;
  }
  const id = check.id?.trim().toLowerCase();
  return Boolean(id && requirement.aliases.includes(id));
}

function formatCheckStatus(status: SnapshotCheck["status"] | "missing"): string {
  return status ?? "missing";
}

function buildCoreAutomatedGatesCriterion(snapshot: ReleaseReadinessSnapshot | undefined, snapshotPath: string | undefined): ExitCriterionReport {
  const details: string[] = [];
  let status: CriterionStatus = "pass";

  if (!snapshot) {
    return {
      number: 2,
      id: "core-automated-gates",
      title: "Core automated gates are green.",
      status: "fail",
      summary: "Release readiness snapshot is missing, so the required Phase 1 automated gate set cannot be verified.",
      details: ["Missing release readiness snapshot input."],
      sourceArtifacts: uniqueSourceArtifacts([
        snapshotPath ? { label: "Release readiness snapshot", path: snapshotPath } : undefined
      ])
    };
  }

  for (const requirement of REQUIRED_CORE_GATES) {
    const check = snapshot.checks?.find((entry) => matchRequiredCoreCheck(entry, requirement));
    const checkStatus = check?.status ?? "missing";
    details.push(`${requirement.label}: ${formatCheckStatus(checkStatus)}`);
    if (checkStatus === "failed") {
      status = "fail";
      continue;
    }
    if (checkStatus !== "passed" && status !== "fail") {
      status = "pending";
    }
  }

  const summary =
    status === "fail"
      ? "One or more required Phase 1 automated gates failed in the release readiness snapshot."
      : status === "pending"
        ? "At least one required Phase 1 automated gate is missing or not yet marked passed in the release readiness snapshot."
        : "All required Phase 1 automated gates are recorded as passed in the release readiness snapshot.";

  return {
    number: 2,
    id: "core-automated-gates",
    title: "Core automated gates are green.",
    status,
    summary,
    details,
    sourceArtifacts: uniqueSourceArtifacts([
      snapshotPath ? { label: "Release readiness snapshot", path: snapshotPath } : undefined
    ])
  };
}

function buildSnapshotCriterion(snapshot: ReleaseReadinessSnapshot | undefined, snapshotSection: DossierSection): ExitCriterionReport {
  const requiredFailed = snapshot?.summary?.requiredFailed ?? 0;
  const requiredPending = snapshot?.summary?.requiredPending ?? 0;
  const freshness = snapshotSection.freshness;
  let status: CriterionStatus = "pass";

  if (!snapshotSection.artifactPath) {
    status = "fail";
  } else if (requiredFailed > 0 || requiredPending > 0) {
    status = "fail";
  } else if (freshness !== "fresh") {
    status = "pending";
  }

  const details = [
    `snapshotStatus=${snapshot?.summary?.status ?? "missing"}`,
    `requiredFailed=${requiredFailed}`,
    `requiredPending=${requiredPending}`,
    `freshness=${freshness}`
  ];

  const summary =
    status === "fail"
      ? requiredFailed > 0 || requiredPending > 0
        ? "Release readiness snapshot is blocked by required failures or required pending checks."
        : "Release readiness snapshot artifact is missing, so this required exit criterion cannot be verified."
      : status === "pending"
        ? "Release readiness snapshot currently passes required checks, but the linked artifact is stale or missing freshness metadata."
        : "Release readiness snapshot shows no required failed checks, no required pending checks, and the artifact is fresh.";

  return {
    number: 3,
    id: "release-readiness-snapshot",
    title: "Release snapshot status is not blocked by required failures or pending required checks.",
    status,
    summary,
    details,
    sourceArtifacts: sectionSourceArtifacts(snapshotSection)
  };
}

function buildCocosCriterion(section: DossierSection, manifest: CocosRcBundleManifest | undefined): ExitCriterionReport {
  const status = !section.artifactPath ? "fail" : normalizeStatus(section.result);
  const passedJourneyCount = (manifest?.journey ?? []).filter((entry) => entry.status === "passed").length;
  const requiredEvidenceTotal = manifest?.requiredEvidence?.length ?? 0;
  const requiredEvidenceFilled = (manifest?.requiredEvidence ?? []).filter((entry) => entry.filled).length;
  const details = [
    `bundleStatus=${manifest?.bundle?.overallStatus ?? "missing"}`,
    `phase1Gate=${manifest?.review?.phase1Gate ?? "missing"}`,
    `journeyPassed=${passedJourneyCount}/${manifest?.journey?.length ?? 0}`,
    `requiredEvidenceFilled=${requiredEvidenceFilled}/${requiredEvidenceTotal}`,
    `freshness=${section.freshness}`
  ];
  const summary =
    status === "fail"
      ? section.summary
      : status === "pending"
        ? "Candidate-specific Cocos RC evidence exists, but it is stale or still incomplete for the selected revision."
        : "Candidate-specific Cocos RC evidence is current and the linked main-journey bundle is ready for Phase 1 review.";

  return {
    number: 4,
    id: "cocos-primary-client-evidence",
    title: "Cocos primary-client evidence is current.",
    status,
    summary,
    details,
    sourceArtifacts: uniqueSourceArtifacts([
      ...sectionSourceArtifacts(section),
      manifest?.artifacts?.snapshot ? { label: "Cocos RC snapshot", path: manifest.artifacts.snapshot } : undefined,
      manifest?.artifacts?.checklistMarkdown ? { label: "Cocos RC checklist", path: manifest.artifacts.checklistMarkdown } : undefined,
      manifest?.artifacts?.blockersMarkdown ? { label: "Cocos RC blockers", path: manifest.artifacts.blockersMarkdown } : undefined,
      manifest?.artifacts?.presentationSignoff ? { label: "Cocos presentation sign-off", path: manifest.artifacts.presentationSignoff } : undefined,
      { label: "Cocos Phase 1 presentation sign-off baseline", path: COCOS_PRESENTATION_SIGNOFF_DOC_PATH }
    ])
  };
}

function buildWechatCriterion(
  dossier: Phase1CandidateDossier,
  section: DossierSection,
  summaryArtifact: WechatCandidateSummary | undefined
): ExitCriterionReport {
  if (dossier.candidate.targetSurface !== "wechat") {
    return {
      number: 5,
      id: "wechat-release-evidence",
      title: "WeChat release evidence is current when WeChat is the target surface.",
      status: "pass",
      summary: "This candidate targets H5, so WeChat-specific release evidence is not required for the Phase 1 exit call.",
      details: ["targetSurface=h5"],
      sourceArtifacts: uniqueSourceArtifacts([{ label: "WeChat release contract", path: WECHAT_RELEASE_DOC_PATH }])
    };
  }

  const status = !section.artifactPath ? "fail" : normalizeStatus(section.result);
  const details = [
    `candidateStatus=${summaryArtifact?.candidate?.status ?? "missing"}`,
    `requiredPendingChecks=${summaryArtifact?.evidence?.manualReview?.requiredPendingChecks ?? "missing"}`,
    `requiredFailedChecks=${summaryArtifact?.evidence?.manualReview?.requiredFailedChecks ?? "missing"}`,
    `requiredMetadataFailures=${summaryArtifact?.evidence?.manualReview?.requiredMetadataFailures ?? "missing"}`,
    `blockers=${summaryArtifact?.blockers?.length ?? 0}`,
    `freshness=${section.freshness}`
  ];
  const summary =
    status === "fail"
      ? "WeChat is the target surface, and the candidate-level package/verify/smoke/manual-review evidence is still blocked or missing."
      : status === "pending"
        ? "WeChat candidate evidence exists, but it is stale or still incomplete for the selected revision."
        : "WeChat candidate evidence is current for this revision, including the required manual review state.";

  return {
    number: 5,
    id: "wechat-release-evidence",
    title: "WeChat release evidence is current when WeChat is the target surface.",
    status,
    summary,
    details,
    sourceArtifacts: uniqueSourceArtifacts([
      ...sectionSourceArtifacts(section),
      { label: "WeChat release contract", path: WECHAT_RELEASE_DOC_PATH },
      ...((summaryArtifact?.blockers ?? []).flatMap((entry) =>
        entry.artifactPath ? [{ label: entry.id ?? "WeChat blocker artifact", path: entry.artifactPath }] : []
      ))
    ])
  };
}

function buildRuntimeCriterion(dossier: Phase1CandidateDossier, section: DossierSection): ExitCriterionReport {
  const status = dossier.inputs.runtimeObservabilityGatePath || dossier.inputs.serverUrl ? normalizeStatus(section.result) : "fail";
  const details = [
    `runtimeSource=${dossier.inputs.runtimeObservabilityGatePath ?? dossier.inputs.serverUrl ?? "missing"}`,
    `freshness=${section.freshness}`,
    ...section.details
  ];
  const summary =
    status === "fail"
      ? "Runtime observability evidence is missing or blocking for the selected candidate revision."
      : status === "pending"
        ? "Runtime observability evidence exists, but it is stale or still incomplete for the selected candidate revision."
        : "Runtime health, auth-readiness, and metrics evidence is current for the selected candidate revision.";

  return {
    number: 6,
    id: "runtime-observability",
    title: "Runtime observability is proven in the target environment.",
    status,
    summary,
    details,
    sourceArtifacts: uniqueSourceArtifacts([
      ...sectionSourceArtifacts(section),
      dossier.inputs.serverUrl ? { label: "Runtime environment", path: dossier.inputs.serverUrl } : undefined
    ])
  };
}

function buildPersistenceCriterion(section: DossierSection, report: PersistenceReport | undefined): ExitCriterionReport {
  const status = !section.artifactPath ? "fail" : normalizeStatus(section.result);
  const details = [
    `summaryStatus=${report?.summary?.status ?? "missing"}`,
    `verifiedStorage=${report?.effectiveStorageMode ?? "missing"}`,
    `requestedStorage=${report?.requestedStorageMode ?? "missing"}`,
    `contentValid=${report?.contentValidation?.valid ?? "missing"}`,
    `assertions=${report?.summary?.assertionCount ?? "missing"}`,
    `mapPack=${report?.persistenceRegression?.mapPackId ?? "missing"}`,
    `freshness=${section.freshness}`
  ];
  const summary =
    status === "fail"
      ? "Phase 1 persistence or shipped-content evidence is missing or blocking for the selected candidate revision."
      : status === "pending"
        ? "Phase 1 persistence or shipped-content evidence exists, but it is stale for the selected candidate revision."
        : "Phase 1 persistence/content validation evidence is current and the verified storage path is recorded for this candidate revision.";

  return {
    number: 7,
    id: "phase1-data-persistence",
    title: "Phase 1 data and persistence are verified on the intended storage path.",
    status,
    summary,
    details,
    sourceArtifacts: sectionSourceArtifacts(section)
  };
}

function buildKnownBlockersCriterion(dossier: Phase1CandidateDossier): ExitCriterionReport {
  const gate = dossier.phase1ExitEvidenceGate;
  const status: CriterionStatus =
    gate.result === "failed" ? "fail" : gate.result === "pending" ? "pending" : "pass";
  const details = [
    `blockingSections=${gate.blockingSections.length > 0 ? gate.blockingSections.join(", ") : "none"}`,
    `pendingSections=${gate.pendingSections.length > 0 ? gate.pendingSections.join(", ") : "none"}`,
    `acceptedRiskSections=${gate.acceptedRiskSections.length > 0 ? gate.acceptedRiskSections.join(", ") : "none"}`,
    `acceptedRiskCount=${dossier.acceptedRisks.length}`
  ];
  const summary =
    status === "fail"
      ? `Known Phase 1 blockers remain open: ${gate.blockingSections.join(", ")}.`
      : status === "pending"
        ? `Known Phase 1 evidence is still pending for: ${gate.pendingSections.join(", ")}.`
        : dossier.acceptedRisks.length > 0
          ? "Known Phase 1 blockers are either closed or explicitly accepted with recorded waiver context."
          : "No open Phase 1 blocker state remains in the candidate-level evidence gate.";

  const blockingArtifacts = dossier.sections
    .filter((section) => gate.blockingSections.includes(section.label) || gate.pendingSections.includes(section.label) || gate.acceptedRiskSections.includes(section.label))
    .flatMap((section) => sectionSourceArtifacts(section));

  return {
    number: 8,
    id: "known-blockers",
    title: "Known Phase 1 blockers are closed or explicitly accepted.",
    status,
    summary,
    details,
    sourceArtifacts: uniqueSourceArtifacts([
      ...blockingArtifacts,
      { label: "Phase 1 maturity scorecard", path: SCORECARD_DOC_PATH },
      { label: "Cocos Phase 1 presentation sign-off baseline", path: COCOS_PRESENTATION_SIGNOFF_DOC_PATH },
      ...dossier.acceptedRisks.flatMap((risk) =>
        risk.artifactPath ? [{ label: risk.label, path: risk.artifactPath }] : []
      )
    ])
  };
}

export async function buildPhase1ExitAudit(args: Args): Promise<Phase1ExitAuditReport> {
  const dossier = (await buildPhase1CandidateDossier(args)) as Phase1CandidateDossier;
  const snapshotSection = getSection(dossier, "release-readiness");
  const cocosSection = getSection(dossier, "cocos-rc-bundle");
  const wechatSection = getSection(dossier, "wechat-release");
  const runtimeSection = getSection(dossier, "runtime-health");
  const persistenceSection = getSection(dossier, "phase1-persistence");

  const snapshot = readJsonFile<ReleaseReadinessSnapshot>(dossier.inputs.snapshotPath);
  const cocosManifest = readJsonFile<CocosRcBundleManifest>(dossier.inputs.cocosBundlePath);
  const wechatSummary = readJsonFile<WechatCandidateSummary>(dossier.inputs.wechatCandidateSummaryPath);
  const persistenceReport = readJsonFile<PersistenceReport>(dossier.inputs.persistencePath);

  const criteria: ExitCriterionReport[] = [
    {
      number: 1,
      id: "bounded-scope",
      title: "Bounded scope remains intact.",
      status: "pass",
      summary:
        "Phase 1 scope stays anchored to the documented lobby/world/battle/settlement loop. This criterion is inferred from the current repo documentation rather than a candidate-specific automation artifact.",
      details: [
        "Inference: README.md, docs/phase1-design.md, and docs/phase1-maturity-scorecard.md still describe the bounded Phase 1 loop.",
        `targetSurface=${dossier.candidate.targetSurface}`
      ],
      sourceArtifacts: uniqueSourceArtifacts([
        { label: "Repository overview", path: README_PATH },
        { label: "Phase 1 design", path: PHASE1_DESIGN_DOC_PATH },
        { label: "Phase 1 maturity scorecard", path: SCORECARD_DOC_PATH }
      ])
    },
    buildCoreAutomatedGatesCriterion(snapshot, dossier.inputs.snapshotPath),
    buildSnapshotCriterion(snapshot, snapshotSection),
    buildCocosCriterion(cocosSection, cocosManifest),
    buildWechatCriterion(dossier, wechatSection, wechatSummary),
    buildRuntimeCriterion(dossier, runtimeSection),
    buildPersistenceCriterion(persistenceSection, persistenceReport),
    buildKnownBlockersCriterion(dossier)
  ];

  const blockedCriteria = criteria.filter((entry) => entry.status === "fail").map((entry) => `${entry.number}. ${entry.title}`);
  const pendingCriteria = criteria.filter((entry) => entry.status === "pending").map((entry) => `${entry.number}. ${entry.title}`);
  const status: OverallStatus = blockedCriteria.length > 0 ? "fail" : pendingCriteria.length > 0 ? "pending" : "pass";
  const summary =
    status === "fail"
      ? `Phase 1 exit is blocked for ${dossier.candidate.name}: ${blockedCriteria.join("; ")}`
      : status === "pending"
        ? `Phase 1 exit is not yet clear for ${dossier.candidate.name}: ${pendingCriteria.join("; ")}`
        : `Phase 1 exit criteria are currently satisfied for ${dossier.candidate.name} at ${dossier.candidate.shortRevision}.`;

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: dossier.candidate,
    summary: {
      status,
      blockedCriteria,
      pendingCriteria,
      acceptedRiskCount: dossier.acceptedRisks.length,
      summary
    },
    inputs: dossier.inputs,
    phase1ExitEvidenceGate: dossier.phase1ExitEvidenceGate,
    acceptedRisks: dossier.acceptedRisks,
    criteria
  };
}

function formatStatus(status: CriterionStatus | OverallStatus): string {
  return status.toUpperCase();
}

export function renderMarkdown(report: Phase1ExitAuditReport): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Exit Audit", "");
  lines.push(`- Generated at: \`${report.generatedAt}\``);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.revision}\``);
  lines.push(`- Branch: \`${report.candidate.branch}\``);
  lines.push(`- Git tree: \`${report.candidate.dirty ? "dirty" : "clean"}\``);
  lines.push(`- Target surface: \`${report.candidate.targetSurface}\``);
  lines.push(`- Overall status: **${formatStatus(report.summary.status)}**`);
  lines.push(`- Summary: ${report.summary.summary}`);
  lines.push(`- Accepted risks: ${report.summary.acceptedRiskCount}`, "");

  lines.push("## Inputs", "");
  lines.push(`- Release readiness snapshot: \`${report.inputs.snapshotPath ?? "<missing>"}\``);
  lines.push(`- Cocos RC bundle: \`${report.inputs.cocosBundlePath ?? "<missing>"}\``);
  lines.push(`- WeChat candidate summary: \`${report.inputs.wechatCandidateSummaryPath ?? "<missing>"}\``);
  lines.push(`- Runtime observability gate: \`${report.inputs.runtimeObservabilityGatePath ?? report.inputs.serverUrl ?? "<missing>"}\``);
  lines.push(`- Reconnect soak: \`${report.inputs.reconnectSoakPath ?? "<missing>"}\``);
  lines.push(`- Phase 1 persistence: \`${report.inputs.persistencePath ?? "<missing>"}\``, "");

  lines.push("## Exit Criteria", "");
  for (const criterion of report.criteria) {
    lines.push(`### ${criterion.number}. ${criterion.title}`, "");
    lines.push(`- Status: \`${criterion.status}\``);
    lines.push(`- Summary: ${criterion.summary}`);
    if (criterion.details.length > 0) {
      lines.push("- Details:");
      for (const detail of criterion.details) {
        lines.push(`  - ${detail}`);
      }
    }
    if (criterion.sourceArtifacts.length > 0) {
      lines.push("- Source artifacts:");
      for (const source of criterion.sourceArtifacts) {
        lines.push(`  - ${source.label}: \`${source.path}\``);
      }
    }
    lines.push("");
  }

  lines.push("## Candidate Gate", "");
  lines.push(`- Result: \`${report.phase1ExitEvidenceGate.result}\``);
  lines.push(`- Summary: ${report.phase1ExitEvidenceGate.summary}`);
  lines.push(
    `- Blocking sections: ${report.phase1ExitEvidenceGate.blockingSections.length > 0 ? report.phase1ExitEvidenceGate.blockingSections.join(", ") : "none"}`
  );
  lines.push(
    `- Pending sections: ${report.phase1ExitEvidenceGate.pendingSections.length > 0 ? report.phase1ExitEvidenceGate.pendingSections.join(", ") : "none"}`
  );
  lines.push(
    `- Accepted-risk sections: ${report.phase1ExitEvidenceGate.acceptedRiskSections.length > 0 ? report.phase1ExitEvidenceGate.acceptedRiskSections.join(", ") : "none"}`
  );
  lines.push("");

  lines.push("## Accepted Risks", "");
  if (report.acceptedRisks.length === 0) {
    lines.push("- None.");
  } else {
    for (const risk of report.acceptedRisks) {
      const metadata = [risk.approvedBy ? `approvedBy=${risk.approvedBy}` : "", risk.approvedAt ? `approvedAt=${risk.approvedAt}` : ""]
        .filter((value) => value.length > 0)
        .join(" ");
      lines.push(`- ${risk.label}: ${risk.reason}${metadata ? ` (${metadata})` : ""}`);
      if (risk.artifactPath) {
        lines.push(`  Artifact: \`${risk.artifactPath}\``);
      }
    }
  }
  lines.push("");

  return `${lines.join("\n").trim()}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const report = await buildPhase1ExitAudit(args);
  const outputPaths = resolveOutputPaths(args, {
    candidate: report.candidate,
    inputs: report.inputs,
    generatedAt: report.generatedAt,
    summary: {
      status: report.summary.status === "pass" ? "passed" : report.summary.status === "fail" ? "failed" : "pending",
      requiredFailed: [],
      requiredPending: [],
      acceptedRiskCount: report.summary.acceptedRiskCount
    },
    phase1ExitEvidenceGate: report.phase1ExitEvidenceGate,
    sections: [],
    acceptedRisks: report.acceptedRisks
  } as Phase1CandidateDossier);

  writeJsonFile(outputPaths.outputPath, report);
  writeFile(outputPaths.markdownOutputPath, renderMarkdown(report));

  console.log(`Phase 1 exit audit ${formatStatus(report.summary.status)}`);
  console.log(`Candidate: ${report.candidate.name}`);
  console.log(`Revision: ${report.candidate.revision}`);
  console.log(`JSON: ${path.relative(process.cwd(), outputPaths.outputPath).replace(/\\/g, "/")}`);
  console.log(`Markdown: ${path.relative(process.cwd(), outputPaths.markdownOutputPath).replace(/\\/g, "/")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Phase 1 exit audit failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
