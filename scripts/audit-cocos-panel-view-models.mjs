import fs from "node:fs";
import path from "node:path";
import { cocosPanelAuthoringTargets } from "./cocos-panel-authoring-registry.mjs";

const repoRoot = process.cwd();
const coveredTargets = [];
const missingTargets = [];

for (const target of cocosPanelAuthoringTargets) {
  const viewFile = path.resolve(repoRoot, target.viewFile);
  const modelFile = path.resolve(path.dirname(viewFile), target.modelImport);
  const viewSource = fs.readFileSync(viewFile, "utf8");
  const covered = fs.existsSync(modelFile) && viewSource.includes(target.modelImport);

  if (covered) {
    coveredTargets.push(target);
  } else {
    missingTargets.push({
      ...target,
      modelPath: path.relative(repoRoot, modelFile),
    });
  }
}

const coveragePercent = (coveredTargets.length / cocosPanelAuthoringTargets.length) * 100;
console.log(
  `Cocos panel/view-model coverage: ${coveredTargets.length}/${cocosPanelAuthoringTargets.length} (${coveragePercent.toFixed(1)}%)`
);

for (const target of coveredTargets) {
  console.log(`- ok ${target.viewFile} -> ${target.modelImport}`);
}

if (missingTargets.length > 0) {
  console.error("\nMissing panel/view-model pairs:");
  for (const target of missingTargets) {
    console.error(`- ${target.viewFile} -> ${target.modelPath}`);
  }
}

if (coveragePercent < 80) {
  console.error(`\nExpected at least 80% panel/view-model coverage, got ${coveragePercent.toFixed(1)}%.`);
  process.exit(1);
}
