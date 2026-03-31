import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const COCOS_TEST_DIR = path.resolve(__dirname);
const REMOVED_BUILD_HELPER_IMPORT = "../assets/scripts/cocos-wechat-build.ts";
const CANONICAL_BUILD_HELPER_IMPORT = "../tooling/cocos-wechat-build.ts";

test("Cocos WeChat validation suites import build helpers from tooling", () => {
  const testFiles = fs
    .readdirSync(COCOS_TEST_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(COCOS_TEST_DIR, entry.name));

  const filesReferencingBuildHelper = testFiles.filter((filePath) =>
    fs.readFileSync(filePath, "utf8").match(/from\s+["']\.\.\/(?:assets\/scripts|tooling)\/cocos-wechat-build\.ts["']/)
  );

  assert.ok(filesReferencingBuildHelper.length > 0, "Expected at least one Cocos test to cover the WeChat build helper.");

  for (const filePath of filesReferencingBuildHelper) {
    const source = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(
      source,
      new RegExp(REMOVED_BUILD_HELPER_IMPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${path.basename(filePath)} still imports the removed asset-tree WeChat build helper path.`
    );
    assert.match(
      source,
      new RegExp(CANONICAL_BUILD_HELPER_IMPORT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `${path.basename(filePath)} should import the WeChat build helper from tooling/.`
    );
  }
});
