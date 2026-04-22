import { mkdir, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cocosPixelRoot = path.join(repoRoot, "apps", "cocos-client", "assets", "resources", "pixel");
const h5PixelRoot = path.join(repoRoot, "apps", "client", "public", "assets", "pixel");
const mirroredDirectories = ["heroes", "units", "showcase-units", "markers", "frames"];

async function copyPngDirectory(directoryName) {
  const sourceDir = path.join(cocosPixelRoot, directoryName);
  const targetDir = path.join(h5PixelRoot, directoryName);
  await mkdir(targetDir, { recursive: true });

  const entries = await readdir(sourceDir, { withFileTypes: true });
  const pngEntries = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".png"));

  await Promise.all(
    pngEntries.map((entry) =>
      copyFile(path.join(sourceDir, entry.name), path.join(targetDir, entry.name))
    )
  );

  return { directoryName, copied: pngEntries.length };
}

const results = await Promise.all(mirroredDirectories.map((directoryName) => copyPngDirectory(directoryName)));
for (const result of results) {
  console.log(`[sync-h5-character-art-pack] ${result.directoryName}: copied ${result.copied} png file(s)`);
}
