import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { listTrackedRootTestFiles } from "../root-test-discovery.ts";

test("root test discovery includes every tracked .test.ts file", () => {
  const expected = execFileSync("git", ["ls-files", "-z", "--", "*.test.ts"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  })
    .split("\0")
    .filter((filePath) => filePath.length > 0)
    .sort((left, right) => left.localeCompare(right));

  assert.deepEqual(listTrackedRootTestFiles(), expected);
});

test("root test discovery stays focused on node:test suites", () => {
  const discoveredFiles = listTrackedRootTestFiles();

  assert.ok(discoveredFiles.length > 0);
  assert.ok(discoveredFiles.every((filePath) => filePath.endsWith(".test.ts")));
  assert.ok(discoveredFiles.some((filePath) => filePath.startsWith("scripts/test/")));
  assert.ok(discoveredFiles.some((filePath) => filePath.startsWith("packages/shared/test/")));
  assert.ok(discoveredFiles.some((filePath) => filePath.startsWith("apps/server/test/")));
  assert.ok(discoveredFiles.some((filePath) => filePath.startsWith("apps/client/test/")));
  assert.ok(discoveredFiles.some((filePath) => filePath.startsWith("apps/cocos-client/test/")));
});
