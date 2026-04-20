import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { renderFamilyHelp } from "../ops/command-family.ts";
import { COMMAND_INDEX_OUTPUT_PATH, renderCommandIndexMarkdown } from "../ops/command-index.ts";

test("command index markdown stays in sync", () => {
  const expectedMarkdown = renderCommandIndexMarkdown();
  const actualMarkdown = fs.readFileSync(COMMAND_INDEX_OUTPUT_PATH, "utf8");

  assert.equal(actualMarkdown, expectedMarkdown);
});

test("family help exposes the unified CLI usage surface", () => {
  assert.match(renderFamilyHelp("release"), /Usage: npm run release -- \[command\] \[-- args\.\.\.\]/);
  assert.match(renderFamilyHelp("release"), /gate:summary/);
  assert.match(renderFamilyHelp("validate"), /content-pack/);
  assert.match(renderFamilyHelp("test"), /Usage: npm test -- \[command\] \[-- args\.\.\.\]/);
  assert.match(renderFamilyHelp("typecheck"), /No subcommand runs the workspace base typecheck/);
});
