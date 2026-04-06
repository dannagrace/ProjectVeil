import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();
const gitignorePath = path.join(repoRoot, ".gitignore");
const readmePath = path.join(repoRoot, "README.md");

test("gitignore excludes local Codex workspace artifacts", () => {
  const gitignore = fs.readFileSync(gitignorePath, "utf8");

  assert.match(gitignore, /^\.codex$/m);
  assert.match(gitignore, /^\.codex-last-\*\.txt$/m);
  assert.match(gitignore, /^\.codex-runs\/$/m);
});

test("README documents the local Codex artifact home", () => {
  const readme = fs.readFileSync(readmePath, "utf8");

  assert.match(readme, /本地 Codex 会话/);
  assert.match(readme, /`\.codex`、`\.codex-last-\*\.txt` 和 `\.codex-runs\/`/);
  assert.match(readme, /已被 `\.gitignore` 排除/);
});
