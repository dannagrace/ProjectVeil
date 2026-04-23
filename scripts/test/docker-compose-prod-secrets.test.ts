import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const composePath = resolve(repoRoot, "docker-compose.prod.yml");

test("production compose requires MYSQL_ROOT_PASSWORD instead of shipping a weak fallback", async () => {
  const composeContents = await readFile(composePath, "utf8");

  assert.doesNotMatch(composeContents, /MYSQL_ROOT_PASSWORD:\s*\$\{MYSQL_ROOT_PASSWORD:-/);
  assert.match(
    composeContents,
    /MYSQL_ROOT_PASSWORD:\s*\$\{MYSQL_ROOT_PASSWORD:\?MYSQL_ROOT_PASSWORD required for production compose\}/
  );
});
