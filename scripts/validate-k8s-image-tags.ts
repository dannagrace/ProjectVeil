import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface ImagePinViolation {
  image: string;
  line: number;
}

const DEFAULT_MANIFEST_PATH = resolve(process.cwd(), "k8s", "deployment.yaml");

function parseArgs(argv: string[]): { manifestPath: string } {
  let manifestPath = DEFAULT_MANIFEST_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") {
      manifestPath = resolve(argv[index + 1] ?? manifestPath);
      index += 1;
    }
  }

  return { manifestPath };
}

function isPinnedImageReference(image: string): boolean {
  if (image.includes("@sha256:")) {
    return true;
  }

  const lastSlashIndex = image.lastIndexOf("/");
  const lastColonIndex = image.lastIndexOf(":");
  return lastColonIndex > lastSlashIndex;
}

function findUnpinnedImages(manifestContents: string): ImagePinViolation[] {
  const violations: ImagePinViolation[] = [];

  for (const [index, line] of manifestContents.split(/\r?\n/).entries()) {
    const match = line.match(/^\s*image:\s*(\S+)\s*$/);
    if (!match) {
      continue;
    }

    const image = match[1];
    if (!isPinnedImageReference(image)) {
      violations.push({ image, line: index + 1 });
    }
  }

  return violations;
}

async function validateK8sImageTags(manifestPath: string): Promise<ImagePinViolation[]> {
  const contents = await readFile(manifestPath, "utf8");
  return findUnpinnedImages(contents);
}

async function main(): Promise<void> {
  const { manifestPath } = parseArgs(process.argv.slice(2));
  const violations = await validateK8sImageTags(manifestPath);

  if (violations.length === 0) {
    console.log(`Kubernetes image tag gate: PASS (${manifestPath})`);
    return;
  }

  console.error(`Kubernetes image tag gate: FAIL (${manifestPath})`);
  for (const violation of violations) {
    console.error(`- line ${violation.line}: image must include an explicit tag or digest (${violation.image})`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(`Kubernetes image tag gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { findUnpinnedImages, validateK8sImageTags };
