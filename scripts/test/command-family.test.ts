import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { runFamilyCli } from "../ops/command-family.ts";

test("runFamilyCli shell-quotes forwarded args to avoid command substitution", () => {
  const markerPath = resolve(tmpdir(), `project-veil-command-family-${process.pid}-${Date.now()}`);
  rmSync(markerPath, { force: true });

  runFamilyCli({
    family: "validate",
    argv: ["assets", "--", `$(touch ${markerPath})`],
  });

  assert.equal(existsSync(markerPath), false);
});

test("runFamilyCli stops long-running smoke commands when runtime preflight fails", () => {
  const exitCode = runFamilyCli({
    family: "smoke",
    argv: ["client:boot-room"],
    assertSupportedRuntimeImpl: () => {
      throw new Error("unsupported runtime");
    }
  });

  assert.equal(exitCode, 1);
});

test("runFamilyCli handles forwarded subcommand help without spawning the runner", () => {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    const exitCode = runFamilyCli({
      family: "release",
      argv: ["candidate:evidence:freshness-guard", "--", "--help"],
      assertSupportedRuntimeImpl: () => {
        throw new Error("preflight should not run for forwarded help");
      }
    });

    assert.equal(exitCode, 0);
    assert.match(output, /Usage: npm run release -- \[command\] \[-- args\.\.\.\]/);
    assert.match(output, /candidate:evidence:freshness-guard/);
  } finally {
    process.stdout.write = originalWrite;
  }
});
