import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(__dirname, "../..");
const entrypointPath = path.join(repoRoot, "scripts", "run-quickstart-runtime-entrypoint.cjs");

test("quickstart runtime entrypoints fail before launching unsupported Node/npm runtimes", () => {
  for (const target of ["doctor", "validate-quickstart", "validate-quickstart-contract"]) {
    const result = spawnSync("node", [entrypointPath, target], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        PROJECT_VEIL_RUNTIME_NODE_VERSION: "v10.24.1",
        PROJECT_VEIL_RUNTIME_NPM_VERSION: "9.9.0"
      }
    });

    assert.equal(result.status, 1, `${target} stdout=${result.stdout}\nstderr=${result.stderr}`);
    assert.match(result.stderr, /Unsupported quickstart runtime detected/);
    assert.match(result.stderr, /engines\.node/);
    assert.match(result.stderr, /engines\.npm/);
    assert.match(result.stderr, /Install the repo runtime from `.nvmrc` and rerun `nvm use`\./);
    assert.match(result.stderr, /Install npm 10\.9\.3 or use the npm bundled with the repo's Node runtime\./);
    assert.match(result.stderr, /npm run doctor/);
  }
});

test("quickstart contract entrypoint forwards CLI args after runtime preflight passes", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "veil-quickstart-entrypoint-"));
  const outputPath = path.join(workspace, "quickstart-contract.json");
  const markdownOutputPath = path.join(workspace, "quickstart-contract.md");

  const result = spawnSync(
    "node",
    [
      entrypointPath,
      "validate-quickstart-contract",
      "--skip-runtime",
      "--output",
      outputPath,
      "--markdown-output",
      markdownOutputPath
    ],
    {
      cwd: repoRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.equal(fs.existsSync(outputPath), true, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.equal(fs.existsSync(markdownOutputPath), true, `stdout=${result.stdout}\nstderr=${result.stderr}`);
});
