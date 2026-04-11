import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  buildReleaseScriptInventoryEntries,
  INVENTORY_OUTPUT_PATH,
  listRelevantPackageScripts,
  renderReleaseScriptInventoryMarkdown,
} from "../release-script-inventory.ts";

test("release script inventory covers every relevant package script", () => {
  const expectedScripts = listRelevantPackageScripts().map(([script]) => script);
  const actualScripts = buildReleaseScriptInventoryEntries().map((entry) => entry.script);

  assert.deepEqual(actualScripts, expectedScripts);
});

test("release script inventory markdown stays in sync with package.json", () => {
  const expectedMarkdown = renderReleaseScriptInventoryMarkdown(buildReleaseScriptInventoryEntries());
  const actualMarkdown = fs.readFileSync(INVENTORY_OUTPUT_PATH, "utf8");

  assert.equal(actualMarkdown, expectedMarkdown);
});

test("release script inventory records key release artifact families", () => {
  const entries = new Map(buildReleaseScriptInventoryEntries().map((entry) => [entry.script, entry]));

  assert.match(entries.get("release:gate:summary")?.producedArtifacts.join("\n") ?? "", /release-gate-summary-/);
  assert.match(entries.get("release:phase1:candidate-dossier")?.producedArtifacts.join("\n") ?? "", /phase1-candidate-dossier-/);
  assert.match(entries.get("release:phase1:candidate-rehearsal")?.purpose ?? "", /canonical packet-level entrypoint/i);
  assert.match(entries.get("release:phase1:candidate-rehearsal")?.producedArtifacts.join("\n") ?? "", /runtime observability gate/i);
  assert.match(entries.get("validate:wechat-rc")?.producedArtifacts.join("\n") ?? "", /codex\.wechat\.release-candidate-summary/);
  assert.match(entries.get("release:readiness:snapshot")?.requiredInputs.join("\n") ?? "", /validate:map-object-visuals/);
  assert.match(entries.get("validate:map-object-visuals")?.purpose ?? "", /visual key is missing/i);
});
