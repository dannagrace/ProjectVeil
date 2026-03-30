import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const CONTRACT_SNAPSHOT_UPDATE_COMMAND = "UPDATE_CONTRACT_SNAPSHOTS=1 npm run test:contracts";

function shouldUpdateContractSnapshots(): boolean {
  const value = process.env.UPDATE_CONTRACT_SNAPSHOTS?.trim().toLowerCase();
  return value === "1" || value === "true";
}

function formatSnapshot(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function describeFirstDifference(expected: string, actual: string): string {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const maxLineCount = Math.max(expectedLines.length, actualLines.length);

  for (let index = 0; index < maxLineCount; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return `line ${index + 1}\nexpected: ${JSON.stringify(expectedLines[index] ?? "")}\nactual:   ${JSON.stringify(actualLines[index] ?? "")}`;
    }
  }

  return "contents differ";
}

export interface ContractSnapshotComparison {
  status: "matched" | "missing" | "changed";
  relativeSnapshotPath: string;
  expected?: string;
  actual: string;
  difference?: string;
}

export function compareContractSnapshot(snapshotFilePath: string, value: unknown): ContractSnapshotComparison {
  const actual = formatSnapshot(value);
  const relativeSnapshotPath = path.relative(process.cwd(), snapshotFilePath);

  if (!existsSync(snapshotFilePath)) {
    return {
      status: "missing",
      relativeSnapshotPath,
      actual
    };
  }

  const expected = readFileSync(snapshotFilePath, "utf8");
  if (expected !== actual) {
    return {
      status: "changed",
      relativeSnapshotPath,
      expected,
      actual,
      difference: describeFirstDifference(expected, actual)
    };
  }

  return {
    status: "matched",
    relativeSnapshotPath,
    expected,
    actual
  };
}

export function assertContractSnapshot(snapshotFilePath: string, value: unknown): void {
  if (shouldUpdateContractSnapshots()) {
    const actual = formatSnapshot(value);
    mkdirSync(path.dirname(snapshotFilePath), { recursive: true });
    writeFileSync(snapshotFilePath, actual, "utf8");
    return;
  }

  const comparison = compareContractSnapshot(snapshotFilePath, value);

  if (comparison.status === "missing") {
    assert.fail(
      [
        `Missing contract snapshot: ${comparison.relativeSnapshotPath}`,
        `Create or refresh it with: ${CONTRACT_SNAPSHOT_UPDATE_COMMAND}`
      ].join("\n")
    );
  }

  if (comparison.status === "changed") {
    assert.fail(
      [
        `Contract snapshot mismatch: ${comparison.relativeSnapshotPath}`,
        comparison.difference ?? "contents differ",
        `If this structural change is intentional, review the diff and rerun: ${CONTRACT_SNAPSHOT_UPDATE_COMMAND}`
      ].join("\n")
    );
  }
}
