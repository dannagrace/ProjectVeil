import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  createClientMessageFixtures,
  createServerMessageFixtures,
  createSessionStatePayloadFixture
} from "../packages/shared/test/support/multiplayer-protocol-fixtures.ts";
import {
  compareContractSnapshot,
  type ContractSnapshotComparison
} from "../packages/shared/test/support/contract-snapshot.ts";

type CompatibilityStatus = "compatible" | "incompatible";

interface Args {
  outputPath?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface CompatibilityEntry {
  id: string;
  label: string;
  snapshotPath: string;
  status: CompatibilityStatus;
  summary: string;
  diff?: string;
}

interface MultiplayerProtocolCompatibilityReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  summary: {
    status: CompatibilityStatus;
    snapshotCount: number;
    compatibleSnapshots: number;
    incompatibleSnapshots: number;
    incompatibleSnapshotIds: string[];
  };
  entries: CompatibilityEntry[];
}

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return outputPath ? { outputPath } : {};
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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

function readGitRevision(): GitRevision {
  return {
    commit: readGitValue(["rev-parse", "HEAD"]),
    shortCommit: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--short"]).length > 0
  };
}

function resolveOutputPath(requestedPath: string | undefined, shortCommit: string): string {
  if (requestedPath) {
    return path.resolve(requestedPath);
  }
  return path.resolve("artifacts", "release-readiness", `multiplayer-protocol-compatibility-${shortCommit}.json`);
}

function toEntry(
  id: string,
  label: string,
  comparison: ContractSnapshotComparison
): CompatibilityEntry {
  if (comparison.status === "matched") {
    return {
      id,
      label,
      snapshotPath: comparison.relativeSnapshotPath,
      status: "compatible",
      summary: "Snapshot matches the checked-in multiplayer contract."
    };
  }

  if (comparison.status === "missing") {
    return {
      id,
      label,
      snapshotPath: comparison.relativeSnapshotPath,
      status: "incompatible",
      summary: "Snapshot file is missing.",
      diff: "missing snapshot file"
    };
  }

  return {
    id,
    label,
    snapshotPath: comparison.relativeSnapshotPath,
    status: "incompatible",
    summary: "Snapshot differs from the current multiplayer contract sample.",
    diff: comparison.difference
  };
}

export function buildCompatibilityEntries(): CompatibilityEntry[] {
  const snapshotDir = path.resolve("packages", "shared", "test", "fixtures", "contract-snapshots");

  return [
    toEntry(
      "session-state-payload",
      "Authoritative session state payload",
      compareContractSnapshot(path.join(snapshotDir, "session-state-payload.json"), createSessionStatePayloadFixture())
    ),
    toEntry(
      "multiplayer-client-messages",
      "Client multiplayer protocol envelopes",
      compareContractSnapshot(path.join(snapshotDir, "multiplayer-client-messages.json"), createClientMessageFixtures())
    ),
    toEntry(
      "multiplayer-server-messages",
      "Server multiplayer protocol envelopes",
      compareContractSnapshot(path.join(snapshotDir, "multiplayer-server-messages.json"), createServerMessageFixtures())
    )
  ];
}

export function buildCompatibilityReport(revision: GitRevision, entries = buildCompatibilityEntries()): MultiplayerProtocolCompatibilityReport {
  const incompatibleSnapshotIds = entries.filter((entry) => entry.status === "incompatible").map((entry) => entry.id);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    summary: {
      status: incompatibleSnapshotIds.length === 0 ? "compatible" : "incompatible",
      snapshotCount: entries.length,
      compatibleSnapshots: entries.filter((entry) => entry.status === "compatible").length,
      incompatibleSnapshots: incompatibleSnapshotIds.length,
      incompatibleSnapshotIds
    },
    entries
  };
}

function main(): void {
  const args = parseArgs(process.argv);
  const revision = readGitRevision();
  const report = buildCompatibilityReport(revision);
  const outputPath = resolveOutputPath(args.outputPath, revision.shortCommit);

  writeJsonFile(outputPath, report);
  console.log(`Wrote multiplayer protocol compatibility report to ${path.relative(process.cwd(), outputPath)}`);

  if (report.summary.status === "incompatible") {
    for (const entry of report.entries.filter((candidate) => candidate.status === "incompatible")) {
      console.error(`${entry.id}: ${entry.summary}${entry.diff ? ` (${entry.diff})` : ""}`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
