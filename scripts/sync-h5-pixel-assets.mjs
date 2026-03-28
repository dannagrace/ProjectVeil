import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");

const copies = [
  ["apps/cocos-client/assets/resources/placeholder/tiles/grass-1.png", "apps/client/public/assets/pixel/terrain/grass-tile.png"],
  ["apps/cocos-client/assets/resources/placeholder/tiles/grass-2.png", "apps/client/public/assets/pixel/terrain/grass-tile-alt.png"],
  ["apps/cocos-client/assets/resources/placeholder/tiles/dirt-1.png", "apps/client/public/assets/pixel/terrain/dirt-tile.png"],
  ["apps/cocos-client/assets/resources/placeholder/tiles/dirt-2.png", "apps/client/public/assets/pixel/terrain/dirt-tile-alt.png"],
  ["apps/cocos-client/assets/resources/placeholder/tiles/sand-1.png", "apps/client/public/assets/pixel/terrain/sand-tile.png"],
  ["apps/cocos-client/assets/resources/placeholder/tiles/sand-2.png", "apps/client/public/assets/pixel/terrain/sand-tile-alt.png"],
  ["apps/cocos-client/assets/resources/placeholder/tiles/water-1.png", "apps/client/public/assets/pixel/terrain/water-tile.png"],
  ["apps/cocos-client/assets/resources/placeholder/tiles/water-2.png", "apps/client/public/assets/pixel/terrain/water-tile-alt.png"],
  ["apps/cocos-client/assets/resources/placeholder/tiles/unknown-1.png", "apps/client/public/assets/pixel/terrain/fog-tile.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/gold.png", "apps/client/public/assets/pixel/resources/gold-pile.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/wood.png", "apps/client/public/assets/pixel/resources/wood-stack.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/ore.png", "apps/client/public/assets/pixel/resources/ore-crate.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/recruitment.png", "apps/client/public/assets/pixel/buildings/recruitment-post.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/shrine.png", "apps/client/public/assets/pixel/buildings/attribute-shrine.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/mine.png", "apps/client/public/assets/pixel/buildings/resource-mine.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/hero.png", "apps/client/public/assets/pixel/units/hero-guard-basic.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/hero.png", "apps/client/public/assets/pixel/units/hero-guard-basic-selected.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/hero.png", "apps/client/public/assets/pixel/units/hero-guard-basic-hit.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/neutral.png", "apps/client/public/assets/pixel/units/wolf-pack.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/neutral.png", "apps/client/public/assets/pixel/units/wolf-pack-selected.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/neutral.png", "apps/client/public/assets/pixel/units/wolf-pack-hit.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/hero.png", "apps/client/public/assets/pixel/markers/hero-marker.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/hero.png", "apps/client/public/assets/pixel/markers/hero-marker-selected.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/hero.png", "apps/client/public/assets/pixel/markers/hero-marker-hit.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/neutral.png", "apps/client/public/assets/pixel/markers/neutral-marker.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/neutral.png", "apps/client/public/assets/pixel/markers/neutral-marker-selected.png"],
  ["apps/cocos-client/assets/resources/placeholder/icons/neutral.png", "apps/client/public/assets/pixel/markers/neutral-marker-hit.png"]
];

const missingSources = copies
  .map(([from]) => from)
  .filter((from) => !existsSync(resolve(rootDir, from)));

if (missingSources.length > 0) {
  console.error("Missing source assets:");
  for (const source of missingSources) {
    console.error(`- ${source}`);
  }
  process.exit(1);
}

for (const [from, to] of copies) {
  const sourcePath = resolve(rootDir, from);
  const targetPath = resolve(rootDir, to);
  mkdirSync(dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath);
}

console.log(`Synced ${copies.length} H5 pixel assets from Cocos placeholder resources.`);
