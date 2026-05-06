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
  assert.match(output, /readiness 像素 正式 \d+\/\d+ · 音频 正式 8\/8 · 动画 序列 \d+\/\d+/);
});

test("validate:assets strict mode passes when cocos presentation is release-ready", () => {
  const output = execFileSync("node", ["--import", "tsx", "./scripts/validate-assets.ts", "--require-cocos-release-ready"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: "pipe"
  });

  assert.match(output, /Asset validation passed:/);
  assert.doesNotMatch(output, /Cocos primary client is not release-ready/);
});
