import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type Mode = "dry-run" | "apply";
type ArtifactKind = "file" | "directory";
type LifecycleAction = "retain" | "archive" | "cleanup";

interface Args {
  releaseReadinessDir: string;
  wechatArtifactsDir: string;
  archiveDir: string;
  outputPath?: string;
  markdownOutputPath?: string;
  retentionDays: number;
  archiveRetentionDays: number;
  keepLatestPerFamily: number;
  mode: Mode;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface ArtifactFamilyDefinition {
  id: string;
  label: string;
  reviewerFacing: boolean;
  matcher: (name: string, kind: ArtifactKind) => boolean;
}

interface ManagedSource {
  id: "release-readiness" | "phase1-candidate-rehearsal" | "wechat-release";
  label: string;
  directoryPath: string;
  archiveRelativePath: string;
  listUnits: (directoryPath: string) => ArtifactUnit[];
}

interface ArtifactUnitMember {
  path: string;
  relativePath: string;
  kind: ArtifactKind;
  mtimeMs: number;
}

interface ArtifactUnit {
  key: string;
  displayName: string;
  sourceId: ManagedSource["id"];
  sourceLabel: string;
  familyId: string;
  familyLabel: string;
  reviewerFacing: boolean;
  members: ArtifactUnitMember[];
  mtimeMs: number;
}

interface ManagedArtifactAction {
  action: Exclude<LifecycleAction, "cleanup">;
  sourceId: ManagedSource["id"];
  sourceLabel: string;
  familyId: string;
  familyLabel: string;
  reviewerFacing: boolean;
  displayName: string;
  ageDays: number;
  reasons: string[];
  livePaths: string[];
  archivePaths: string[];
}

interface ArchiveCleanupCandidate {
  action: "cleanup";
  runName: string;
  ageDays: number;
  livePath: string;
  reasons: string[];
}

interface LifecycleReport {
  schemaVersion: 1;
  generatedAt: string;
  mode: Mode;
  revision: GitRevision;
  policy: {
    retentionDays: number;
    archiveRetentionDays: number;
    keepLatestPerFamily: number;
    archiveDir: string;
  };
  summary: {
    retainedCount: number;
    archiveCandidateCount: number;
    archivedCount: number;
    cleanupCandidateCount: number;
    cleanedUpCount: number;
    reviewerEntryPointCount: number;
    summary: string;
  };
  reviewerEntryPoints: ManagedArtifactAction[];
  retained: ManagedArtifactAction[];
  archiveCandidates: ManagedArtifactAction[];
  archived: ManagedArtifactAction[];
  cleanupCandidates: ArchiveCleanupCandidate[];
  cleanedUp: ArchiveCleanupCandidate[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const DEFAULT_WECHAT_ARTIFACTS_DIR = path.resolve("artifacts", "wechat-release");
const DEFAULT_ARCHIVE_DIR = path.resolve("artifacts", "release-archive");
const DEFAULT_RETENTION_DAYS = 14;
const DEFAULT_ARCHIVE_RETENTION_DAYS = 90;
const DEFAULT_KEEP_LATEST_PER_FAMILY = 2;
const KNOWN_TEXT_EXTENSIONS = new Set([".json", ".md", ".txt"]);

const FAMILY_DEFINITIONS: ArtifactFamilyDefinition[] = [
  {
    id: "candidate-evidence-manifest",
    label: "Candidate evidence manifest",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("candidate-evidence-manifest-"),
  },
  {
    id: "current-release-evidence-index",
    label: "Current release evidence index",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("current-release-evidence-index-"),
  },
  {
    id: "release-gate-summary",
    label: "Release gate summary",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("release-gate-summary-"),
  },
  {
    id: "release-readiness-dashboard",
    label: "Release readiness dashboard",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("release-readiness-dashboard-"),
  },
  {
    id: "release-readiness-snapshot",
    label: "Release readiness snapshot",
    reviewerFacing: true,
    matcher: (name, kind) =>
      kind === "file" && name.startsWith("release-readiness-") && !name.startsWith("release-readiness-dashboard-"),
  },
  {
    id: "candidate-evidence-audit",
    label: "Candidate evidence audit",
    reviewerFacing: true,
    matcher: (name, kind) =>
      kind === "file" &&
      (name.startsWith("candidate-evidence-audit-") || name.startsWith("same-candidate-evidence-audit-")),
  },
  {
    id: "candidate-evidence-freshness-guard",
    label: "Candidate evidence freshness guard",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("candidate-evidence-freshness-guard-"),
  },
  {
    id: "manual-evidence-ledger",
    label: "Manual evidence owner ledger",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.includes("manual-release-evidence-owner-ledger"),
  },
  {
    id: "release-health-summary",
    label: "Release health summary",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("release-health-summary-"),
  },
  {
    id: "go-no-go-packet",
    label: "Go/no-go decision packet",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("go-no-go-decision-packet-"),
  },
  {
    id: "cocos-rc-evidence-bundle",
    label: "Cocos RC evidence bundle",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("cocos-rc-evidence-bundle-"),
  },
  {
    id: "runtime-observability-bundle",
    label: "Runtime observability bundle",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "directory" && name.startsWith("runtime-observability-bundle-"),
  },
  {
    id: "phase1-candidate-dossier",
    label: "Phase 1 candidate dossier",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "directory" && name.startsWith("phase1-candidate-dossier-"),
  },
  {
    id: "phase1-same-revision-bundle",
    label: "Phase 1 same-revision evidence bundle",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "directory" && name.startsWith("phase1-same-revision-evidence-bundle-"),
  },
  {
    id: "phase1-candidate-rehearsal-packet",
    label: "Phase 1 candidate rehearsal packet",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "directory",
  },
  {
    id: "runtime-observability-evidence",
    label: "Runtime observability evidence",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.startsWith("runtime-observability-evidence-"),
  },
  {
    id: "runtime-observability-gate",
    label: "Runtime observability gate",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.startsWith("runtime-observability-gate-"),
  },
  {
    id: "release-candidate-reconnect-soak",
    label: "Reconnect soak summary",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.startsWith("colyseus-reconnect-soak-summary-"),
  },
  {
    id: "cocos-primary-journey-evidence",
    label: "Cocos primary journey evidence",
    reviewerFacing: false,
    matcher: (name, kind) =>
      (kind === "file" && name.startsWith("cocos-primary-journey-evidence-")) ||
      (kind === "directory" && name.startsWith("cocos-primary-journey-")),
  },
  {
    id: "cocos-primary-diagnostics",
    label: "Cocos primary diagnostics",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.startsWith("cocos-primary-diagnostic-snapshots-"),
  },
  {
    id: "phase1-exit-audit",
    label: "Phase 1 exit audit",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.startsWith("phase1-exit-audit-"),
  },
  {
    id: "phase1-evidence-drift-gate",
    label: "Phase 1 evidence drift gate",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.startsWith("phase1-release-evidence-drift-gate-"),
  },
  {
    id: "phase1-exit-dossier-freshness-gate",
    label: "Phase 1 exit-dossier freshness gate",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.startsWith("phase1-exit-dossier-freshness-gate-"),
  },
  {
    id: "wechat-release-summary",
    label: "WeChat release candidate summary",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("codex.wechat.release-candidate-summary"),
  },
  {
    id: "wechat-validation-report",
    label: "WeChat RC validation report",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("codex.wechat.rc-validation-report"),
  },
  {
    id: "wechat-install-launch-evidence",
    label: "WeChat install/launch evidence",
    reviewerFacing: true,
    matcher: (name, kind) => kind === "file" && name.startsWith("codex.wechat.install-launch-evidence"),
  },
  {
    id: "wechat-smoke-report",
    label: "WeChat smoke report",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.startsWith("codex.wechat.smoke-report"),
  },
  {
    id: "wechat-package",
    label: "WeChat package metadata",
    reviewerFacing: false,
    matcher: (name, kind) => kind === "file" && name.endsWith(".package.json"),
  },
  {
    id: "wechat-review-support",
    label: "WeChat manual review support",
    reviewerFacing: false,
    matcher: (name, kind) =>
      kind === "file" &&
      (name === "checklist-review.json" ||
        name === "device-runtime-review.json" ||
        name === "runtime-observability-signoff.json"),
  },
];

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
  return {
    commit: runGit(["rev-parse", "HEAD"]),
    shortCommit: runGit(["rev-parse", "--short", "HEAD"]),
    branch: runGit(["branch", "--show-current"]),
    dirty: runGit(["status", "--short"]).length > 0,
  };
}

function parsePositiveInteger(flag: string, value: string | undefined): number {
  if (!value) {
    fail(`${flag} requires a value.`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    fail(`${flag} must be a positive integer. Received: ${value}`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Args {
  let releaseReadinessDir = DEFAULT_RELEASE_READINESS_DIR;
  let wechatArtifactsDir = DEFAULT_WECHAT_ARTIFACTS_DIR;
  let archiveDir = DEFAULT_ARCHIVE_DIR;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let retentionDays = DEFAULT_RETENTION_DAYS;
  let archiveRetentionDays = DEFAULT_ARCHIVE_RETENTION_DAYS;
  let keepLatestPerFamily = DEFAULT_KEEP_LATEST_PER_FAMILY;
  let mode: Mode = "dry-run";

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--release-readiness-dir") {
      releaseReadinessDir = path.resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--wechat-artifacts-dir") {
      wechatArtifactsDir = path.resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--archive-dir") {
      archiveDir = path.resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--output") {
      outputPath = path.resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--markdown-output") {
      markdownOutputPath = path.resolve(next ?? "");
      index += 1;
      continue;
    }
    if (arg === "--retention-days") {
      retentionDays = parsePositiveInteger(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--archive-retention-days") {
      archiveRetentionDays = parsePositiveInteger(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--keep-latest-per-family") {
      keepLatestPerFamily = parsePositiveInteger(arg, next);
      index += 1;
      continue;
    }
    if (arg === "--apply") {
      mode = "apply";
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    releaseReadinessDir,
    wechatArtifactsDir,
    archiveDir,
    outputPath,
    markdownOutputPath,
    retentionDays,
    archiveRetentionDays,
    keepLatestPerFamily,
    mode,
  };
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function ensureDirectory(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath: string, content: string): void {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function stripKnownTextExtension(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  return KNOWN_TEXT_EXTENSIONS.has(extension) ? fileName.slice(0, -extension.length) : fileName;
}

function createMember(rootDir: string, name: string): ArtifactUnitMember | undefined {
  const fullPath = path.join(rootDir, name);
  if (!fs.existsSync(fullPath)) {
    return undefined;
  }
  const stat = fs.statSync(fullPath);
  return {
    path: fullPath,
    relativePath: name.replace(/\\/g, "/"),
    kind: stat.isDirectory() ? "directory" : "file",
    mtimeMs: stat.mtimeMs,
  };
}

function groupTopLevelEntries(rootDir: string, names: string[]): ArtifactUnitMember[][] {
  const groups = new Map<string, ArtifactUnitMember[]>();
  for (const name of names.sort()) {
    const member = createMember(rootDir, name);
    if (!member) {
      continue;
    }
    const groupKey = member.kind === "file" ? stripKnownTextExtension(name) : name;
    const group = groups.get(groupKey) ?? [];
    group.push(member);
    groups.set(groupKey, group);
  }
  return [...groups.values()];
}

function buildTopLevelUnits(rootDir: string, source: ManagedSource, names: string[]): ArtifactUnit[] {
  return groupTopLevelEntries(rootDir, names).map((members) => buildArtifactUnit(source, members));
}

function resolveFamily(name: string, kind: ArtifactKind): ArtifactFamilyDefinition {
  return (
    FAMILY_DEFINITIONS.find((definition) => definition.matcher(name, kind)) ?? {
      id: kind === "directory" ? "misc-directory" : "misc-file",
      label: kind === "directory" ? "Miscellaneous support directory" : "Miscellaneous support file",
      reviewerFacing: false,
      matcher: () => true,
    }
  );
}

function buildArtifactUnit(source: ManagedSource, members: ArtifactUnitMember[]): ArtifactUnit {
  const displayName = members[0]?.relativePath ?? fail(`Cannot build artifact unit without members for ${source.id}.`);
  const family = resolveFamily(displayName, members[0]?.kind ?? "file");
  return {
    key: `${source.id}:${stripKnownTextExtension(displayName)}`,
    displayName,
    sourceId: source.id,
    sourceLabel: source.label,
    familyId: family.id,
    familyLabel: family.label,
    reviewerFacing: family.reviewerFacing,
    members,
    mtimeMs: Math.max(...members.map((member) => member.mtimeMs)),
  };
}

function listReleaseReadinessUnits(directoryPath: string): ArtifactUnit[] {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }
  const excluded = new Set(["capacity-planning", "phase1-candidate-rehearsal"]);
  const names = fs
    .readdirSync(directoryPath)
    .filter((name) => !excluded.has(name))
    .filter((name) => !name.startsWith("release-evidence-lifecycle-report-"));
  return buildTopLevelUnits(directoryPath, SOURCES[0], names);
}

function listPhase1RehearsalUnits(directoryPath: string): ArtifactUnit[] {
  if (!fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
    return [];
  }
  const names = fs.readdirSync(directoryPath);
  return buildTopLevelUnits(directoryPath, SOURCES[1], names);
}

function listWechatReleaseUnits(directoryPath: string): ArtifactUnit[] {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }
  const names = fs.readdirSync(directoryPath).filter((name) => !name.startsWith("release-evidence-lifecycle-report-"));
  return buildTopLevelUnits(directoryPath, SOURCES[2], names);
}

const SOURCES: ManagedSource[] = [
  {
    id: "release-readiness",
    label: "Release readiness live directory",
    directoryPath: DEFAULT_RELEASE_READINESS_DIR,
    archiveRelativePath: "release-readiness",
    listUnits: listReleaseReadinessUnits,
  },
  {
    id: "phase1-candidate-rehearsal",
    label: "Phase 1 rehearsal packet directory",
    directoryPath: path.join(DEFAULT_RELEASE_READINESS_DIR, "phase1-candidate-rehearsal"),
    archiveRelativePath: path.join("release-readiness", "phase1-candidate-rehearsal"),
    listUnits: listPhase1RehearsalUnits,
  },
  {
    id: "wechat-release",
    label: "WeChat release live directory",
    directoryPath: DEFAULT_WECHAT_ARTIFACTS_DIR,
    archiveRelativePath: "wechat-release",
    listUnits: listWechatReleaseUnits,
  },
];

function ageDaysFrom(nowMs: number, mtimeMs: number): number {
  return Number(((nowMs - mtimeMs) / (24 * 60 * 60 * 1000)).toFixed(2));
}

function buildArchivePath(runDirectory: string, source: ManagedSource, relativePath: string): string {
  return path.join(runDirectory, source.archiveRelativePath, relativePath);
}

function planLiveArtifactActions(
  args: Args,
  now: Date,
  runDirectory: string,
  sources: ManagedSource[]
): { retained: ManagedArtifactAction[]; archiveCandidates: ManagedArtifactAction[] } {
  const retained: ManagedArtifactAction[] = [];
  const archiveCandidates: ManagedArtifactAction[] = [];
  const nowMs = now.getTime();

  for (const source of sources) {
    const units = source.listUnits(source.directoryPath);
    const byFamily = new Map<string, ArtifactUnit[]>();
    for (const unit of units) {
      const existing = byFamily.get(unit.familyId) ?? [];
      existing.push(unit);
      byFamily.set(unit.familyId, existing);
    }

    for (const familyUnits of byFamily.values()) {
      familyUnits.sort((left, right) => right.mtimeMs - left.mtimeMs);
      familyUnits.forEach((unit, index) => {
        const ageDays = ageDaysFrom(nowMs, unit.mtimeMs);
        const keepBecauseFresh = ageDays <= args.retentionDays;
        const keepBecauseLatest = index < args.keepLatestPerFamily;
        const action: Exclude<LifecycleAction, "cleanup"> = keepBecauseFresh || keepBecauseLatest ? "retain" : "archive";
        const reasons: string[] = [];
        if (keepBecauseFresh) {
          reasons.push(`within ${args.retentionDays}-day live retention window`);
        }
        if (keepBecauseLatest) {
          reasons.push(`kept as one of the latest ${args.keepLatestPerFamily} ${unit.familyLabel.toLowerCase()} artifact set(s)`);
        }
        if (action === "archive") {
          reasons.push(`older than ${args.retentionDays} days and outside the latest ${args.keepLatestPerFamily} ${unit.familyLabel.toLowerCase()} artifact set(s)`);
        }

        const reportItem: ManagedArtifactAction = {
          action,
          sourceId: unit.sourceId,
          sourceLabel: unit.sourceLabel,
          familyId: unit.familyId,
          familyLabel: unit.familyLabel,
          reviewerFacing: unit.reviewerFacing,
          displayName: unit.displayName,
          ageDays,
          reasons,
          livePaths: unit.members.map((member) => member.path),
          archivePaths: unit.members.map((member) => buildArchivePath(runDirectory, source, member.relativePath)),
        };

        if (action === "retain") {
          retained.push(reportItem);
        } else {
          archiveCandidates.push(reportItem);
        }
      });
    }
  }

  retained.sort((left, right) => left.displayName.localeCompare(right.displayName));
  archiveCandidates.sort((left, right) => left.displayName.localeCompare(right.displayName));

  return { retained, archiveCandidates };
}

function listArchiveCleanupCandidates(args: Args, now: Date): ArchiveCleanupCandidate[] {
  const runsDir = path.join(args.archiveDir, "runs");
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  return fs
    .readdirSync(runsDir)
    .map((name) => path.join(runsDir, name))
    .filter((entryPath) => fs.existsSync(entryPath) && fs.statSync(entryPath).isDirectory())
    .map((entryPath) => ({
      runName: path.basename(entryPath),
      livePath: entryPath,
      ageDays: ageDaysFrom(now.getTime(), fs.statSync(entryPath).mtimeMs),
    }))
    .filter((entry) => entry.ageDays > args.archiveRetentionDays)
    .sort((left, right) => left.livePath.localeCompare(right.livePath))
    .map((entry) => ({
      action: "cleanup" as const,
      runName: entry.runName,
      ageDays: entry.ageDays,
      livePath: entry.livePath,
      reasons: [`older than ${args.archiveRetentionDays}-day archive retention window`],
    }));
}

function moveMembersToArchive(archiveCandidates: ManagedArtifactAction[]): ManagedArtifactAction[] {
  const archived: ManagedArtifactAction[] = [];
  for (const candidate of archiveCandidates) {
    candidate.livePaths.forEach((livePath, index) => {
      const archivePath = candidate.archivePaths[index] ?? fail(`Missing archive path for ${livePath}`);
      ensureDirectory(path.dirname(archivePath));
      fs.renameSync(livePath, archivePath);
    });
    archived.push({ ...candidate, action: "archive" });
  }
  return archived;
}

function cleanupArchiveRuns(cleanupCandidates: ArchiveCleanupCandidate[]): ArchiveCleanupCandidate[] {
  const cleaned: ArchiveCleanupCandidate[] = [];
  for (const candidate of cleanupCandidates) {
    fs.rmSync(candidate.livePath, { recursive: true, force: true });
    cleaned.push(candidate);
  }
  return cleaned;
}

function buildSummary(report: Omit<LifecycleReport, "summary">): LifecycleReport["summary"] {
  const retainedCount = report.retained.length;
  const archiveCandidateCount = report.archiveCandidates.length;
  const archivedCount = report.archived.length;
  const cleanupCandidateCount = report.cleanupCandidates.length;
  const cleanedUpCount = report.cleanedUp.length;
  const reviewerEntryPointCount = report.reviewerEntryPoints.length;
  const actionWord = report.mode === "apply" ? "Applied" : "Planned";
  return {
    retainedCount,
    archiveCandidateCount,
    archivedCount,
    cleanupCandidateCount,
    cleanedUpCount,
    reviewerEntryPointCount,
    summary:
      report.mode === "apply"
        ? `${actionWord} evidence lifecycle maintenance: retained ${retainedCount} active artifact set(s), archived ${archivedCount}, cleaned ${cleanedUpCount} old archive run(s).`
        : `${actionWord} evidence lifecycle maintenance: retain ${retainedCount} active artifact set(s), archive ${archiveCandidateCount}, clean ${cleanupCandidateCount} old archive run(s).`,
  };
}

function formatActionLine(entry: ManagedArtifactAction): string {
  return `- ${entry.displayName} (${entry.familyLabel}, ${entry.ageDays}d): ${entry.reasons.join("; ")}`;
}

function formatCleanupLine(entry: ArchiveCleanupCandidate): string {
  return `- ${toRelativePath(entry.livePath)} (${entry.ageDays}d): ${entry.reasons.join("; ")}`;
}

function renderMarkdown(report: LifecycleReport): string {
  const lines: string[] = [
    "# Release Evidence Lifecycle Report",
    "",
    "## Summary",
    "",
    `- Mode: \`${report.mode}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Revision: \`${report.revision.shortCommit}\` on branch \`${report.revision.branch}\`${report.revision.dirty ? " (dirty)" : ""}`,
    `- Live retention: \`${report.policy.retentionDays}\` day(s)`,
    `- Archive retention: \`${report.policy.archiveRetentionDays}\` day(s)`,
    `- Keep latest per family: \`${report.policy.keepLatestPerFamily}\``,
    `- Archive root: \`${toRelativePath(report.policy.archiveDir)}\``,
    `- Result: ${report.summary.summary}`,
    "",
    "## Reviewer Front Doors",
    "",
    "Reviewers should treat retained front-door artifacts in the live directories as current. Anything under `artifacts/release-archive/` is historical context, not the active release packet.",
    "",
  ];

  if (report.reviewerEntryPoints.length === 0) {
    lines.push("- No reviewer-facing artifact sets were retained.");
  } else {
    report.reviewerEntryPoints.forEach((entry) => {
      const livePaths = entry.livePaths.map((livePath) => `\`${toRelativePath(livePath)}\``).join(", ");
      lines.push(`- ${entry.familyLabel}: ${livePaths}`);
    });
  }

  lines.push("", "## Retained Active Artifacts", "");
  if (report.retained.length === 0) {
    lines.push("- No live artifact sets were retained.");
  } else {
    report.retained.forEach((entry) => lines.push(formatActionLine(entry)));
  }

  lines.push("", "## Archive Candidates", "");
  if (report.archiveCandidates.length === 0) {
    lines.push("- No live artifact sets need archiving.");
  } else {
    report.archiveCandidates.forEach((entry) => lines.push(formatActionLine(entry)));
  }

  lines.push("", "## Archive Cleanup Candidates", "");
  if (report.cleanupCandidates.length === 0) {
    lines.push("- No archive runs are old enough for cleanup.");
  } else {
    report.cleanupCandidates.forEach((entry) => lines.push(formatCleanupLine(entry)));
  }

  if (report.mode === "apply") {
    lines.push("", "## Applied Changes", "");
    if (report.archived.length === 0 && report.cleanedUp.length === 0) {
      lines.push("- No archive or cleanup actions were applied.");
    } else {
      if (report.archived.length > 0) {
        lines.push("- Archived live artifact sets:");
        report.archived.forEach((entry) => lines.push(`  - ${entry.livePaths.map((livePath) => toRelativePath(livePath)).join(", ")}`));
      }
      if (report.cleanedUp.length > 0) {
        lines.push("- Removed expired archive runs:");
        report.cleanedUp.forEach((entry) => lines.push(`  - ${toRelativePath(entry.livePath)}`));
      }
    }
  }

  lines.push("");
  return lines.join("\n");
}

function resolveOutputPath(args: Args, gitRevision: GitRevision): string {
  return args.outputPath ?? path.join(args.releaseReadinessDir, `release-evidence-lifecycle-report-${gitRevision.shortCommit}.json`);
}

function resolveMarkdownOutputPath(args: Args, gitRevision: GitRevision): string {
  return (
    args.markdownOutputPath ??
    path.join(args.releaseReadinessDir, `release-evidence-lifecycle-report-${gitRevision.shortCommit}.md`)
  );
}

function formatRunDirectoryName(now: Date): string {
  return now.toISOString().replace(/[:]/g, "-").replace(/\.\d{3}Z$/, "Z");
}

function main(): void {
  const args = parseArgs(process.argv);
  const revision = readGitRevision();
  const now = new Date();
  const runDirectory = path.join(args.archiveDir, "runs", formatRunDirectoryName(now));

  const configuredSources: ManagedSource[] = [
    { ...SOURCES[0], directoryPath: args.releaseReadinessDir },
    {
      ...SOURCES[1],
      directoryPath: path.join(args.releaseReadinessDir, "phase1-candidate-rehearsal"),
    },
    { ...SOURCES[2], directoryPath: args.wechatArtifactsDir },
  ];

  const { retained, archiveCandidates } = planLiveArtifactActions(args, now, runDirectory, configuredSources);
  const cleanupCandidates = listArchiveCleanupCandidates(args, now);

  let archived: ManagedArtifactAction[] = [];
  let cleanedUp: ArchiveCleanupCandidate[] = [];

  if (args.mode === "apply") {
    archived = moveMembersToArchive(archiveCandidates);
    cleanedUp = cleanupArchiveRuns(cleanupCandidates);
  }

  const reviewerEntryPoints = retained.filter((entry) => entry.reviewerFacing);
  const baseReport = {
    schemaVersion: 1 as const,
    generatedAt: now.toISOString(),
    mode: args.mode,
    revision,
    policy: {
      retentionDays: args.retentionDays,
      archiveRetentionDays: args.archiveRetentionDays,
      keepLatestPerFamily: args.keepLatestPerFamily,
      archiveDir: args.archiveDir,
    },
    reviewerEntryPoints,
    retained,
    archiveCandidates,
    archived,
    cleanupCandidates,
    cleanedUp,
  };
  const report: LifecycleReport = {
    ...baseReport,
    summary: buildSummary(baseReport),
  };

  const outputPath = resolveOutputPath(args, revision);
  const markdownOutputPath = resolveMarkdownOutputPath(args, revision);
  writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFile(markdownOutputPath, renderMarkdown(report));

  if (args.mode === "apply" && (archived.length > 0 || cleanedUp.length > 0)) {
    writeFile(path.join(runDirectory, "archive-manifest.json"), `${JSON.stringify(report, null, 2)}\n`);
    writeFile(path.join(runDirectory, "archive-manifest.md"), renderMarkdown(report));
  }

  process.stdout.write(`${report.summary.summary}\n`);
  process.stdout.write(`Reviewer front doors retained: ${report.summary.reviewerEntryPointCount}\n`);
  process.stdout.write(`JSON report: ${toRelativePath(outputPath)}\n`);
  process.stdout.write(`Markdown report: ${toRelativePath(markdownOutputPath)}\n`);
}

main();
