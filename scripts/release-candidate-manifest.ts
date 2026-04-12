import fs from "node:fs";
import path from "node:path";

export type CandidateManifestCategory =
  | "runtime-observability"
  | "release-evidence"
  | "reviewer-entrypoint"
  | "supporting-summary";
export type CandidateManifestSourceKind = "artifact" | "endpoint" | "directory";

export interface CandidateManifestSource {
  label: string;
  kind: CandidateManifestSourceKind;
  path?: string;
  url?: string;
  notes?: string;
}

export interface CandidateManifestEntryInput {
  id: string;
  label: string;
  category: CandidateManifestCategory;
  required: boolean;
  producedAt?: string;
  summary: string;
  producerScript: string;
  artifacts: {
    jsonPath?: string;
    markdownPath?: string;
    directoryPath?: string;
  };
  metadata?: Record<string, string | number | boolean | null>;
  sources?: CandidateManifestSource[];
}

export interface CandidateManifestEntry extends CandidateManifestEntryInput {
  updatedAt: string;
}

export interface ReleaseCandidateManifest {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
  };
  manifest: {
    jsonPath: string;
    markdownPath: string;
  };
  reviewerWorkflow: {
    summary: string;
    requiredEntryIds: string[];
  };
  summary: {
    entryCount: number;
    requiredEntryCount: number;
    categories: CandidateManifestCategory[];
    updatedBy: string[];
  };
  entries: CandidateManifestEntry[];
}

interface UpdateReleaseCandidateManifestInput {
  candidate: string;
  candidateRevision: string;
  releaseReadinessDir?: string;
  entries: CandidateManifestEntryInput[];
}

const DEFAULT_RELEASE_READINESS_DIR = path.resolve("artifacts", "release-readiness");
const CATEGORY_ORDER: CandidateManifestCategory[] = [
  "reviewer-entrypoint",
  "runtime-observability",
  "release-evidence",
  "supporting-summary"
];

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "candidate";
}

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeFile(filePath: string, content: string): void {
  ensureDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function toRelativePath(filePath: string): string {
  return path.relative(process.cwd(), path.resolve(filePath)).replace(/\\/g, "/");
}

function normalizeArtifactPath(filePath: string | undefined): string | undefined {
  return filePath?.trim() ? toRelativePath(filePath) : undefined;
}

export function findNearestReleaseReadinessDir(...artifactPaths: Array<string | undefined>): string {
  for (const artifactPath of artifactPaths) {
    if (!artifactPath?.trim()) {
      continue;
    }
    let currentDir = path.dirname(path.resolve(artifactPath));
    while (currentDir !== path.dirname(currentDir)) {
      if (path.basename(currentDir) === "release-readiness") {
        return currentDir;
      }
      currentDir = path.dirname(currentDir);
    }
  }
  const firstPath = artifactPaths.find((value) => value?.trim());
  return firstPath ? path.dirname(path.resolve(firstPath)) : DEFAULT_RELEASE_READINESS_DIR;
}

function normalizeSources(sources: CandidateManifestSource[] | undefined): CandidateManifestSource[] {
  return (sources ?? []).map((source) => ({
    label: source.label,
    kind: source.kind,
    ...(source.path?.trim() ? { path: normalizeArtifactPath(source.path) } : {}),
    ...(source.url?.trim() ? { url: source.url.trim() } : {}),
    ...(source.notes?.trim() ? { notes: source.notes.trim() } : {})
  }));
}

function compareEntries(left: CandidateManifestEntry, right: CandidateManifestEntry): number {
  const categoryDelta = CATEGORY_ORDER.indexOf(left.category) - CATEGORY_ORDER.indexOf(right.category);
  if (categoryDelta !== 0) {
    return categoryDelta;
  }
  if (left.required !== right.required) {
    return left.required ? -1 : 1;
  }
  return left.label.localeCompare(right.label);
}

function defaultManifestJsonPath(candidate: string, revision: string, releaseReadinessDir: string): string {
  return path.resolve(
    releaseReadinessDir,
    `candidate-evidence-manifest-${slugify(candidate)}-${revision.slice(0, 12)}.json`
  );
}

function defaultManifestMarkdownPath(candidate: string, revision: string, releaseReadinessDir: string): string {
  return path.resolve(
    releaseReadinessDir,
    `candidate-evidence-manifest-${slugify(candidate)}-${revision.slice(0, 12)}.md`
  );
}

function createBaseManifest(input: {
  candidate: string;
  candidateRevision: string;
  manifestJsonPath: string;
  manifestMarkdownPath: string;
}): ReleaseCandidateManifest {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    candidate: {
      name: input.candidate,
      revision: input.candidateRevision,
      shortRevision: input.candidateRevision.slice(0, 12)
    },
    manifest: {
      jsonPath: toRelativePath(input.manifestJsonPath),
      markdownPath: toRelativePath(input.manifestMarkdownPath)
    },
    reviewerWorkflow: {
      summary: "Start from this manifest instead of manually browsing release-readiness directories.",
      requiredEntryIds: []
    },
    summary: {
      entryCount: 0,
      requiredEntryCount: 0,
      categories: [],
      updatedBy: []
    },
    entries: []
  };
}

function loadExistingManifest(
  manifestJsonPath: string,
  input: { candidate: string; candidateRevision: string; manifestMarkdownPath: string }
): ReleaseCandidateManifest {
  if (!fs.existsSync(manifestJsonPath)) {
    return createBaseManifest({
      candidate: input.candidate,
      candidateRevision: input.candidateRevision,
      manifestJsonPath,
      manifestMarkdownPath: input.manifestMarkdownPath
    });
  }

  const parsed = JSON.parse(fs.readFileSync(manifestJsonPath, "utf8")) as Partial<ReleaseCandidateManifest>;
  if (parsed.candidate?.name !== input.candidate || parsed.candidate?.revision !== input.candidateRevision) {
    return createBaseManifest({
      candidate: input.candidate,
      candidateRevision: input.candidateRevision,
      manifestJsonPath,
      manifestMarkdownPath: input.manifestMarkdownPath
    });
  }

  return {
    ...createBaseManifest({
      candidate: input.candidate,
      candidateRevision: input.candidateRevision,
      manifestJsonPath,
      manifestMarkdownPath: input.manifestMarkdownPath
    }),
    ...parsed,
    candidate: {
      name: input.candidate,
      revision: input.candidateRevision,
      shortRevision: input.candidateRevision.slice(0, 12)
    },
    manifest: {
      jsonPath: toRelativePath(manifestJsonPath),
      markdownPath: toRelativePath(input.manifestMarkdownPath)
    },
    entries: Array.isArray(parsed.entries) ? (parsed.entries as CandidateManifestEntry[]) : []
  };
}

function buildEntry(input: CandidateManifestEntryInput, updatedAt: string): CandidateManifestEntry {
  return {
    ...input,
    updatedAt,
    artifacts: {
      ...(input.artifacts.jsonPath ? { jsonPath: normalizeArtifactPath(input.artifacts.jsonPath) } : {}),
      ...(input.artifacts.markdownPath ? { markdownPath: normalizeArtifactPath(input.artifacts.markdownPath) } : {}),
      ...(input.artifacts.directoryPath ? { directoryPath: normalizeArtifactPath(input.artifacts.directoryPath) } : {})
    },
    metadata: input.metadata ?? {},
    sources: normalizeSources(input.sources)
  };
}

function finalizeManifest(manifest: ReleaseCandidateManifest): ReleaseCandidateManifest {
  const entries = [...manifest.entries].sort(compareEntries);
  const requiredEntryIds = entries.filter((entry) => entry.required).map((entry) => entry.id);
  const updatedBy = Array.from(new Set(entries.map((entry) => entry.producerScript))).sort((left, right) => left.localeCompare(right));
  const categories = Array.from(new Set(entries.map((entry) => entry.category))).sort(
    (left, right) => CATEGORY_ORDER.indexOf(left) - CATEGORY_ORDER.indexOf(right)
  );

  return {
    ...manifest,
    generatedAt: new Date().toISOString(),
    reviewerWorkflow: {
      summary: "Start from this manifest instead of manually browsing release-readiness directories.",
      requiredEntryIds
    },
    summary: {
      entryCount: entries.length,
      requiredEntryCount: requiredEntryIds.length,
      categories,
      updatedBy
    },
    entries
  };
}

export function renderReleaseCandidateManifestMarkdown(manifest: ReleaseCandidateManifest): string {
  const lines: string[] = [
    "# Candidate Evidence Manifest",
    "",
    `- Generated at: \`${manifest.generatedAt}\``,
    `- Candidate: \`${manifest.candidate.name}\``,
    `- Revision: \`${manifest.candidate.revision}\``,
    `- Manifest JSON: \`${manifest.manifest.jsonPath}\``,
    `- Manifest Markdown: \`${manifest.manifest.markdownPath}\``,
    "",
    "## Reviewer Workflow",
    "",
    `- ${manifest.reviewerWorkflow.summary}`,
    `- Required reviewer entrypoints: ${
      manifest.reviewerWorkflow.requiredEntryIds.length > 0
        ? manifest.reviewerWorkflow.requiredEntryIds.map((entryId) => `\`${entryId}\``).join(", ")
        : "<none>"
    }`,
    "- Open the manifest entries first, then follow the linked source artifacts or endpoints from each entry.",
    "",
    "## Entries",
    "",
    "| Entry | Category | Required | Produced at | JSON | Markdown | Directory | Producer |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |"
  ];

  for (const entry of manifest.entries) {
    lines.push(
      `| ${entry.label} | ${entry.category} | ${entry.required ? "yes" : "no"} | \`${entry.producedAt ?? "<missing>"}\` | \`${entry.artifacts.jsonPath ?? "<n/a>"}\` | \`${entry.artifacts.markdownPath ?? "<n/a>"}\` | \`${entry.artifacts.directoryPath ?? "<n/a>"}\` | \`${entry.producerScript}\` |`
    );
  }

  lines.push("");
  for (const entry of manifest.entries) {
    lines.push(`### ${entry.label}`, "");
    lines.push(`- Entry id: \`${entry.id}\``);
    lines.push(`- Category: \`${entry.category}\``);
    lines.push(`- Required: \`${entry.required}\``);
    lines.push(`- Summary: ${entry.summary}`);
    lines.push(`- Produced at: \`${entry.producedAt ?? "<missing>"}\``);
    lines.push(`- Updated at: \`${entry.updatedAt}\``);
    lines.push(`- Producer script: \`${entry.producerScript}\``);
    lines.push(`- JSON artifact: \`${entry.artifacts.jsonPath ?? "<n/a>"}\``);
    lines.push(`- Markdown artifact: \`${entry.artifacts.markdownPath ?? "<n/a>"}\``);
    lines.push(`- Directory artifact: \`${entry.artifacts.directoryPath ?? "<n/a>"}\``);
    if (Object.keys(entry.metadata ?? {}).length > 0) {
      lines.push("- Metadata:");
      for (const [key, value] of Object.entries(entry.metadata ?? {})) {
        lines.push(`  - \`${key}\`: \`${value === null ? "null" : String(value)}\``);
      }
    }
    if ((entry.sources?.length ?? 0) === 0) {
      lines.push("- Sources: none recorded.");
    } else {
      lines.push("- Sources:");
      for (const source of entry.sources ?? []) {
        lines.push(
          `  - ${source.label} [${source.kind}]${
            source.path ? ` path=\`${source.path}\`` : source.url ? ` url=\`${source.url}\`` : ""
          }${source.notes ? ` (${source.notes})` : ""}`
        );
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

export function updateReleaseCandidateManifest(input: UpdateReleaseCandidateManifestInput): {
  manifest: ReleaseCandidateManifest;
  manifestJsonPath: string;
  manifestMarkdownPath: string;
} {
  const releaseReadinessDir = path.resolve(input.releaseReadinessDir ?? DEFAULT_RELEASE_READINESS_DIR);
  const manifestJsonPath = defaultManifestJsonPath(input.candidate, input.candidateRevision, releaseReadinessDir);
  const manifestMarkdownPath = defaultManifestMarkdownPath(input.candidate, input.candidateRevision, releaseReadinessDir);
  const manifest = loadExistingManifest(manifestJsonPath, {
    candidate: input.candidate,
    candidateRevision: input.candidateRevision,
    manifestMarkdownPath
  });
  const updatedAt = new Date().toISOString();
  const nextEntries = [...manifest.entries];

  for (const entryInput of input.entries) {
    const nextEntry = buildEntry(entryInput, updatedAt);
    const existingIndex = nextEntries.findIndex((entry) => entry.id === nextEntry.id);
    if (existingIndex >= 0) {
      nextEntries.splice(existingIndex, 1, nextEntry);
    } else {
      nextEntries.push(nextEntry);
    }
  }

  const finalized = finalizeManifest({
    ...manifest,
    entries: nextEntries
  });
  writeFile(manifestJsonPath, `${JSON.stringify(finalized, null, 2)}\n`);
  writeFile(manifestMarkdownPath, renderReleaseCandidateManifestMarkdown(finalized));

  return {
    manifest: finalized,
    manifestJsonPath,
    manifestMarkdownPath
  };
}
