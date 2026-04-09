import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type GateStatus = "passed" | "failed";
type FindingCode =
  | "missing"
  | "bundle_validation_failed"
  | "candidate_mismatch"
  | "revision_mismatch"
  | "runtime_gate_failed"
  | "runtime_gate_source_mismatch";

interface Args {
  candidate: string;
  candidateRevision: string;
  sameRevisionBundleManifestPath: string;
  runtimeObservabilityGatePath?: string;
  runtimeObservabilityEvidencePath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
}

interface BundleArtifactRef {
  path: string;
  exists: boolean;
  generatedAt?: string;
  revision?: string;
  candidate?: string;
  summary?: string;
}

interface BundleValidationFinding {
  code?: string;
  summary?: string;
  artifactPath?: string;
}

interface SameRevisionBundleManifest {
  generatedAt?: string;
  summary: {
    status?: string;
    findingCount?: number;
    summary?: string;
  };
  candidate: {
    name: string;
    revision: string;
    shortRevision?: string;
    targetSurface?: string;
  };
  artifacts: {
    releaseReadinessSnapshot: BundleArtifactRef;
    cocosRcBundle: BundleArtifactRef;
    manualEvidenceLedger: BundleArtifactRef;
  };
  validation?: {
    findings?: BundleValidationFinding[];
  };
}

interface RuntimeObservabilityGateReport {
  generatedAt?: string;
  candidate?: {
    name?: string;
    revision?: string;
    targetSurface?: string;
  };
  summary?: {
    status?: string;
    headline?: string;
  };
  evidenceSource?: {
    artifactPath: string;
    generatedAt?: string;
  };
}

interface RuntimeObservabilityEvidenceReport {
  generatedAt?: string;
  candidate?: {
    name?: string;
    revision?: string;
    targetSurface?: string;
  };
}

interface ManualEvidenceOwnerLedgerRow {
  evidenceType: string;
  candidate?: string;
  revision?: string;
  status?: string;
  lastUpdated?: string;
  artifactPath?: string;
  notes?: string;
}

interface ManualEvidenceOwnerLedger {
  metadata: {
    candidate?: string;
    targetRevision?: string;
    lastUpdated?: string;
    linkedReadinessSnapshot?: string;
  };
  rows: ManualEvidenceOwnerLedgerRow[];
}

interface DriftFinding {
  code: FindingCode;
  summary: string;
  artifactPath?: string;
}

interface ArtifactFamilyReport {
  id:
    | "phase1-same-revision-evidence-bundle"
    | "release-readiness-snapshot"
    | "cocos-rc-bundle"
    | "manual-evidence-owner-ledger"
    | "runtime-observability-gate"
    | "runtime-observability-evidence";
  label: string;
  artifactPath?: string;
  status: GateStatus;
  findings: DriftFinding[];
}

interface Phase1ReleaseEvidenceDriftGateReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    targetSurface?: string;
  };
  summary: {
    status: GateStatus;
    findingCount: number;
    summary: string;
  };
  inputs: {
    sameRevisionBundleManifestPath: string;
    runtimeObservabilityGatePath?: string;
    runtimeObservabilityEvidencePath?: string;
  };
  artifactFamilies: ArtifactFamilyReport[];
  findings: DriftFinding[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate = "";
  let candidateRevision = "";
  let sameRevisionBundleManifestPath: string | undefined;
  let runtimeObservabilityGatePath: string | undefined;
  let runtimeObservabilityEvidencePath: string | undefined;
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
    if ((arg === "--same-revision-bundle-manifest" || arg === "--manifest") && next) {
      sameRevisionBundleManifestPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--runtime-observability-gate" && next) {
      runtimeObservabilityGatePath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--runtime-observability-evidence" && next) {
      runtimeObservabilityEvidencePath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = path.resolve(next);
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
  if (!sameRevisionBundleManifestPath) {
    fail("Missing required argument: --same-revision-bundle-manifest");
  }

  return {
    candidate,
    candidateRevision,
    sameRevisionBundleManifestPath,
    ...(runtimeObservabilityGatePath ? { runtimeObservabilityGatePath } : {}),
    ...(runtimeObservabilityEvidencePath ? { runtimeObservabilityEvidencePath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function writeJsonFile(filePath: string, payload: unknown): void {
  writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "candidate";
}

function normalizeRevision(value: string | undefined | null): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^[a-f0-9]+$/.test(normalized) ? normalized : undefined;
}

function revisionsMatch(left: string | undefined | null, right: string | undefined | null): boolean {
  const normalizedLeft = normalizeRevision(left);
  const normalizedRight = normalizeRevision(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function resolveArtifactPath(filePath: string | undefined, baseDir: string): string | undefined {
  if (!filePath?.trim()) {
    return undefined;
  }
  return path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
}

function createFinding(code: FindingCode, summary: string, artifactPath?: string): DriftFinding {
  return {
    code,
    summary,
    ...(artifactPath ? { artifactPath: toRelativePath(artifactPath) } : {})
  };
}

function parseManualEvidenceOwnerLedger(filePath: string): ManualEvidenceOwnerLedger {
  const content = fs.readFileSync(filePath, "utf8");
  const capture = (label: string): string | undefined => {
    const match = content.match(new RegExp(`^- ${label}:\\s+\`([^\\n\`]+)\``, "m"));
    return match?.[1]?.trim();
  };

  const rows: ManualEvidenceOwnerLedgerRow[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) {
      continue;
    }
    const columns = line
      .split("|")
      .slice(1, -1)
      .map((entry) => entry.trim());
    if (columns.length !== 8) {
      continue;
    }
    if (columns[0] === "Evidence type" || columns.every((entry) => /^-+$/.test(entry.replace(/\s+/g, "")))) {
      continue;
    }
    rows.push({
      evidenceType: columns[0].replace(/^`|`$/g, ""),
      candidate: columns[1].replace(/^`|`$/g, ""),
      revision: columns[2].replace(/^`|`$/g, ""),
      status: columns[4].replace(/^`|`$/g, ""),
      lastUpdated: columns[5].replace(/^`|`$/g, ""),
      artifactPath: columns[6].replace(/^`|`$/g, ""),
      notes: columns[7]
    });
  }

  return {
    metadata: {
      candidate: capture("Candidate"),
      targetRevision: capture("Target revision"),
      lastUpdated: capture("Last updated"),
      linkedReadinessSnapshot: capture("Linked readiness snapshot")
    },
    rows
  };
}

function maybeAddCandidateFinding(
  findings: DriftFinding[],
  expectedCandidate: string,
  observedCandidate: string | undefined,
  label: string,
  artifactPath?: string
): void {
  if (!observedCandidate?.trim()) {
    return;
  }
  if (observedCandidate.trim() !== expectedCandidate) {
    findings.push(
      createFinding(
        "candidate_mismatch",
        `${label} names candidate ${observedCandidate.trim()}, expected ${expectedCandidate}.`,
        artifactPath
      )
    );
  }
}

function maybeAddRevisionFinding(
  findings: DriftFinding[],
  expectedRevision: string,
  observedRevision: string | undefined,
  label: string,
  artifactPath?: string
): void {
  if (!observedRevision?.trim()) {
    return;
  }
  if (!revisionsMatch(expectedRevision, observedRevision)) {
    findings.push(
      createFinding(
        "revision_mismatch",
        `${label} targets ${observedRevision.trim()}, expected ${expectedRevision}.`,
        artifactPath
      )
    );
  }
}

function maybeAddMissingArtifactFinding(findings: DriftFinding[], artifactPath: string | undefined, label: string): boolean {
  if (artifactPath && fs.existsSync(artifactPath)) {
    return false;
  }
  findings.push(createFinding("missing", `${label} is missing.`, artifactPath));
  return true;
}

function buildSummary(status: GateStatus, findings: DriftFinding[]): string {
  if (status === "passed") {
    return "Phase 1 release evidence drift gate passed for the candidate-scoped packet.";
  }
  return findings[0]?.summary ?? "Phase 1 release evidence drift gate detected blocking evidence drift.";
}

export function buildPhase1ReleaseEvidenceDriftGateReport(args: Args): Phase1ReleaseEvidenceDriftGateReport {
  const manifestPath = args.sameRevisionBundleManifestPath;
  const manifest = readJsonFile<SameRevisionBundleManifest>(manifestPath);
  const manifestDir = path.dirname(manifestPath);

  const findings: DriftFinding[] = [];
  const artifactFamilies: ArtifactFamilyReport[] = [];

  const bundleFindings: DriftFinding[] = [];
  maybeAddCandidateFinding(bundleFindings, args.candidate, manifest.candidate?.name, "Same-revision bundle manifest", manifestPath);
  maybeAddRevisionFinding(bundleFindings, args.candidateRevision, manifest.candidate?.revision, "Same-revision bundle manifest", manifestPath);
  if (manifest.summary.status !== "passed") {
    bundleFindings.push(
      createFinding(
        "bundle_validation_failed",
        `Same-revision bundle manifest is ${manifest.summary.status ?? "unknown"}: ${manifest.summary.summary ?? "no summary provided"}.`,
        manifestPath
      )
    );
  }
  for (const finding of manifest.validation?.findings ?? []) {
    bundleFindings.push(
      createFinding(
        "bundle_validation_failed",
        finding.summary?.trim() || "Same-revision bundle validation reported a failure.",
        resolveArtifactPath(finding.artifactPath, process.cwd()) ?? manifestPath
      )
    );
  }
  artifactFamilies.push({
    id: "phase1-same-revision-evidence-bundle",
    label: "Phase 1 same-revision evidence bundle",
    artifactPath: toRelativePath(manifestPath),
    status: bundleFindings.length === 0 ? "passed" : "failed",
    findings: bundleFindings
  });
  findings.push(...bundleFindings);

  const snapshotPath = resolveArtifactPath(manifest.artifacts.releaseReadinessSnapshot.path, process.cwd());
  const snapshotFindings: DriftFinding[] = [];
  if (!maybeAddMissingArtifactFinding(snapshotFindings, snapshotPath, "Release readiness snapshot")) {
    maybeAddRevisionFinding(
      snapshotFindings,
      args.candidateRevision,
      manifest.artifacts.releaseReadinessSnapshot.revision,
      "Release readiness snapshot",
      snapshotPath
    );
  }
  artifactFamilies.push({
    id: "release-readiness-snapshot",
    label: "Release readiness snapshot",
    artifactPath: snapshotPath ? toRelativePath(snapshotPath) : undefined,
    status: snapshotFindings.length === 0 ? "passed" : "failed",
    findings: snapshotFindings
  });
  findings.push(...snapshotFindings);

  const cocosBundlePath = resolveArtifactPath(manifest.artifacts.cocosRcBundle.path, process.cwd());
  const cocosFindings: DriftFinding[] = [];
  if (!maybeAddMissingArtifactFinding(cocosFindings, cocosBundlePath, "Cocos RC bundle")) {
    maybeAddCandidateFinding(
      cocosFindings,
      args.candidate,
      manifest.artifacts.cocosRcBundle.candidate,
      "Cocos RC bundle",
      cocosBundlePath
    );
    maybeAddRevisionFinding(
      cocosFindings,
      args.candidateRevision,
      manifest.artifacts.cocosRcBundle.revision,
      "Cocos RC bundle",
      cocosBundlePath
    );
  }
  artifactFamilies.push({
    id: "cocos-rc-bundle",
    label: "Cocos RC bundle",
    artifactPath: cocosBundlePath ? toRelativePath(cocosBundlePath) : undefined,
    status: cocosFindings.length === 0 ? "passed" : "failed",
    findings: cocosFindings
  });
  findings.push(...cocosFindings);

  const ledgerPath = resolveArtifactPath(manifest.artifacts.manualEvidenceLedger.path, process.cwd());
  const ledgerFindings: DriftFinding[] = [];
  if (!maybeAddMissingArtifactFinding(ledgerFindings, ledgerPath, "Manual evidence owner ledger")) {
    const ledger = parseManualEvidenceOwnerLedger(ledgerPath!);
    maybeAddCandidateFinding(ledgerFindings, args.candidate, ledger.metadata.candidate, "Manual evidence owner ledger", ledgerPath);
    maybeAddRevisionFinding(
      ledgerFindings,
      args.candidateRevision,
      ledger.metadata.targetRevision,
      "Manual evidence owner ledger",
      ledgerPath
    );

    const linkedSnapshot = resolveArtifactPath(ledger.metadata.linkedReadinessSnapshot, process.cwd());
    if (snapshotPath && linkedSnapshot && path.resolve(snapshotPath) !== path.resolve(linkedSnapshot)) {
      ledgerFindings.push(
        createFinding(
          "revision_mismatch",
          `Manual evidence owner ledger links ${toRelativePath(linkedSnapshot)}, expected ${toRelativePath(snapshotPath)}.`,
          ledgerPath
        )
      );
    }

    for (const row of ledger.rows) {
      maybeAddCandidateFinding(
        ledgerFindings,
        args.candidate,
        row.candidate,
        `Manual evidence owner ledger row ${row.evidenceType}`,
        ledgerPath
      );
      maybeAddRevisionFinding(
        ledgerFindings,
        args.candidateRevision,
        row.revision,
        `Manual evidence owner ledger row ${row.evidenceType}`,
        ledgerPath
      );
    }
  }
  artifactFamilies.push({
    id: "manual-evidence-owner-ledger",
    label: "Manual evidence owner ledger",
    artifactPath: ledgerPath ? toRelativePath(ledgerPath) : undefined,
    status: ledgerFindings.length === 0 ? "passed" : "failed",
    findings: ledgerFindings
  });
  findings.push(...ledgerFindings);

  if (args.runtimeObservabilityGatePath) {
    const gateFindings: DriftFinding[] = [];
    if (!maybeAddMissingArtifactFinding(gateFindings, args.runtimeObservabilityGatePath, "Runtime observability gate")) {
      const runtimeGate = readJsonFile<RuntimeObservabilityGateReport>(args.runtimeObservabilityGatePath);
      maybeAddCandidateFinding(
        gateFindings,
        args.candidate,
        runtimeGate.candidate?.name,
        "Runtime observability gate",
        args.runtimeObservabilityGatePath
      );
      maybeAddRevisionFinding(
        gateFindings,
        args.candidateRevision,
        runtimeGate.candidate?.revision,
        "Runtime observability gate",
        args.runtimeObservabilityGatePath
      );
      if (runtimeGate.summary?.status !== "passed") {
        gateFindings.push(
          createFinding(
            "runtime_gate_failed",
            `Runtime observability gate is ${runtimeGate.summary?.status ?? "unknown"}: ${runtimeGate.summary?.headline ?? "no headline provided"}.`,
            args.runtimeObservabilityGatePath
          )
        );
      }

      const runtimeEvidencePath =
        args.runtimeObservabilityEvidencePath ??
        resolveArtifactPath(runtimeGate.evidenceSource?.artifactPath, args.runtimeObservabilityGatePath ? path.dirname(args.runtimeObservabilityGatePath) : manifestDir);

      if (runtimeEvidencePath) {
        const runtimeEvidenceFindings: DriftFinding[] = [];
        if (!maybeAddMissingArtifactFinding(runtimeEvidenceFindings, runtimeEvidencePath, "Runtime observability evidence")) {
          const runtimeEvidence = readJsonFile<RuntimeObservabilityEvidenceReport>(runtimeEvidencePath);
          maybeAddCandidateFinding(
            runtimeEvidenceFindings,
            args.candidate,
            runtimeEvidence.candidate?.name,
            "Runtime observability evidence",
            runtimeEvidencePath
          );
          maybeAddRevisionFinding(
            runtimeEvidenceFindings,
            args.candidateRevision,
            runtimeEvidence.candidate?.revision,
            "Runtime observability evidence",
            runtimeEvidencePath
          );

          if (runtimeGate.evidenceSource?.artifactPath) {
            const linkedEvidencePath = resolveArtifactPath(runtimeGate.evidenceSource.artifactPath, path.dirname(args.runtimeObservabilityGatePath));
            if (linkedEvidencePath && path.resolve(linkedEvidencePath) !== path.resolve(runtimeEvidencePath)) {
              runtimeEvidenceFindings.push(
                createFinding(
                  "runtime_gate_source_mismatch",
                  `Runtime observability gate links ${toRelativePath(linkedEvidencePath)}, expected ${toRelativePath(runtimeEvidencePath)}.`,
                  args.runtimeObservabilityGatePath
                )
              );
            }
          }

          artifactFamilies.push({
            id: "runtime-observability-evidence",
            label: "Runtime observability evidence",
            artifactPath: toRelativePath(runtimeEvidencePath),
            status: runtimeEvidenceFindings.length === 0 ? "passed" : "failed",
            findings: runtimeEvidenceFindings
          });
          findings.push(...runtimeEvidenceFindings);
        } else {
          artifactFamilies.push({
            id: "runtime-observability-evidence",
            label: "Runtime observability evidence",
            artifactPath: toRelativePath(runtimeEvidencePath),
            status: "failed",
            findings: runtimeEvidenceFindings
          });
          findings.push(...runtimeEvidenceFindings);
        }
      }
    }

    artifactFamilies.push({
      id: "runtime-observability-gate",
      label: "Runtime observability gate",
      artifactPath: toRelativePath(args.runtimeObservabilityGatePath),
      status: gateFindings.length === 0 ? "passed" : "failed",
      findings: gateFindings
    });
    findings.push(...gateFindings);
  }

  const status: GateStatus = findings.length === 0 ? "passed" : "failed";
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate,
      revision: args.candidateRevision,
      shortRevision: args.candidateRevision.slice(0, 12),
      targetSurface: manifest.candidate?.targetSurface
    },
    summary: {
      status,
      findingCount: findings.length,
      summary: buildSummary(status, findings)
    },
    inputs: {
      sameRevisionBundleManifestPath: toRelativePath(manifestPath),
      ...(args.runtimeObservabilityGatePath ? { runtimeObservabilityGatePath: toRelativePath(args.runtimeObservabilityGatePath) } : {}),
      ...(args.runtimeObservabilityEvidencePath ? { runtimeObservabilityEvidencePath: toRelativePath(args.runtimeObservabilityEvidencePath) } : {})
    },
    artifactFamilies,
    findings
  };
}

export function renderMarkdown(report: Phase1ReleaseEvidenceDriftGateReport): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Release Evidence Drift Gate", "");
  lines.push(`- Status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Summary: ${report.summary.summary}`);
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.shortRevision}\``);
  lines.push(`- Same-revision bundle manifest: \`${report.inputs.sameRevisionBundleManifestPath}\``);
  if (report.inputs.runtimeObservabilityGatePath) {
    lines.push(`- Runtime observability gate: \`${report.inputs.runtimeObservabilityGatePath}\``);
  }
  if (report.inputs.runtimeObservabilityEvidencePath) {
    lines.push(`- Runtime observability evidence: \`${report.inputs.runtimeObservabilityEvidencePath}\``);
  }
  lines.push("");

  lines.push("## Artifact Families", "");
  for (const family of report.artifactFamilies) {
    lines.push(`- ${family.label}: \`${family.status}\`${family.artifactPath ? ` via \`${family.artifactPath}\`` : ""}`);
  }
  lines.push("");

  if (report.findings.length > 0) {
    lines.push("## Findings", "");
    for (const finding of report.findings) {
      lines.push(`- [${finding.code}] ${finding.summary}${finding.artifactPath ? ` (${finding.artifactPath})` : ""}`);
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const report = buildPhase1ReleaseEvidenceDriftGateReport(args);
  const jsonPath =
    args.outputPath ??
    path.resolve(
      DEFAULT_RELEASE_READINESS_DIR,
      `phase1-release-evidence-drift-gate-${slugify(args.candidate)}-${args.candidateRevision.slice(0, 12)}.json`
    );
  const markdownPath =
    args.markdownOutputPath ??
    path.resolve(
      DEFAULT_RELEASE_READINESS_DIR,
      `phase1-release-evidence-drift-gate-${slugify(args.candidate)}-${args.candidateRevision.slice(0, 12)}.md`
    );

  writeJsonFile(jsonPath, report);
  writeFile(markdownPath, renderMarkdown(report));

  console.log(`Wrote Phase 1 release evidence drift gate JSON: ${toRelativePath(jsonPath)}`);
  console.log(`Wrote Phase 1 release evidence drift gate Markdown: ${toRelativePath(markdownPath)}`);

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
