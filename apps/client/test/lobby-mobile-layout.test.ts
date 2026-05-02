import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = process.cwd();

test("H5 lobby keeps mobile first viewport focused on the primary room-entry flow", () => {
  const mainSource = fs.readFileSync(path.join(repoRoot, "apps/client/src/main.ts"), "utf8");
  const styles = fs.readFileSync(path.join(repoRoot, "apps/client/src/styles.css"), "utf8");

  assert.match(mainSource, /data-lobby-primary-flow="true"/);
  assert.match(mainSource, /data-lobby-primary-entry="true"/);
  assert.match(mainSource, /data-lobby-secondary-auth="true"/);
  assert.match(mainSource, /<details class="lobby-auth-disclosure"/);
  assert.match(mainSource, /正式注册 \/ 密码找回/);
  assert.match(mainSource, /data-registration-token="true"/);
  assert.match(mainSource, /data-recovery-token="true"/);

  assert.match(styles, /\.lobby-primary-flow,\n\.lobby-secondary-flow/);
  assert.match(styles, /\.lobby-auth-card-primary/);
  assert.match(styles, /@media \(max-width: 1100px\) \{[\s\S]*\.lobby-panel \{[\s\S]*order: -1;/);
  assert.match(styles, /@media \(max-width: 1100px\) \{[\s\S]*\.lobby-hero-copy \{[\s\S]*display: none;/);
});
