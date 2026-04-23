import assert from "node:assert/strict";
import test from "node:test";

import { timingSafeCompareAdminToken } from "@server/infra/admin-token";

test("timingSafeCompareAdminToken rejects missing and mismatched tokens", () => {
  assert.equal(timingSafeCompareAdminToken(undefined, "admin-token"), false);
  assert.equal(timingSafeCompareAdminToken("wrong-token", "admin-token"), false);
  assert.equal(timingSafeCompareAdminToken("short", "admin-token"), false);
});

test("timingSafeCompareAdminToken accepts the matching token", () => {
  assert.equal(timingSafeCompareAdminToken("admin-token", "admin-token"), true);
});
