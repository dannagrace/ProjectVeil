import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultEquipmentCatalog, validateEquipmentCatalog } from "../src/index.ts";

test("validateEquipmentCatalog accepts the shipped catalog", () => {
  assert.doesNotThrow(() => validateEquipmentCatalog(getDefaultEquipmentCatalog()));
});

test("validateEquipmentCatalog rejects stale equipment stat keys", () => {
  const catalog = getDefaultEquipmentCatalog();
  const brokenEntry = {
    ...catalog.entries[0]!,
    bonuses: {
      ...catalog.entries[0]!.bonuses,
      magicResist: 4
    }
  };

  assert.throws(
    () =>
      validateEquipmentCatalog({
        entries: [brokenEntry, ...catalog.entries.slice(1)]
      }),
    /unknown equipment stat bonus: magicResist/
  );
});
