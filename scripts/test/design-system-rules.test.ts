import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");

test("design-system rules expose token source and Figma-to-code verification contract", () => {
  const tokenPath = path.join(repoRoot, "configs/project-veil-design-tokens.json");
  const docPath = path.join(repoRoot, "docs/design-system-rules.md");
  const tokens = JSON.parse(fs.readFileSync(tokenPath, "utf8")) as {
    sourceOfTruth: Record<string, string>;
    color: Record<string, string>;
    componentRoles: Record<string, unknown>;
  };
  const doc = fs.readFileSync(docPath, "utf8");

  assert.equal(tokens.sourceOfTruth.tokens, "configs/project-veil-design-tokens.json");
  assert.equal(tokens.sourceOfTruth.h5Css, "apps/client/src/styles.css");
  assert.equal(tokens.sourceOfTruth.cocosPresentation, "configs/cocos-presentation.json");
  assert.equal(typeof tokens.color.primary, "string");
  assert.ok(tokens.componentRoles.primaryAction);
  assert.ok(tokens.componentRoles.assetStageChip);
  assert.match(doc, /Figma-to-code/i);
  assert.match(doc, /H5 lobby\/HUD/);
  assert.match(doc, /Cocos Lobby\/HUD\/battle/);
  assert.match(doc, /screenshots or visual evidence/);
  assert.match(doc, /Creator preview/);
  assert.match(doc, /WeChat safe-area evidence/);
});
