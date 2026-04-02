import assert from "node:assert/strict";
import test from "node:test";

import { renderReviewerFacingMarkdownEntry } from "../release-reporting-contract.ts";

test("renderReviewerFacingMarkdownEntry keeps reviewer-facing markdown lines stable", () => {
  assert.deepEqual(
    renderReviewerFacingMarkdownEntry(
      "Candidate readiness trend",
      "Candidate readiness regressed from ready at prev9876 to blocked at cur1234.",
      {
        status: "warn",
        nextStep:
          "Open `artifacts/release-readiness/release-readiness-dashboard.json` and `baseline/release-readiness-dashboard.json` to compare the candidate blockers or pending checks before advancing the next revision.",
        artifacts: [
          { path: "/tmp/current/release-readiness-dashboard.json" },
          { path: "/tmp/baseline/release-readiness-dashboard.json" }
        ],
        toDisplayPath: (filePath) => filePath.replace(/^\/tmp\//, "")
      }
    ),
    [
      "- **Candidate readiness trend**: `WARN` Candidate readiness regressed from ready at prev9876 to blocked at cur1234.",
      "  Next step: Open `artifacts/release-readiness/release-readiness-dashboard.json` and `baseline/release-readiness-dashboard.json` to compare the candidate blockers or pending checks before advancing the next revision.",
      "  Artifacts: `current/release-readiness-dashboard.json`, `baseline/release-readiness-dashboard.json`"
    ]
  );
});
