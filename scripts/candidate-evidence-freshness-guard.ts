import { pathToFileURL } from "node:url";

import { runSameCandidateEvidenceAuditCli } from "./same-candidate-evidence-audit.ts";

function main(): void {
  runSameCandidateEvidenceAuditCli(process.argv, {
    outputBaseName: "candidate-evidence-freshness-guard",
    logLabel: "candidate evidence freshness guard"
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
