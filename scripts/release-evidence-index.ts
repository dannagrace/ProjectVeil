import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type EvidenceStatus = "present" | "warning" | "missing";
type WarningCode = "missing_required" | "stale" | "revision_mismatch" | "candidate_conflict" | "missing_timestamp";

interface Args {
  outputPath?: string;
  markdownOutputPath?: string;
  releaseReadinessDir: string;
  wechatArtifactsDir: string;
  maxAgeHours: number;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface EvidenceWarning {
  code: WarningCode;
  summary: string;
  artifactPath?: string;
}

interface ArtifactMetadata {
  generatedAt?: string;
  revision?: string;
  candidate?: string;
}

interface EvidenceFamilyDefinition {
  id: string;
  label: string;
  directory: "release-readiness" | "wechat-artifacts";
  required: boolean;
  matcher: (entry: string) => boolean;
  readMetadata: (filePath: string) => ArtifactMetadata;
}

export interface EvidenceFamilyReport {
  id: string;
  label: string;
  required: boolean;
  status: EvidenceStatus;
  artifactPath?: string;
  revision?: string;
  candidate?: string;
  generatedAt?: string;
  selectedFrom: "current_revision" | "latest_available" | "missing";
  warnings: EvidenceWarning[];
}

export interface EvidenceIndexReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  candidate: {
    inferred?: string;
    observedCandidates: string[];
  };
  summary: {
    status: "passed" | "warning" | "failed";
    requiredMissingCount: number;
    warningCount: number;
    artifactCount: number;
    summary: string;
  };
  inputs: {
    releaseReadinessDir: string;
    wechatArtifactsDir: string;
    maxAgeHours: number;
  };
  requiredWarnings: EvidenceWarning[];
  artifactFamilies: EvidenceFamilyReport[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_WECHAT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const DEFAULT_MAX_AGE_HOURS = 72;
const HEX_REVISION_PATTERN = /^[a-f0-9]+$/i;

function fail(message: string): never {
  throw new Error(message);
}

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) {
    fail(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout.trim();
}

function readGitRevision(): GitRevision {
  const commit = runGit(["rev-parse", "HEAD"]);
  return {
    commit,
    shortCommit: runGit(["rev-parse", "--short", "HEAD"]),
    branch: runGit(["branch", "--show-current"]),
    dirty: runGit(["status", "--short"]).length > 0,
  };
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let releaseReadinessDir = DEFAULT_RELEASE_READINESS_DIR;
  let wechatArtifactsDir = DEFAULT_WECHAT_ARTIFACTS_DIR;
  let maxAgeHours = DEFAULT_MAX_AGE_HOURS;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

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
    if (arg === "--release-readiness-dir" && next) {
      releaseReadinessDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--wechat-artifacts-dir" && next) {
      wechatArtifactsDir = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--max-age-hours" && next) {
      const parsed = Number.parseInt(next, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`--max-age-hours must be a positive integer. Received: ${next}`);
      }
      maxAgeHours = parsed;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return { outputPath, markdownOutputPath, releaseReadinessDir, wechatArtifactsDir, maxAgeHours };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function normalizeRevision(revision: string | undefined | null): string | undefined {
  const trimmed = revision?.trim().toLowerCase();
  return trimmed && HEX_REVISION_PATTERN.test(trimmed) ? trimmed : undefined;
}

function revisionsMatch(left: string | undefined | null, right: string | undefined | null): boolean {
  const normalizedLeft = normalizeRevision(left);
  const normalizedRight = normalizeRevision(right);
  if (!normalizedLeft || !normalizedRight) {
    return false;
  }
  return normalizedLeft === normalizedRight || normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function getNestedString(value: unknown, pathSegments: string[]): string | undefined {
  let current: unknown = value;
  for (const segment of pathSegments) {
    if (current === null || typeof current !== "object" || !(segment in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" && current.trim() ? current.trim() : undefined;
}

function pickFirstString(value: unknown, paths: string[][]): string | undefined {
  for (const pathSegments of paths) {
    const resolved = getNestedString(value, pathSegments);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function readJsonMetadata(
  filePath: string,
  selectors: {
    generatedAt?: string[][];
    revision?: string[][];
    candidate?: string[][];
  }
): ArtifactMetadata {
  const payload = readJsonFile<unknown>(filePath);
  return {
    generatedAt: selectors.generatedAt ? pickFirstString(payload, selectors.generatedAt) : undefined,
    revision: selectors.revision ? pickFirstString(payload, selectors.revision) : undefined,
    candidate: selectors.candidate ? pickFirstString(payload, selectors.candidate) : undefined,
  };
}

function readManualLedgerMetadata(filePath: string): ArtifactMetadata {
  const content = fs.readFileSync(filePath, "utf8");
  const capture = (label: string): string | undefined => {
    const match = content.match(new RegExp(`^- ${label}:\\s+\`([^\\n\`]+)\``, "m"));
    return match?.[1]?.trim();
  };
  return {
    generatedAt: capture("Last updated"),
    revision: capture("Target revision"),
    candidate: capture("Candidate"),
  };
}

const EVIDENCE_FAMILY_DEFINITIONS: EvidenceFamilyDefinition[] = [
  {
    id: "release-readiness-snapshot",
    label: "Release readiness snapshot",
    directory: "release-readiness",
    required: true,
    matcher: (entry) =>
      entry.endsWith(".json") &&
      entry.startsWith("release-readiness-") &&
      !entry.startsWith("release-readiness-dashboard-"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["revision", "commit"], ["revision", "shortCommit"]],
      }),
  },
  {
    id: "manual-evidence-ledger",
    label: "Manual evidence owner ledger",
    directory: "release-readiness",
    required: true,
    matcher: (entry) => entry.endsWith(".md") && entry.includes("manual-release-evidence-owner-ledger"),
    readMetadata: readManualLedgerMetadata,
  },
  {
    id: "release-gate-summary",
    label: "Release gate summary",
    directory: "release-readiness",
    required: true,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("release-gate-summary"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["revision", "commit"], ["revision", "shortCommit"]],
      }),
  },
  {
    id: "same-candidate-evidence-audit",
    label: "Same-candidate evidence audit",
    directory: "release-readiness",
    required: true,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("same-candidate-evidence-audit-"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["candidate", "revision"]],
        candidate: [["candidate", "name"]],
      }),
  },
  {
    id: "release-readiness-dashboard",
    label: "Release readiness dashboard",
    directory: "release-readiness",
    required: true,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("release-readiness-dashboard"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["goNoGo", "candidateRevision"], ["inputs", "candidateRevision"]],
        candidate: [["inputs", "candidate"]],
      }),
  },
  {
    id: "cocos-rc-evidence-bundle",
    label: "Cocos RC evidence bundle",
    directory: "release-readiness",
    required: true,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("cocos-rc-evidence-bundle-"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["bundle", "generatedAt"]],
        revision: [["bundle", "commit"], ["bundle", "shortCommit"]],
        candidate: [["bundle", "candidate"]],
      }),
  },
  {
    id: "release-health-summary",
    label: "Release health summary",
    directory: "release-readiness",
    required: false,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("release-health-summary"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["candidate", "revision"], ["revision", "commit"], ["revision", "shortCommit"]],
        candidate: [["candidate", "name"]],
      }),
  },
  {
    id: "release-go-no-go-packet",
    label: "Go/no-go decision packet",
    directory: "release-readiness",
    required: false,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("go-no-go-decision-packet-"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["candidate", "revision"], ["revision", "commit"], ["revision", "shortCommit"]],
        candidate: [["candidate", "name"]],
      }),
  },
  {
    id: "release-candidate-reconnect-soak",
    label: "Reconnect soak summary",
    directory: "release-readiness",
    required: false,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("colyseus-reconnect-soak-summary-"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["candidate", "revision"], ["revision", "commit"], ["revision", "shortCommit"]],
        candidate: [["candidate", "name"]],
      }),
  },
  {
    id: "phase1-persistence",
    label: "Phase 1 persistence regression",
    directory: "release-readiness",
    required: false,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("phase1-release-persistence-regression"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["revision", "commit"], ["revision", "shortCommit"]],
      }),
  },
  {
    id: "cocos-primary-journey-evidence",
    label: "Cocos primary journey evidence",
    directory: "release-readiness",
    required: false,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("cocos-primary-journey-evidence-"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"], ["execution", "executedAt"]],
        revision: [["revision", "commit"], ["revision", "shortCommit"], ["candidate", "revision"]],
        candidate: [["candidate", "name"]],
      }),
  },
  {
    id: "cocos-primary-diagnostics",
    label: "Cocos primary diagnostics",
    directory: "release-readiness",
    required: false,
    matcher: (entry) => entry.endsWith(".json") && entry.startsWith("cocos-primary-diagnostic-snapshots-"),
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["revision", "commit"], ["revision", "shortCommit"]],
      }),
  },
  {
    id: "wechat-release-candidate-summary",
    label: "WeChat release candidate summary",
    directory: "wechat-artifacts",
    required: false,
    matcher: (entry) => entry === "codex.wechat.release-candidate-summary.json",
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"]],
        revision: [["candidate", "revision"]],
        candidate: [["candidate", "name"]],
      }),
  },
  {
    id: "wechat-rc-validation-report",
    label: "WeChat RC validation report",
    directory: "wechat-artifacts",
    required: false,
    matcher: (entry) => entry === "codex.wechat.rc-validation-report.json",
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"], ["validation", "generatedAt"]],
        revision: [["candidate", "revision"], ["artifact", "sourceRevision"]],
        candidate: [["candidate", "name"]],
      }),
  },
  {
    id: "wechat-smoke-report",
    label: "WeChat smoke report",
    directory: "wechat-artifacts",
    required: false,
    matcher: (entry) => entry === "codex.wechat.smoke-report.json",
    readMetadata: (filePath) =>
      readJsonMetadata(filePath, {
        generatedAt: [["generatedAt"], ["execution", "executedAt"]],
        revision: [["artifact", "sourceRevision"]],
      }),
  },
];

function resolveDirectoryPath(args: Args, directory: EvidenceFamilyDefinition["directory"]): string {
  return directory === "release-readiness" ? args.releaseReadinessDir : args.wechatArtifactsDir;
}

function resolveArtifactsForFamily(definition: EvidenceFamilyDefinition, args: Args): string[] {
  const directoryPath = resolveDirectoryPath(args, definition.directory);
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  return fs
    .readdirSync(directoryPath)
    .filter((entry) => definition.matcher(entry))
    .map((entry) => path.join(directoryPath, entry))
    .filter((filePath) => fs.statSync(filePath).isFile())
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
}

function isFresh(timestamp: string | undefined, maxAgeHours: number): boolean | "missing" {
  if (!timestamp?.trim()) {
    return "missing";
  }
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed)) {
    return false;
  }
  return Date.now() - parsed <= maxAgeHours * 60 * 60 * 1000;
}

function buildEvidenceFamilyReport(definition: EvidenceFamilyDefinition, gitRevision: GitRevision, args: Args): EvidenceFamilyReport {
  const artifacts = resolveArtifactsForFamily(definition, args);
  if (artifacts.length === 0) {
    return {
      id: definition.id,
      label: definition.label,
      required: definition.required,
      status: "missing",
      selectedFrom: "missing",
      warnings: definition.required
        ? [
            {
              code: "missing_required",
              summary: `${definition.label} is missing for the checked-out revision.`,
            },
          ]
        : [],
    };
  }

  const currentRevisionArtifact = artifacts.find((filePath) => revisionsMatch(definition.readMetadata(filePath).revision, gitRevision.commit));
  const selectedPath = currentRevisionArtifact ?? artifacts[0];
  const metadata = definition.readMetadata(selectedPath);
  const warnings: EvidenceWarning[] = [];

  if (!revisionsMatch(metadata.revision, gitRevision.commit)) {
    warnings.push({
      code: "revision_mismatch",
      summary: `${definition.label} points at revision ${metadata.revision ?? "<missing>"}, not the checked-out revision ${gitRevision.shortCommit}.`,
      artifactPath: selectedPath,
    });
  }

  const freshness = isFresh(metadata.generatedAt, args.maxAgeHours);
  if (freshness === "missing") {
    warnings.push({
      code: "missing_timestamp",
      summary: `${definition.label} is missing a generation timestamp.`,
      artifactPath: selectedPath,
    });
  } else if (freshness === false) {
    warnings.push({
      code: "stale",
      summary: `${definition.label} is older than the ${args.maxAgeHours}h freshness window or has an invalid timestamp (${metadata.generatedAt ?? "<missing>"}).`,
      artifactPath: selectedPath,
    });
  }

  return {
    id: definition.id,
    label: definition.label,
    required: definition.required,
    status: warnings.length === 0 ? "present" : "warning",
    artifactPath: selectedPath,
    revision: metadata.revision,
    candidate: metadata.candidate,
    generatedAt: metadata.generatedAt,
    selectedFrom: currentRevisionArtifact ? "current_revision" : "latest_available",
    warnings,
  };
}

function buildSummary(artifactFamilies: EvidenceFamilyReport[]): EvidenceIndexReport["summary"] {
  const requiredMissingCount = artifactFamilies.filter((family) => family.required && family.status === "missing").length;
  const warningCount = artifactFamilies.reduce((count, family) => count + family.warnings.length, 0);
  const artifactCount = artifactFamilies.filter((family) => family.artifactPath).length;

  const status = requiredMissingCount > 0 ? "failed" : warningCount > 0 ? "warning" : "passed";
  const summary =
    status === "passed"
      ? `Indexed ${artifactCount} artifact families for the checked-out revision with no missing required evidence.`
      : status === "failed"
        ? `Indexed ${artifactCount} artifact families, but ${requiredMissingCount} required evidence families are missing for the checked-out revision.`
        : `Indexed ${artifactCount} artifact families with ${warningCount} warning(s) for freshness or revision alignment.`;

  return { status, requiredMissingCount, warningCount, artifactCount, summary };
}

export function buildReleaseEvidenceIndexReport(args: Args, gitRevision = readGitRevision()): EvidenceIndexReport {
  const artifactFamilies = EVIDENCE_FAMILY_DEFINITIONS.map((definition) => buildEvidenceFamilyReport(definition, gitRevision, args));
  const currentRevisionFamilies = artifactFamilies.filter((family) => revisionsMatch(family.revision, gitRevision.commit));
  const observedCandidates = Array.from(
    new Set(currentRevisionFamilies.map((family) => family.candidate?.trim()).filter((candidate): candidate is string => Boolean(candidate)))
  ).sort((left, right) => left.localeCompare(right));
  const requiredWarnings = artifactFamilies.flatMap((family) =>
    family.required || family.warnings.some((warning) => warning.code === "candidate_conflict") ? family.warnings : []
  );

  if (observedCandidates.length > 1) {
    requiredWarnings.push({
      code: "candidate_conflict",
      summary: `Multiple candidate identifiers were discovered in the current artifact set: ${observedCandidates.join(", ")}.`,
    });
  }

  const summary = buildSummary(
    requiredWarnings.length > artifactFamilies.reduce((count, family) => count + family.warnings.length, 0)
      ? artifactFamilies.concat([
          {
            id: "candidate-consistency",
            label: "Candidate consistency",
            required: true,
            status: "warning",
            selectedFrom: "current_revision",
            warnings: requiredWarnings.filter((warning) => warning.code === "candidate_conflict"),
          },
        ])
      : artifactFamilies
  );
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision: gitRevision,
    candidate: {
      ...(observedCandidates.length === 1 ? { inferred: observedCandidates[0] } : {}),
      observedCandidates,
    },
    summary,
    inputs: {
      releaseReadinessDir: args.releaseReadinessDir,
      wechatArtifactsDir: args.wechatArtifactsDir,
      maxAgeHours: args.maxAgeHours,
    },
    requiredWarnings,
    artifactFamilies,
  };
}

export function renderReleaseEvidenceIndexMarkdown(report: EvidenceIndexReport): string {
  const lines: string[] = [
    "# Current Release Evidence Index",
    "",
    `Generated at: \`${report.generatedAt}\``,
    "",
    "## Summary",
    "",
    `- Overall status: **${report.summary.status.toUpperCase()}**`,
    `- Summary: ${report.summary.summary}`,
    `- Checked-out revision: \`${report.revision.commit}\` (\`${report.revision.shortCommit}\`) on \`${report.revision.branch}\``,
    `- Working tree dirty: \`${report.revision.dirty}\``,
    `- Inferred candidate: \`${report.candidate.inferred ?? "<unresolved>"}\``,
    `- Observed candidates: \`${report.candidate.observedCandidates.join(", ") || "<none>"}\``,
    "",
    "## Reviewer Workflow",
    "",
    "- Start here to confirm the checked-out revision, candidate identifier, and whether any required evidence is missing or stale.",
    "- Open the required artifact families first: release readiness snapshot, gate summary, same-candidate audit, dashboard, manual ledger, and Cocos RC bundle.",
    "- If this index reports warnings, refresh the flagged artifact family before using deeper packet details for release review.",
    "",
    "## Required Warnings",
    "",
  ];

  if (report.requiredWarnings.length === 0) {
    lines.push("- None.");
  } else {
    for (const warning of report.requiredWarnings) {
      lines.push(
        `- \`${warning.code}\` ${warning.summary}${warning.artifactPath ? ` (artifact: \`${toRelativePath(path.resolve(warning.artifactPath))}\`)` : ""}`
      );
    }
  }

  lines.push("");
  lines.push("## Artifact Families");
  lines.push("");
  lines.push("| Artifact family | Required | Status | Selected from | Revision | Candidate | Generated at | Path |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const family of report.artifactFamilies) {
    lines.push(
      `| ${family.label} | ${family.required ? "yes" : "no"} | ${family.status} | ${family.selectedFrom} | \`${family.revision ?? "<missing>"}\` | \`${family.candidate ?? "<n/a>"}\` | \`${family.generatedAt ?? "<missing>"}\` | \`${family.artifactPath ? toRelativePath(family.artifactPath) : "<missing>"}\` |`
    );
  }

  lines.push("");
  for (const family of report.artifactFamilies) {
    lines.push(`### ${family.label}`);
    lines.push("");
    lines.push(`- Required: \`${family.required}\``);
    lines.push(`- Status: \`${family.status}\``);
    lines.push(`- Selected from: \`${family.selectedFrom}\``);
    lines.push(`- Revision: \`${family.revision ?? "<missing>"}\``);
    lines.push(`- Candidate: \`${family.candidate ?? "<n/a>"}\``);
    lines.push(`- Generated at: \`${family.generatedAt ?? "<missing>"}\``);
    lines.push(`- Artifact path: \`${family.artifactPath ? toRelativePath(family.artifactPath) : "<missing>"}\``);
    if (family.warnings.length === 0) {
      lines.push("- Warnings: none.");
    } else {
      lines.push("- Warnings:");
      for (const warning of family.warnings) {
        lines.push(`  - \`${warning.code}\` ${warning.summary}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPath(args: Args, gitRevision: GitRevision): string {
  return args.outputPath ?? path.resolve(args.releaseReadinessDir, `current-release-evidence-index-${gitRevision.shortCommit}.json`);
}

function defaultMarkdownOutputPath(args: Args, gitRevision: GitRevision): string {
  return args.markdownOutputPath ?? path.resolve(args.releaseReadinessDir, `current-release-evidence-index-${gitRevision.shortCommit}.md`);
}

function main(): void {
  const args = parseArgs(process.argv);
  const gitRevision = readGitRevision();
  const report = buildReleaseEvidenceIndexReport(args, gitRevision);
  const outputPath = defaultOutputPath(args, gitRevision);
  const markdownOutputPath = defaultMarkdownOutputPath(args, gitRevision);

  writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFile(markdownOutputPath, renderReleaseEvidenceIndexMarkdown(report));

  console.log(`Wrote current release evidence index JSON: ${toRelativePath(outputPath)}`);
  console.log(`Wrote current release evidence index Markdown: ${toRelativePath(markdownOutputPath)}`);
  console.log(`Overall status: ${report.summary.status}`);
  console.log(`Required missing: ${report.summary.requiredMissingCount}`);
  console.log(`Warnings: ${report.summary.warningCount}`);

  if (report.summary.status === "failed") {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
