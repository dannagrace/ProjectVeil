import assert from "node:assert/strict";
import test from "node:test";

import { buildRootTestArgs, ROOT_TEST_CONCURRENCY } from "../run-root-tests.ts";

test("root test runner caps node:test file concurrency before tracked test files", () => {
  const args = buildRootTestArgs(["scripts/test/example.test.ts"]);

  assert.equal(ROOT_TEST_CONCURRENCY, "4");
  assert.deepEqual(args.slice(0, 4), ["--import", "tsx", "--test", "--test-concurrency=4"]);
  assert.deepEqual(args.slice(4), ["scripts/test/example.test.ts"]);
});
