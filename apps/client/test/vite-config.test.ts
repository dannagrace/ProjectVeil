import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

test("H5 build splits shared and debug-heavy client code into manual chunks", () => {
  const config = readFileSync(resolve(import.meta.dirname, "../vite.config.ts"), "utf8");

  assert.match(config, /manualChunks/);
  assert.match(config, /client-account-history/);
  assert.match(config, /cocos-share-card/);
  assert.match(config, /shared/);
});
