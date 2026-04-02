import assert from "node:assert/strict";
import test from "node:test";

import { inferValidationPlan, renderValidationPlan } from "../minimal-validation-plan.ts";

test("maps a cocos client change to the Cocos delivery baseline", () => {
  const plan = inferValidationPlan(["apps/cocos-client/assets/scripts/VeilRoot.ts"]);

  assert.deepEqual(plan.matchedSurfaces.map((surface) => surface.id), ["cocos-primary-client"]);
  assert.deepEqual(
    plan.requiredSteps.map((step) => step.command ?? step.summary),
    ["npm run typecheck:cocos", "npm run check:wechat-build"]
  );
  assert.deepEqual(plan.optionalSteps.map((step) => step.command), [
    "npm run audit:cocos-primary-delivery -- --output-dir apps/cocos-client/test/fixtures/wechatgame-export --artifacts-dir artifacts/wechat-release --expect-exported-runtime"
  ]);
});

test("combines mixed server, content, and docs surfaces into one deduped plan", () => {
  const plan = inferValidationPlan([
    "apps/server/src/index.ts",
    "configs/battle-balance.json",
    "docs/verification-matrix.md"
  ]);

  assert.deepEqual(
    plan.matchedSurfaces.map((surface) => surface.id),
    ["docs-process", "server-runtime", "content-config"]
  );
  assert.deepEqual(
    plan.requiredSteps.map((step) => step.command ?? step.summary),
    [
      "Review rendered Markdown plus every edited path and command reference.",
      "npm run typecheck:server",
      "Run the nearest targeted `node:test` suite for the touched server subsystem.",
      "npm run validate:content-pack"
    ]
  );
  assert.ok(plan.optionalSteps.some((step) => step.command === "npm run validate:battle"));
  assert.ok(plan.optionalSteps.some((step) => step.command === "npm run validate:quickstart"));
  assert.ok(plan.humanOverrides.some((entry) => entry.includes("crosses multiple surfaces")));
});

test("flags release packaging and observability diagnostics without inventing new gates", () => {
  const plan = inferValidationPlan([
    "scripts/package-wechat-minigame-release.ts",
    "apps/server/src/observability.ts"
  ]);

  assert.deepEqual(
    plan.requiredSteps.map((step) => step.command ?? step.summary),
    [
      "npm run typecheck:server",
      "Run the nearest targeted `node:test` suite for the touched server subsystem.",
      "npm run check:wechat-build"
    ]
  );
  assert.ok(plan.optionalSteps.some((step) => step.command === "npm run validate:wechat-rc"));
  assert.ok(plan.optionalSteps.some((step) => step.command === "npm run release:health:summary"));
  assert.ok(plan.optionalSteps.every((step) => step.command?.startsWith("npm run") ?? true));
});

test("keeps unmatched paths visible so humans can widen the plan", () => {
  const plan = inferValidationPlan(["unknown/path.txt"]);

  assert.deepEqual(plan.matchedSurfaces.map((surface) => surface.id), []);
  assert.deepEqual(plan.unmatchedPaths, ["unknown/path.txt"]);
  assert.ok(plan.humanOverrides.some((entry) => entry.includes("did not match a maintained surface")));
  assert.match(renderValidationPlan(plan), /### Unmatched paths/);
});

test("renders markdown output that is ready for PR comments", () => {
  const plan = inferValidationPlan([
    "apps/server/src/index.ts",
    "docs/verification-matrix.md"
  ]);

  const rendered = renderValidationPlan(plan, { comparisonLabel: "origin/main...HEAD" });

  assert.match(rendered, /^## Recommended Minimal Validation Plan/m);
  assert.match(rendered, /Comparison: `origin\/main\.\.\.HEAD`/);
  assert.match(rendered, /### Changed surfaces/);
  assert.match(rendered, /- \*\*Docs or process guidance\*\*:/);
  assert.match(rendered, /### Required checks/);
  assert.match(rendered, /- \[ \] `npm run typecheck:server`/);
  assert.match(rendered, /Required because: Server runtime/);
  assert.match(rendered, /### Reviewer notes/);
});
