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
