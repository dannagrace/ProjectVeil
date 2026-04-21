import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("shared import boundary guard rejects @veil/shared/index shortcuts", { concurrency: false }, () => {
  const probePath = resolve(ROOT_DIR, "apps/client/src/__shared-import-boundary-probe__.ts");
  writeFileSync(probePath, 'import "@veil/shared/index";\n', "utf8");

  try {
    const result = spawnSync(process.execPath, ["./scripts/check-shared-import-boundaries.mjs"], {
      cwd: ROOT_DIR,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /@veil\/shared\/index/);
  } finally {
    rmSync(probePath, { force: true });
  }
});
