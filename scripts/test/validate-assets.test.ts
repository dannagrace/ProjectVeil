import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

test("validate:assets passes in baseline mode", () => {
  const output = execFileSync("node", ["--import", "tsx", "./scripts/validate-assets.ts"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe"
  });

  assert.match(output, /Asset validation passed:/);
  assert.match(output, /readiness 像素 占位/);
});

test("validate:assets strict mode fails when cocos presentation is not release-ready", () => {
  assert.throws(
    () =>
      execFileSync("node", ["--import", "tsx", "./scripts/validate-assets.ts", "--require-cocos-release-ready"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "pipe"
      }),
    /Cocos primary client is not release-ready: 正式像素美术, 真实 BGM\/SFX/
  );
});
