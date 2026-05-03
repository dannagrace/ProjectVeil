import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function findDuplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }
  return Array.from(duplicates).sort();
}

test("admin audit action contract lists each action once", () => {
  const source = readFileSync(new URL("../src/persistence/mysql/store.ts", import.meta.url), "utf8");
  const typeBlock = source.match(/export type AdminAuditAction =([\s\S]*?);/);
  const switchBlock = source.match(/function normalizeAdminAuditAction\(value: string\): AdminAuditAction \{[\s\S]*?switch \(value\) \{([\s\S]*?)\s*default:/);

  assert.ok(typeBlock, "AdminAuditAction union should be present");
  assert.ok(switchBlock, "normalizeAdminAuditAction switch should be present");

  const typeActions = Array.from(typeBlock[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
  const switchActions = Array.from(switchBlock[1].matchAll(/case "([^"]+)":/g), (match) => match[1]);

  assert.deepEqual(findDuplicates(typeActions), []);
  assert.deepEqual(findDuplicates(switchActions), []);
  assert.deepEqual([...switchActions].sort(), [...typeActions].sort());
});
