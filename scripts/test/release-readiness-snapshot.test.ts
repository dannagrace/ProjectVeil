import assert from "node:assert/strict";
import fs from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildCommandInvocation } from "../release-readiness-snapshot.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "release-readiness-snapshot.ts");

test("release-readiness-snapshot reuses the current npm/node toolchain for nested npm commands", () => {
  const previousNpmExecPath = process.env.npm_execpath;
  const previousNpmNodeExecPath = process.env.npm_node_execpath;
  const previousLifecycleEvent = process.env.npm_lifecycle_event;
  const previousLifecycleScript = process.env.npm_lifecycle_script;
  const previousCommand = process.env.npm_command;

  process.env.npm_execpath = "/tmp/npm-cli.js";
  process.env.npm_node_execpath = "/tmp/node";
  process.env.npm_lifecycle_event = "release";
  process.env.npm_lifecycle_script = "node --import tsx ./scripts/release/cli.ts readiness:snapshot";
  process.env.npm_command = "run-script";

  try {
    const invocation = buildCommandInvocation("npm test -- e2e:smoke");

    assert.equal(invocation.file, "/tmp/node");
    assert.deepEqual(invocation.args, ["/tmp/npm-cli.js", "test", "--", "e2e:smoke"]);
    assert.equal(invocation.shell, false);
    assert.equal(invocation.env.npm_lifecycle_event, undefined);
    assert.equal(invocation.env.npm_lifecycle_script, undefined);
    assert.equal(invocation.env.npm_command, undefined);
  } finally {
    if (previousNpmExecPath === undefined) {
      delete process.env.npm_execpath;
    } else {
      process.env.npm_execpath = previousNpmExecPath;
    }
    if (previousNpmNodeExecPath === undefined) {
      delete process.env.npm_node_execpath;
    } else {
      process.env.npm_node_execpath = previousNpmNodeExecPath;
    }
    if (previousLifecycleEvent === undefined) {
      delete process.env.npm_lifecycle_event;
    } else {
      process.env.npm_lifecycle_event = previousLifecycleEvent;
    }
    if (previousLifecycleScript === undefined) {
      delete process.env.npm_lifecycle_script;
    } else {
      process.env.npm_lifecycle_script = previousLifecycleScript;
    }
    if (previousCommand === undefined) {
      delete process.env.npm_command;
    } else {
      process.env.npm_command = previousCommand;
    }
  }
});

test("release-readiness-snapshot includes map-object visuals as a required automated gate", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-release-readiness-snapshot-"));
  const outputPath = path.join(tempDir, "release-readiness.json");

  const result = await import("node:child_process").then(({ execFileSync }) =>
    execFileSync("node", ["--import", "tsx", scriptPath, "--no-run", "--output", outputPath], {
      cwd: repoRoot,
      encoding: "utf8"
    })
  );

  assert.match(result, /Overall status: pending/);

  const snapshot = JSON.parse(fs.readFileSync(outputPath, "utf8")) as {
    summary: { total: number; pending: number; status: string };
    checks: Array<{
      id: string;
      kind: string;
      required: boolean;
      status: string;
      command?: string;
    }>;
  };

  const mapObjectVisuals = snapshot.checks.find((check) => check.id === "map-object-visuals");
  assert.ok(mapObjectVisuals);
  assert.equal(mapObjectVisuals.kind, "automated");
  assert.equal(mapObjectVisuals.required, true);
  assert.equal(mapObjectVisuals.status, "pending");
  assert.equal(mapObjectVisuals.command, "npm run validate -- map-object-visuals");
  assert.equal(snapshot.summary.status, "pending");
  assert.equal(snapshot.summary.pending, snapshot.summary.total);
});
