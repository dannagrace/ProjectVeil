import { existsSync } from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const stagingDir = path.join(rootDir, "external-assets/issue-33-open-source");
const requirePack = process.argv.includes("--require-pack");

const requiredSlots = [
  "heroes/hero-01.png",
  "heroes/hero-02.png",
  "heroes/hero-03.png",
  "heroes/hero-04.png",
  "units/unit-01.png",
  "units/unit-02.png",
  "units/unit-03.png",
  "units/unit-04.png",
  "units/unit-05.png",
  "units/unit-06.png",
  "units/unit-07.png",
  "units/unit-08.png",
  "terrain/grass.png",
  "terrain/mountain.png",
  "terrain/water.png",
  "terrain/desert.png",
  "terrain/snow.png",
  "buildings/recruitment-post.png",
  "buildings/attribute-shrine.png",
  "buildings/resource-mine.png",
  "buildings/forge.png",
  "spine/idle/",
  "spine/attack/",
  "spine/hit/",
  "spine/death/",
  "audio/bgm-explore.ogg",
  "audio/bgm-battle.ogg",
  "audio/sfx-attack.ogg",
  "audio/sfx-skill.ogg",
  "audio/sfx-hit.ogg",
  "audio/sfx-levelup.ogg",
  "manifest.json",
  "LICENSE.txt"
];

if (!existsSync(stagingDir)) {
  const message = [
    `Issue #33 open-source art staging directory not found: ${path.relative(rootDir, stagingDir)}`,
    "Expected a local, untracked drop that follows docs/issue-33-asset-integration.md."
  ].join("\n");

  if (requirePack) {
    console.error(message);
    process.exit(1);
  }

  console.log(message);
  process.exit(0);
}

const missing = requiredSlots.filter((relativePath) => !existsSync(path.join(stagingDir, relativePath)));

if (missing.length > 0) {
  console.error("Issue #33 art staging is incomplete. Missing paths:");
  for (const relativePath of missing) {
    console.error(`- ${relativePath}`);
  }
  process.exit(1);
}

console.log(
  `Issue #33 art staging contract passed: ${requiredSlots.length} required entries found in ${path.relative(rootDir, stagingDir)}`
);
