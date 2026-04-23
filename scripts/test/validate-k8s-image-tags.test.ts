import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { findUnpinnedImages } from "../validate-k8s-image-tags.ts";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const scriptPath = join(repoRoot, "scripts", "validate-k8s-image-tags.ts");
const borrowedNodeModules = "/Users/grace/Documents/project/codex/ProjectVeil/node_modules";
const borrowedTsxLoader = `${borrowedNodeModules}/tsx/dist/loader.mjs`;

function buildDeployment(image: string): string {
  return `apiVersion: apps/v1
kind: Deployment
metadata:
  name: project-veil-server
spec:
  template:
    spec:
      containers:
        - name: server
          image: ${image}
`;
}

test("findUnpinnedImages flags images without a tag or digest", () => {
  const matches = findUnpinnedImages(buildDeployment("ghcr.io/dannagrace/projectveil-server"));

  assert.deepEqual(matches, [
    {
      image: "ghcr.io/dannagrace/projectveil-server",
      line: 10
    }
  ]);
});

test("findUnpinnedImages accepts tagged and digested images", () => {
  assert.deepEqual(findUnpinnedImages(buildDeployment("ghcr.io/dannagrace/projectveil-server:v0.0.0")), []);
  assert.deepEqual(
    findUnpinnedImages(buildDeployment("ghcr.io/dannagrace/projectveil-server@sha256:0123456789abcdef")),
    []
  );
});

test("validate:k8s-image-tags CLI succeeds for pinned images", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-k8s-image-pass-"));
  const manifestPath = join(tempDir, "deployment.yaml");
  await writeFile(manifestPath, buildDeployment("ghcr.io/dannagrace/projectveil-server:v0.0.0"), "utf8");

  const { stdout } = await execFileAsync(
    "node",
    ["--import", borrowedTsxLoader, scriptPath, "--manifest", manifestPath],
    {
      cwd: repoRoot,
      env: { ...process.env, NODE_PATH: borrowedNodeModules }
    }
  );

  assert.match(stdout, /Kubernetes image tag gate: PASS/);
});

test("validate:k8s-image-tags CLI reports unpinned images", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-k8s-image-fail-"));
  const manifestPath = join(tempDir, "deployment.yaml");
  await writeFile(manifestPath, buildDeployment("ghcr.io/dannagrace/projectveil-server"), "utf8");

  await assert.rejects(
    execFileAsync("node", ["--import", borrowedTsxLoader, scriptPath, "--manifest", manifestPath], {
      cwd: repoRoot,
      env: { ...process.env, NODE_PATH: borrowedNodeModules }
    }),
    (error: NodeJS.ErrnoException & { stderr?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr ?? "", /line 10: image must include an explicit tag or digest/);
      return true;
    }
  );
});

test("repo k8s deployment pins the server image tag", async () => {
  const manifestPath = join(repoRoot, "k8s", "deployment.yaml");
  const manifestContents = await readFile(manifestPath, "utf8");

  assert.deepEqual(findUnpinnedImages(manifestContents), []);
});
