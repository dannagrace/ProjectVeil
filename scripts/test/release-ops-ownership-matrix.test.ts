import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { buildReleaseScriptInventoryEntries } from "../release-script-inventory.ts";
import {
  buildReleaseOpsOwnershipEntries,
  OWNERSHIP_OUTPUT_PATH,
  renderReleaseOpsOwnershipMarkdown,
} from "../release-ops-ownership-matrix.ts";

test("release-ops ownership matrix covers every relevant inventory script", () => {
  const expectedScripts = buildReleaseScriptInventoryEntries().map((entry) => entry.script);
  const actualScripts = buildReleaseOpsOwnershipEntries().map((entry) => entry.script);

  assert.deepEqual(actualScripts, expectedScripts);
});

test("release-ops ownership matrix markdown stays in sync with inventory metadata", () => {
  const expectedMarkdown = renderReleaseOpsOwnershipMarkdown(buildReleaseOpsOwnershipEntries());
  const actualMarkdown = fs.readFileSync(OWNERSHIP_OUTPUT_PATH, "utf8");

  assert.equal(actualMarkdown, expectedMarkdown);
});

test("release-ops ownership matrix marks authoritative gate owners for key release scopes", () => {
  const entries = new Map(buildReleaseOpsOwnershipEntries().map((entry) => [entry.script, entry]));

  assert.equal(entries.get("release:gate:summary")?.scope, "candidate-level");
  assert.equal(entries.get("release:gate:summary")?.decisionRole, "authoritative gate");

  assert.equal(entries.get("release:phase1:same-revision-evidence-bundle")?.scope, "same-revision");
  assert.equal(entries.get("release:candidate:evidence-audit")?.scope, "same-candidate");
  assert.equal(entries.get("release:runtime-observability:gate")?.scope, "runtime");
  assert.equal(entries.get("validate:wechat-rc")?.scope, "wechat-release");
  assert.equal(entries.get("release:health:summary")?.scope, "review-aid");
  assert.equal(entries.get("release:health:summary")?.reviewTreatment, "review aid");
});
