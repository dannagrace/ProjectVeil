import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { createCommandEnvironment, runFamilyCli } from "../ops/command-family.ts";

test("runFamilyCli shell-quotes forwarded args to avoid command substitution", () => {
  const markerPath = resolve(tmpdir(), `project-veil-command-family-${process.pid}-${Date.now()}`);
  rmSync(markerPath, { force: true });
  let stderr = "";
  const originalStderrWrite = process.stderr.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    const exitCode = runFamilyCli({
      family: "validate",
      argv: ["assets", "--", `$(touch ${markerPath})`],
    });

    assert.equal(exitCode, 1);
    assert.equal(existsSync(markerPath), false);
    assert.match(stderr, /Unknown argument/);
    assert.doesNotMatch(stderr, /\n\s+at\s|Node\.js v\d+/);
  } finally {
    process.stderr.write = originalStderrWrite;
  }
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

test("createCommandEnvironment removes NO_COLOR for Playwright test commands", () => {
  const env = createCommandEnvironment("npm run validate -- e2e:fixtures && playwright test --project=smoke", {
    NO_COLOR: "1",
    PATH: "/usr/bin",
  });

  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.PATH, "/usr/bin");
});

test("createCommandEnvironment keeps NO_COLOR preferred for non-Playwright command conflicts", () => {
  const env = createCommandEnvironment("node --test ./scripts/test/example.test.ts", {
    FORCE_COLOR: "1",
    NO_COLOR: "1",
  });

  assert.equal(env.NO_COLOR, "1");
  assert.equal(env.FORCE_COLOR, undefined);
});
