import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRuntimePreflight,
  formatUnsupportedRuntimeMessage
} from "../runtime-preflight.mjs";

function createContract() {
  return {
    repoRoot: "/tmp/project-veil",
    packageJsonPath: "/tmp/project-veil/package.json",
    nvmrcPath: "/tmp/project-veil/.nvmrc",
    readmePath: "/tmp/project-veil/README.md",
    packageJson: {
      packageManager: "npm@10.9.3",
      engines: {
        node: ">=22 <25",
        npm: ">=10"
      }
    },
    nvmrcValue: "22",
    readmePrerequisites: {
      node: "Node.js 22 LTS（CI 同款；仓库提供 `.nvmrc`）",
      npm: "npm 10+"
    },
    nodeEngine: ">=22 <25",
    npmEngine: ">=10",
    packageManager: "npm@10.9.3",
    expectedNpmVersion: "10.9.3"
  };
}

test("runtime preflight formats actionable remediation for unsupported Node/npm", () => {
  const report = evaluateRuntimePreflight({
    contract: createContract(),
    nodeVersion: "v20.12.2",
    npmVersion: "9.9.0"
  });

  assert.equal(report.isSupported, false);
  const output = formatUnsupportedRuntimeMessage("npm run validate:quickstart", report);

  assert.match(output, /Unsupported runtime for `npm run validate:quickstart`/);
  assert.match(output, /README\.md prerequisites: Node\.js 22 LTS/);
  assert.match(output, /\.nvmrc: 22/);
  assert.match(output, /package\.json engines\.node: >=22 <25/);
  assert.match(output, /package\.json packageManager: npm@10\.9\.3/);
  assert.match(output, /Current Node v20\.12\.2 does not satisfy package\.json engines\.node/);
  assert.match(output, /Current npm 9\.9\.0 does not satisfy package\.json engines\.npm/);
  assert.match(output, /Run `nvm use` from the repo root to switch to Node 22/);
  assert.match(output, /Rerun `npm ci --no-audit --no-fund`, then retry `npm run validate:quickstart`/);
});
