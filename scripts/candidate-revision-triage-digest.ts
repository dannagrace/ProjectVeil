import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  summarizeRuntimeDiagnosticsErrors,
  type RuntimeDiagnosticsErrorEvent,
  type RuntimeDiagnosticsErrorFingerprintSummary,
  type RuntimeDiagnosticsFeatureArea,
  type RuntimeDiagnosticsSnapshot
} from "../packages/shared/src/index.ts";

interface Args {
  candidate?: string;
  candidateRevision?: string;
  inputPaths: string[];
  outputPath?: string;
  markdownOutputPath?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface CandidateRevisionTriageDigest {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    dirty: boolean;
  };
  summary: {
    headline: string;
    totalEvents: number;
    uniqueFingerprints: number;
    fatalCount: number;
    crashCount: number;
    topFeatureAreas: Array<{
      featureArea: RuntimeDiagnosticsFeatureArea;
      count: number;
      ownerArea: string;
    }>;
  };
  artifacts: Array<{
    path: string;
    sourceType: "runtime-diagnostics-snapshot" | "error-event-bundle";
    surface: string;
    eventCount: number;
    matchedEventCount: number;
  }>;
  topFingerprints: Array<{
    fingerprint: string;
    errorCode: string;
    featureArea: RuntimeDiagnosticsFeatureArea;
    ownerArea: string;
    source: string;
    surface: string;
    severity: string;
    firstSeenAt: string;
    firstSeenRevision: string | null;
    lastSeenAt: string;
    latestMessage: string;
    count: number;
    crashCount: number;
    suggestedOwner: string;
    sampleContext: RuntimeDiagnosticsErrorEvent["context"];
  }>;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");
const FEATURE_OWNER_MAP: Record<RuntimeDiagnosticsFeatureArea, string> = {
  login: "account",
  payment: "commerce",
  room_sync: "multiplayer",
  rewards: "progression",
  share: "social",
  runtime: "platform",
  battle: "combat",
  guild: "social",
  shop: "commerce",
  season: "progression",
  quests: "progression",
  unknown: "platform"
};

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  const inputPaths: string[] = [];
  let candidate: string | undefined;
  let candidateRevision: string | undefined;
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
    if (arg === "--input" && next) {
      inputPaths.push(next);
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

  if (inputPaths.length === 0) {
    fail("Provide at least one --input <path> with a runtime diagnostics snapshot or error-event bundle.");
  }

  return {
    ...(candidate ? { candidate } : {}),
    ...(candidateRevision ? { candidateRevision } : {}),
    inputPaths,
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
  };
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

function getRevision(candidateRevision?: string): GitRevision {
  const commit = candidateRevision?.trim() || readGitValue(["rev-parse", "HEAD"]);
  return {
    commit,
    shortCommit: commit.slice(0, 7),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "candidate";
}

function ensureDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJsonFile(filePath: string, payload: JsonValue | object): void {
  ensureDirectory(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
}

function isRuntimeDiagnosticsSnapshot(value: unknown): value is RuntimeDiagnosticsSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<RuntimeDiagnosticsSnapshot>;
  return Boolean(candidate.source && candidate.diagnostics && "errorEvents" in candidate.diagnostics);
}

function extractEventsFromInput(payload: unknown): {
  sourceType: "runtime-diagnostics-snapshot" | "error-event-bundle";
  surface: string;
  events: RuntimeDiagnosticsErrorEvent[];
} {
  if (isRuntimeDiagnosticsSnapshot(payload)) {
    return {
      sourceType: "runtime-diagnostics-snapshot",
      surface: payload.source.surface,
      events: payload.diagnostics.errorEvents
    };
  }

  if (
    payload &&
    typeof payload === "object" &&
    "errorEvents" in payload &&
    Array.isArray((payload as { errorEvents?: unknown }).errorEvents)
  ) {
    const errorEvents = (payload as { errorEvents: RuntimeDiagnosticsErrorEvent[] }).errorEvents;
    return {
      sourceType: "error-event-bundle",
      surface: errorEvents[0]?.surface ?? "unknown",
      events: errorEvents
    };
  }

  fail("Input JSON must be a runtime diagnostics snapshot or an object with an errorEvents array.");
}

function compareTimestamp(left: string, right: string): number {
  return Date.parse(left) - Date.parse(right);
}

function buildTopFingerprints(events: RuntimeDiagnosticsErrorEvent[]): CandidateRevisionTriageDigest["topFingerprints"] {
  const summary = summarizeRuntimeDiagnosticsErrors(events);
  const earliestRevisionByFingerprint = new Map<string, { recordedAt: string; candidateRevision: string | null }>();

  for (const event of events) {
    const existing = earliestRevisionByFingerprint.get(event.fingerprint);
    if (!existing || compareTimestamp(event.recordedAt, existing.recordedAt) < 0) {
      earliestRevisionByFingerprint.set(event.fingerprint, {
        recordedAt: event.recordedAt,
        candidateRevision: event.candidateRevision
      });
    }
  }

  return summary.topFingerprints.map((entry) => ({
    fingerprint: entry.fingerprint,
    errorCode: entry.errorCode,
    featureArea: entry.featureArea,
    ownerArea: entry.ownerArea,
    source: entry.source,
    surface: entry.surface,
    severity: entry.severity,
    firstSeenAt: entry.firstSeenAt,
    firstSeenRevision: earliestRevisionByFingerprint.get(entry.fingerprint)?.candidateRevision ?? entry.candidateRevision,
    lastSeenAt: entry.lastSeenAt,
    latestMessage: entry.latestMessage,
    count: entry.count,
    crashCount: entry.crashCount,
    suggestedOwner: entry.ownerArea || FEATURE_OWNER_MAP[entry.featureArea],
    sampleContext: entry.sampleContext
  }));
}

function buildDigest(
  args: Args,
  revision: GitRevision,
  inputs: Array<{
    path: string;
    sourceType: "runtime-diagnostics-snapshot" | "error-event-bundle";
    surface: string;
    events: RuntimeDiagnosticsErrorEvent[];
    matchedEvents: RuntimeDiagnosticsErrorEvent[];
  }>
): CandidateRevisionTriageDigest {
  const events = inputs.flatMap((input) => input.matchedEvents).sort(
    (left, right) => compareTimestamp(left.recordedAt, right.recordedAt)
  );
  const summary = summarizeRuntimeDiagnosticsErrors(events);
  const topFingerprints = buildTopFingerprints(events);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: args.candidate?.trim() || revision.branch,
      revision: revision.commit,
      shortRevision: revision.shortCommit,
      branch: revision.branch,
      dirty: revision.dirty
    },
    summary: {
      headline:
        events.length > 0
          ? `${events.length} error event(s) across ${summary.uniqueFingerprints} fingerprint(s) for candidate ${revision.shortCommit}.`
          : `No matching error events were found for candidate ${revision.shortCommit}.`,
      totalEvents: summary.totalEvents,
      uniqueFingerprints: summary.uniqueFingerprints,
      fatalCount: summary.fatalCount,
      crashCount: summary.crashCount,
      topFeatureAreas: summary.byFeatureArea.slice(0, 5).map((entry) => ({
        featureArea: entry.featureArea,
        count: entry.count,
        ownerArea: FEATURE_OWNER_MAP[entry.featureArea]
      }))
    },
    artifacts: inputs.map((input) => ({
      path: input.path,
      sourceType: input.sourceType,
      surface: input.surface,
      eventCount: input.events.length,
      matchedEventCount: input.matchedEvents.length
    })),
    topFingerprints
  };
}

export function renderMarkdown(digest: CandidateRevisionTriageDigest): string {
  const lines = [
    "# Candidate Revision Triage Digest",
    "",
    `- Candidate: \`${digest.candidate.name}\``,
    `- Revision: \`${digest.candidate.revision}\``,
    `- Branch: \`${digest.candidate.branch}\``,
    `- Generated: \`${digest.generatedAt}\``,
    `- Summary: ${digest.summary.headline}`,
    ""
  ];

  if (digest.summary.topFeatureAreas.length > 0) {
    lines.push("## Area Hotspots", "");
    for (const area of digest.summary.topFeatureAreas) {
      lines.push(`- \`${area.featureArea}\`: ${area.count} event(s), suggested owner \`${area.ownerArea}\``);
    }
    lines.push("");
  }

  lines.push("## Top Fingerprints", "");
  if (digest.topFingerprints.length === 0) {
    lines.push("- No matching error fingerprints.");
  } else {
    for (const entry of digest.topFingerprints) {
      lines.push(`### \`${entry.errorCode}\` on \`${entry.surface}\``);
      lines.push(`- Feature area: \`${entry.featureArea}\``);
      lines.push(`- Suggested owner: \`${entry.suggestedOwner}\``);
      lines.push(`- Count: ${entry.count}`);
      lines.push(`- First seen revision: \`${entry.firstSeenRevision ?? "unknown"}\``);
      lines.push(`- Last reproduced: \`${entry.lastSeenAt}\``);
      lines.push(`- Latest message: ${entry.latestMessage}`);
      lines.push(
        `- Context: room=\`${entry.sampleContext.roomId ?? "n/a"}\` route=\`${entry.sampleContext.route ?? "n/a"}\` action=\`${entry.sampleContext.action ?? "n/a"}\``
      );
      lines.push("");
    }
  }

  lines.push("## Artifacts", "");
  for (const artifact of digest.artifacts) {
    lines.push(
      `- \`${toRelativePath(artifact.path)}\` (${artifact.sourceType}, surface \`${artifact.surface}\`, matched ${artifact.matchedEventCount}/${artifact.eventCount})`
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

export function buildCandidateRevisionTriageDigestFromPaths(args: Args): CandidateRevisionTriageDigest {
  const revision = getRevision(args.candidateRevision);
  const inputs = args.inputPaths.map((inputPath) => {
    const resolvedPath = path.resolve(inputPath);
    const extracted = extractEventsFromInput(readJson(resolvedPath));
    const matchedEvents = extracted.events.filter(
      (event) => (event.candidateRevision ?? revision.commit) === revision.commit
    );
    return {
      path: resolvedPath,
      sourceType: extracted.sourceType,
      surface: extracted.surface,
      events: extracted.events,
      matchedEvents: matchedEvents.map((event) => ({
        ...event,
        ownerArea: event.ownerArea || FEATURE_OWNER_MAP[event.featureArea]
      }))
    };
  });

  return buildDigest(args, revision, inputs);
}

function getDefaultOutputPaths(candidate: string, revision: string): { outputPath: string; markdownOutputPath: string } {
  const baseName = `candidate-revision-triage-digest-${slugify(candidate)}-${revision.slice(0, 12)}`;
  return {
    outputPath: path.join(DEFAULT_OUTPUT_DIR, `${baseName}.json`),
    markdownOutputPath: path.join(DEFAULT_OUTPUT_DIR, `${baseName}.md`)
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const digest = buildCandidateRevisionTriageDigestFromPaths(args);
  const outputDefaults = getDefaultOutputPaths(digest.candidate.name, digest.candidate.revision);
  const outputPath = path.resolve(args.outputPath ?? outputDefaults.outputPath);
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? outputDefaults.markdownOutputPath);

  writeJsonFile(outputPath, digest);
  ensureDirectory(markdownOutputPath);
  fs.writeFileSync(markdownOutputPath, renderMarkdown(digest), "utf8");

  console.log(`Wrote candidate triage digest JSON: ${toRelativePath(outputPath)}`);
  console.log(`Wrote candidate triage digest Markdown: ${toRelativePath(markdownOutputPath)}`);
  console.log(digest.summary.headline);
}

const invokedScript = process.argv[1] ? path.resolve(process.argv[1]) : null;
const currentScript = path.resolve(process.cwd(), "scripts", "candidate-revision-triage-digest.ts");

if (invokedScript === currentScript) {
  try {
    main();
  } catch (error) {
    console.error(`candidate triage digest failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
