import { checkProjectSharedParity } from "./project-shared-parity.mjs";

const report = checkProjectSharedParity();

if (!report.hasViolations) {
  console.log("project-shared parity check passed.");
  process.exit(0);
}

console.error("project-shared parity violations found:");

if (report.missingFiles.length > 0) {
  console.error("- Missing mirrored files:");
  for (const filePath of report.missingFiles) {
    console.error(`  - ${filePath}`);
  }
}

if (report.unexpectedFiles.length > 0) {
  console.error("- Unexpected mirrored files:");
  for (const filePath of report.unexpectedFiles) {
    console.error(`  - ${filePath}`);
  }
}

if (report.driftedFiles.length > 0) {
  console.error("- Drifted mirrored files:");
  for (const driftedFile of report.driftedFiles) {
    const suffix = driftedFile.firstDiffLine > 0 ? ` (first diff at line ${driftedFile.firstDiffLine})` : "";
    console.error(`  - ${driftedFile.filePath}${suffix}`);
  }
}

process.exitCode = 1;
