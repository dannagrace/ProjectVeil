import assert from "node:assert/strict";
import test from "node:test";

import { requireValue, withOptionalProperty } from "../src/invariant.ts";

test("requireValue returns the provided value when it is not nullish", () => {
  const value = { id: "hero-1" };

  assert.strictEqual(requireValue(value, "missing_value"), value);
  assert.equal(requireValue(0, "missing_value"), 0);
  assert.equal(requireValue("", "missing_value"), "");
  assert.equal(requireValue(false, "missing_value"), false);
});

test("requireValue throws the provided message for nullish values", () => {
  assert.throws(() => requireValue(null, "missing_value"), /missing_value/);
  assert.throws(() => requireValue(undefined, "missing_value"), /missing_value/);
});

test("withOptionalProperty keeps the original object when the optional value is undefined", () => {
  const base = { id: "hero-1" };

  assert.strictEqual(withOptionalProperty(base, "title", undefined), base);
  assert.deepEqual(base, { id: "hero-1" });
});

test("withOptionalProperty adds the property when the optional value is defined", () => {
  const base = { id: "hero-1" };

  assert.deepEqual(withOptionalProperty(base, "title", "Captain"), {
    id: "hero-1",
    title: "Captain"
  });
});
