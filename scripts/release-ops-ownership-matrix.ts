import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  buildReleaseScriptInventoryEntries,
  type ReleaseScriptInventoryEntry,
} from "./release-script-inventory.ts";

type OwnershipScope =
  | "candidate-level"
  | "same-revision"
  | "same-candidate"
  | "runtime"
  | "wechat-release"
  | "review-aid";

type DecisionRole = "authoritative gate" | "required evidence" | "diagnostic";
type ReviewTreatment = "merge/release blocker" | "release blocker" | "review aid";

type OwnershipMetadata = {
  owner: string;
  scope: OwnershipScope;
  decisionRole: DecisionRole;
  blockingSemantics: string;
  reviewTreatment: ReviewTreatment;
};

export type ReleaseOpsOwnershipEntry = ReleaseScriptInventoryEntry & OwnershipMetadata;

export const OWNERSHIP_OUTPUT_PATH = path.resolve("docs", "release-ops-ownership-matrix.md");

const SCOPE_TITLES: Record<OwnershipScope, string> = {
  "candidate-level": "Candidate-Level Evidence",
  "same-revision": "Same-Revision Evidence",
  "same-candidate": "Same-Candidate Consistency",
  runtime: "Runtime And Observability",
  "wechat-release": "WeChat Release Evidence",
  "review-aid": "Review Aids And Diagnostics",
};

const SCOPE_DESCRIPTIONS: Record<OwnershipScope, string> = {
  "candidate-level":
    "These commands own the proof for one release candidate or its directly blocking sub-gates.",
  "same-revision":
    "These commands pin one coherent revision packet so reviewers are not comparing mixed evidence sets.",
  "same-candidate":
    "These commands audit whether independently produced artifacts still describe the same candidate/revision pair.",
  runtime:
    "These commands own live-runtime, reconnect, and operational health evidence that can block promotion.",
  "wechat-release":
    "These commands own the WeChat export, package, smoke, and candidate-summary proof required for the shipped surface.",
  "review-aid":
    "These commands help reviewers triage or summarize release posture, but they are not the canonical release decision by themselves.",
};

function classifyOwnership(entry: ReleaseScriptInventoryEntry): OwnershipMetadata {
  const { script } = entry;

  switch (script) {
    case "release:gate:summary":
      return {
        owner: "release ops",
        scope: "candidate-level",
        decisionRole: "authoritative gate",
        blockingSemantics:
          "Top-level release gate summary. Treat failures as release blockers and use this as the canonical answer when reviewers ask whether the candidate can advance.",
        reviewTreatment: "merge/release blocker",
      };
    case "release:go-no-go-packet":
      return {
        owner: "release ops",
        scope: "candidate-level",
        decisionRole: "authoritative gate",
        blockingSemantics:
          "Final candidate decision packet. Missing or failed packet inputs block candidate promotion even if individual supporting artifacts exist elsewhere.",
        reviewTreatment: "release blocker",
      };
    case "release:phase1:exit-audit":
      return {
        owner: "release ops",
        scope: "candidate-level",
        decisionRole: "authoritative gate",
        blockingSemantics:
          "Reviewer-facing Phase 1 exit call. Treat failed or stale criteria as blocking for Phase 1 candidate promotion and exit review.",
        reviewTreatment: "release blocker",
      };
    case "release:phase1:exit-dossier-freshness-gate":
      return {
        owner: "release ops",
        scope: "same-revision",
        decisionRole: "authoritative gate",
        blockingSemantics:
          "Cross-checks the Phase 1 dossier, exit audit, snapshot, release gate summary, and owner ledger as one same-revision packet. Any drift, stale evidence, or missing link is a release blocker.",
        reviewTreatment: "release blocker",
      };
    case "release:phase1:evidence-drift-gate":
      return {
        owner: "release ops",
        scope: "same-revision",
        decisionRole: "authoritative gate",
        blockingSemantics:
          "Cross-checks the same-revision bundle contract against the RC bundle, snapshot, owner ledger, and optional runtime observability packet. Any candidate or revision drift blocks Phase 1 release review.",
        reviewTreatment: "release blocker",
      };
    case "release:readiness:snapshot":
      return {
        owner: "release ops",
        scope: "same-revision",
        decisionRole: "authoritative gate",
        blockingSemantics:
          "Baseline same-revision release record. Required automated/manual checks must pass or be explicitly pending here before downstream gate aggregation is trustworthy.",
        reviewTreatment: "merge/release blocker",
      };
    case "release:phase1:same-revision-evidence-bundle":
      return {
        owner: "candidate owner",
        scope: "same-revision",
        decisionRole: "required evidence",
        blockingSemantics:
          "Assembles one revision-scoped packet for Phase 1 review. Treat drift or missing staged artifacts as a release blocker for same-revision review flows.",
        reviewTreatment: "release blocker",
      };
    case "release:evidence:index":
      return {
        owner: "release ops",
        scope: "same-revision",
        decisionRole: "required evidence",
        blockingSemantics:
          "Indexes the current revision artifact families. Use it to prove the packet is complete before deeper review; missing required families should stop release review.",
        reviewTreatment: "release blocker",
      };
    case "release:evidence:lifecycle":
      return {
        owner: "release ops",
        scope: "review-aid",
        decisionRole: "required evidence",
        blockingSemantics:
          "Defines which live evidence stays reviewer-visible, which stale artifact sets move to the archive root, and which expired archive runs can be deleted. Use the dry-run report before cleanup and treat unexpected archive candidates as a release-review blocker until the policy is understood.",
        reviewTreatment: "review aid",
      };
    case "release:candidate:evidence-audit":
    case "release:candidate:evidence:freshness-guard":
    case "release:same-candidate:evidence-audit":
      return {
        owner: "release ops",
        scope: "same-candidate",
        decisionRole: "authoritative gate",
        blockingSemantics:
          "Canonical same-candidate consistency audit. Any freshness, revision, or candidate mismatch is a release blocker until the artifact set is refreshed.",
        reviewTreatment: "release blocker",
      };
    case "release:candidate-triage:digest":
      return {
        owner: "release ops",
        scope: "same-candidate",
        decisionRole: "diagnostic",
        blockingSemantics:
          "Triage rollup for candidate discussion. Useful for reviewer handoff, but it does not replace the same-candidate audit or top-level gate summary.",
        reviewTreatment: "review aid",
      };
    case "release:runtime-observability:gate":
      return {
        owner: "runtime owner",
        scope: "runtime",
        decisionRole: "authoritative gate",
        blockingSemantics:
          "Canonical runtime observability gate. A failed or stale gate blocks promotion for runtime-facing candidates and WeChat release review.",
        reviewTreatment: "release blocker",
      };
    case "release:runtime-observability:evidence":
      return {
        owner: "runtime owner",
        scope: "runtime",
        decisionRole: "required evidence",
        blockingSemantics:
          "Raw runtime capture that feeds the runtime observability gate. Required whenever live health, auth-readiness, or metrics evidence is part of the release call.",
        reviewTreatment: "release blocker",
      };
    case "release:runtime-observability:bundle":
      return {
        owner: "runtime owner",
        scope: "runtime",
        decisionRole: "required evidence",
        blockingSemantics:
          "Candidate and environment-scoped runtime review packet. Use it as the reviewer-facing wrapper around core runtime evidence and gate verdicts, including optional room lifecycle proof when requested.",
        reviewTreatment: "release blocker",
      };
    case "release:runtime:slo-summary":
      return {
        owner: "runtime owner",
        scope: "runtime",
        decisionRole: "diagnostic",
        blockingSemantics:
          "SLO-oriented summary for operational review. Use it to explain posture and regressions, but not as the authoritative release decision on its own.",
        reviewTreatment: "review aid",
      };
    case "release:reconnect-soak":
      return {
        owner: "runtime owner",
        scope: "runtime",
        decisionRole: "required evidence",
        blockingSemantics:
          "Required blocking evidence for reconnect and room-recovery release changes. Fail closed on missing cleanup, failed reconnect cycles, or stale candidate evidence.",
        reviewTreatment: "release blocker",
      };
    case "smoke:client:boot-room":
      return {
        owner: "client owner",
        scope: "review-aid",
        decisionRole: "diagnostic",
        blockingSemantics:
          "Lightweight packaged-client smoke. Useful to confirm the boot-room path still works, but it does not replace the canonical release-candidate smoke or top-level gate summary.",
        reviewTreatment: "review aid",
      };
    case "validate:redis-scaling":
      return {
        owner: "runtime owner",
        scope: "runtime",
        decisionRole: "required evidence",
        blockingSemantics:
          "Blocking validation for Redis-backed runtime scaling changes. Treat failures as merge blockers for scaling work and release blockers when the candidate depends on that path.",
        reviewTreatment: "merge/release blocker",
      };
    case "validate:wechat-rc":
    case "release:wechat:commercial-verification":
      return {
        owner: "wechat release owner",
        scope: "wechat-release",
        decisionRole: "authoritative gate",
        blockingSemantics:
          script === "validate:wechat-rc"
            ? "Canonical WeChat candidate validation and summary. Missing, blocked, or failed output is a release blocker for the shipped WeChat surface."
            : "Canonical WeChat commercial-closure packet. Missing, blocked, or stale output is a release blocker before external rollout or submission.",
        reviewTreatment: "release blocker",
      };
    case "smoke:wechat-release":
    case "release:wechat:install-launch-evidence":
      return {
        owner: "wechat release owner",
        scope: "wechat-release",
        decisionRole: "required evidence",
        blockingSemantics:
          "Device or quasi-device WeChat smoke evidence. Required supporting proof for WeChat release readiness even when the top-level gate is produced elsewhere.",
        reviewTreatment: "release blocker",
      };
    case "release:wechat:rehearsal":
      return {
        owner: "wechat release owner",
        scope: "wechat-release",
        decisionRole: "required evidence",
        blockingSemantics:
          "WeChat rehearsal packet that proves the prepare/package/verify flow can run coherently. Treat failed rehearsal output as a release blocker for RC packaging review.",
        reviewTreatment: "release blocker",
      };
    case "validate:wechat-build":
      return {
        owner: "wechat release owner",
        scope: "wechat-release",
        decisionRole: "required evidence",
        blockingSemantics:
          "Blocking export/build validator for the WeChat runtime surface. Failures block merge for export changes and block release packaging review.",
        reviewTreatment: "merge/release blocker",
      };
    case "release:cocos-rc:bundle":
    case "release:cocos-rc:snapshot":
      return {
        owner: "primary-client owner",
        scope: "wechat-release",
        decisionRole: "required evidence",
        blockingSemantics:
          "Primary-client RC evidence for the Cocos/WeChat release surface. Required whenever reviewers need the shipped-client packet, checklist, and blockers log.",
        reviewTreatment: "release blocker",
      };
    case "release:cocos:primary-journey-evidence":
    case "smoke:cocos:canonical-journey":
      return {
        owner: "primary-client owner",
        scope: "candidate-level",
        decisionRole: "required evidence",
        blockingSemantics:
          "Canonical primary-client journey proof for player-facing release readiness. Missing or failed evidence blocks release-facing changes on the shipped client path.",
        reviewTreatment: "merge/release blocker",
      };
    case "release:cocos:primary-diagnostics":
      return {
        owner: "primary-client owner",
        scope: "candidate-level",
        decisionRole: "required evidence",
        blockingSemantics:
          "Checkpoint diagnostics that support the primary-client release call. Treat missing checkpoints as a release blocker when reviewers need shipped-client evidence.",
        reviewTreatment: "release blocker",
      };
    case "smoke:client:release-candidate":
      return {
        owner: "candidate owner",
        scope: "candidate-level",
        decisionRole: "required evidence",
        blockingSemantics:
          "Packaged H5 smoke proof for the release candidate. A failed or missing report blocks top-level gate aggregation for candidate promotion.",
        reviewTreatment: "merge/release blocker",
      };
    case "release:phase1:candidate-dossier":
    case "release:phase1:candidate-rehearsal":
      return {
        owner: "candidate owner",
        scope: "candidate-level",
        decisionRole: "required evidence",
        blockingSemantics:
          "Candidate-level packet that assembles the release story for reviewers. Treat stale or failed packet assembly as blocking candidate review.",
        reviewTreatment: "release blocker",
      };
    case "release:readiness:dashboard":
    case "release:health:summary":
    case "release:health:trend-baseline":
    case "release:health:trend-compare":
    case "release:pr-summary":
      return {
        owner: "release ops",
        scope: "review-aid",
        decisionRole: "diagnostic",
        blockingSemantics:
          "Reviewer-facing summary or trend aid. Use it to explain release posture and next steps, but do not treat it as the source of truth over the owning gates.",
        reviewTreatment: "review aid",
      };
  }

  if (
    script === "validate:assets" ||
    script === "validate:content-smoke" ||
    script === "validate:map-object-visuals" ||
    script.startsWith("validate:content-pack")
  ) {
    return {
      owner: "candidate owner",
      scope: "candidate-level",
      decisionRole: "required evidence",
      blockingSemantics:
        "Blocking validation for shipped content/assets. Failures block merge for release-facing content changes and block candidate promotion when the surface is in scope.",
      reviewTreatment: "merge/release blocker",
    };
  }

  if (
    script === "validate:analytics-schema" ||
    script === "validate:e2e:fixtures" ||
    script === "validate:quickstart" ||
    script === "validate:battle"
  ) {
    return {
      owner: "candidate owner",
      scope: "candidate-level",
      decisionRole: "required evidence",
      blockingSemantics:
        "Blocking validation for the touched surface. Treat failures as merge blockers; include them in release review when the candidate depends on the edited contract or workflow.",
      reviewTreatment: "merge/release blocker",
    };
  }

  return {
    owner: "release ops",
    scope: entry.family === "release" ? "candidate-level" : "review-aid",
    decisionRole: entry.family === "release" ? "required evidence" : "diagnostic",
    blockingSemantics:
      entry.family === "release"
        ? "Release-facing evidence producer. Treat missing or stale output as blocking when this script's surface is part of the candidate review."
        : "Diagnostic helper for reviewers. Useful context, but not the canonical release gate by itself.",
    reviewTreatment: entry.family === "release" ? "release blocker" : "review aid",
  };
}

export function buildReleaseOpsOwnershipEntries(): ReleaseOpsOwnershipEntry[] {
  return buildReleaseScriptInventoryEntries().map((entry) => ({
    ...entry,
    ...classifyOwnership(entry),
  }));
}

export function renderReleaseOpsOwnershipMarkdown(entries: ReleaseOpsOwnershipEntry[]): string {
  const lines: string[] = [
    "# Release-Ops Ownership Matrix",
    "",
    "Generated from the maintained release script inventory. Do not edit this file by hand; update `scripts/release-ops-ownership-matrix.ts` and regenerate it.",
    "",
    `Covered scripts: ${entries.length}`,
    "",
    "## How To Use This Matrix",
    "",
    "- Open this page when reviewers ask which command or artifact is authoritative for a release/readiness question.",
    "- For live runtime alert response, pair this ownership map with [`docs/alerting-runbook.md`](./alerting-runbook.md) so the responder can move from the owning role to the per-alert triage steps quickly.",
    "- `Decision role` distinguishes the canonical gate from supporting evidence and reviewer-facing diagnostics.",
    "- `Review treatment` makes the blocker boundary explicit: use `merge/release blocker` for changes that can stop both PR approval and candidate promotion, `release blocker` for candidate-only proof, and `review aid` for summaries that should not override the owning gate.",
    "",
    "## Summary",
    "",
    "| Command | Responsibility | Owner | Decision role | Review treatment |",
    "| --- | --- | --- | --- | --- |",
    ...entries.map(
      (entry) =>
        `| \`${entry.script}\` | ${entry.scope} | ${entry.owner} | ${entry.decisionRole} | ${entry.reviewTreatment} |`,
    ),
    "",
  ];

  for (const scope of Object.keys(SCOPE_TITLES) as OwnershipScope[]) {
    lines.push(`## ${SCOPE_TITLES[scope]}`);
    lines.push("");
    lines.push(SCOPE_DESCRIPTIONS[scope]);
    lines.push("");
    lines.push("| Command | Owner | Decision role | Canonical artifacts | Blocking semantics |");
    lines.push("| --- | --- | --- | --- | --- |");

    for (const entry of entries.filter((candidate) => candidate.scope === scope)) {
      const artifactSummary = entry.producedArtifacts[0] ?? "No tracked artifact; exit-code signal only.";
      lines.push(
        `| \`${entry.script}\` | ${entry.owner} | ${entry.decisionRole} | ${artifactSummary.replace(/\|/g, "\\|")} | ${entry.blockingSemantics.replace(/\|/g, "\\|")} |`,
      );
    }

    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function parseArgs(argv: string[]): { check: boolean } {
  return {
    check: argv.includes("--check"),
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const entries = buildReleaseOpsOwnershipEntries();
  const nextMarkdown = renderReleaseOpsOwnershipMarkdown(entries);

  if (args.check) {
    const currentMarkdown = fs.existsSync(OWNERSHIP_OUTPUT_PATH) ? fs.readFileSync(OWNERSHIP_OUTPUT_PATH, "utf8") : "";

    if (currentMarkdown !== nextMarkdown) {
      throw new Error(
        `release-ops ownership matrix is stale. Regenerate ${path.relative(process.cwd(), OWNERSHIP_OUTPUT_PATH).replace(/\\/g, "/")} with \`npm run docs:release-ops-ownership-matrix\`.`,
      );
    }

    console.log(
      `Release-ops ownership matrix is up to date: ${path.relative(process.cwd(), OWNERSHIP_OUTPUT_PATH).replace(/\\/g, "/")}`,
    );
    return;
  }

  fs.writeFileSync(OWNERSHIP_OUTPUT_PATH, nextMarkdown, "utf8");
  console.log(`Wrote release-ops ownership matrix: ${path.relative(process.cwd(), OWNERSHIP_OUTPUT_PATH).replace(/\\/g, "/")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
