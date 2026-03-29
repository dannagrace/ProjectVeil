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

function describeFirstDifference(expected: string, actual: string): string {
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

export function assertContractSnapshot(snapshotFilePath: string, value: unknown): void {
  const actual = formatSnapshot(value);
  const relativeSnapshotPath = path.relative(process.cwd(), snapshotFilePath);

  if (shouldUpdateContractSnapshots()) {
    mkdirSync(path.dirname(snapshotFilePath), { recursive: true });
    writeFileSync(snapshotFilePath, actual, "utf8");
    return;
  }

  if (!existsSync(snapshotFilePath)) {
    assert.fail(
      [
        `Missing contract snapshot: ${relativeSnapshotPath}`,
        `Create or refresh it with: ${CONTRACT_SNAPSHOT_UPDATE_COMMAND}`
      ].join("\n")
    );
  }

  const expected = readFileSync(snapshotFilePath, "utf8");
  if (expected !== actual) {
    assert.fail(
      [
        `Contract snapshot mismatch: ${relativeSnapshotPath}`,
        describeFirstDifference(expected, actual),
        `If this structural change is intentional, review the diff and rerun: ${CONTRACT_SNAPSHOT_UPDATE_COMMAND}`
      ].join("\n")
    );
  }
}
