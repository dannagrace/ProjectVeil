import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type PackageScripts = Record<string, string>;

type InventoryMetadata = {
  purpose: string;
  requiredInputs: string[];
  producedArtifacts: string[];
};

export type ReleaseScriptInventoryEntry = InventoryMetadata & {
  command: string;
  family: "release" | "validate" | "smoke";
  script: string;
};

const INVENTORY_OUTPUT_PATH = path.resolve("docs", "release-script-inventory.md");
const RELEVANT_SCRIPT_PATTERN = /^(release|validate|smoke):/;

const INVENTORY_METADATA: Record<string, InventoryMetadata> = {
  "release:candidate-triage:digest": {
    purpose: "Build a candidate-scoped digest that rolls multiple revision artifacts into one release triage packet.",
    requiredInputs: [
      "Pass `--candidate` and `--revision`, plus one or more artifact paths such as readiness, gate, health, or WeChat evidence.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/candidate-revision-triage-digest-<candidate>-<revision>.json`",
      "`artifacts/release-readiness/candidate-revision-triage-digest-<candidate>-<revision>.md`",
    ],
  },
  "release:cocos-rc:bundle": {
    purpose: "Assemble the Cocos RC evidence packet, checklist, blockers log, sign-off summary, and manifest for one candidate revision.",
    requiredInputs: [
      "Pass `--candidate`; optionally supply build-surface, snapshot inputs, and WeChat smoke/report paths when bundling non-default evidence.",
    ],
    producedArtifacts: [
      "Bundle files under `artifacts/release-readiness/`, including `cocos-rc-evidence-bundle-<candidate>-<short-sha>.json` and companion Markdown/checklist/blocker artifacts.",
    ],
  },
  "release:cocos-rc:snapshot": {
    purpose: "Create or validate the Cocos release-candidate snapshot template used by downstream bundle tooling.",
    requiredInputs: [
      "Optional explicit evidence paths such as primary-journey evidence or WeChat smoke report; use `--check` to validate an existing snapshot.",
    ],
    producedArtifacts: [
      "`artifacts/release-evidence/cocos-rc-snapshot-<timestamp>.json` by default, or validation of an existing snapshot when `--check` is used.",
    ],
  },
  "release:cocos:primary-diagnostics": {
    purpose: "Capture primary-client diagnostic milestone snapshots for the required progression, inventory, combat, and reconnect categories.",
    requiredInputs: [
      "Current repo revision; optionally `--output` or `--markdown-output` to pin filenames.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/cocos-primary-diagnostic-snapshots-<short-sha>-<timestamp>.json`",
      "`artifacts/release-readiness/cocos-primary-diagnostic-snapshots-<short-sha>-<timestamp>.md`",
    ],
  },
  "release:cocos:primary-journey-evidence": {
    purpose: "Generate the canonical Cocos primary-client journey evidence packet used by RC reviews and same-candidate checks.",
    requiredInputs: [
      "Pass `--candidate`; optionally override output paths or supporting evidence locations.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/cocos-primary-journey-evidence-<candidate>-<short-sha>.json`",
      "`artifacts/release-readiness/cocos-primary-journey-evidence-<candidate>-<short-sha>.md`",
    ],
  },
  "release:gate:summary": {
    purpose: "Aggregate readiness, H5, reconnect, WeChat, and config-change evidence into one top-level release gate decision.",
    requiredInputs: [
      "Release evidence artifacts under `artifacts/release-readiness/` and `artifacts/wechat-release/`, or explicit CLI paths such as `--snapshot` and `--wechat-artifacts-dir`.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/release-gate-summary-<short-sha>.json`",
      "`artifacts/release-readiness/release-gate-summary-<short-sha>.md`",
    ],
  },
  "release:go-no-go-packet": {
    purpose: "Build the final go/no-go decision packet for a candidate by combining the dossier, gate summary, and WeChat summary.",
    requiredInputs: [
      "Phase 1 candidate dossier plus matching release-gate and WeChat candidate-summary artifacts, either auto-discovered or passed explicitly.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/go-no-go-decision-packet-<candidate>-<short-sha>.json`",
      "`artifacts/release-readiness/go-no-go-decision-packet-<candidate>-<short-sha>.md`",
    ],
  },
  "release:health:summary": {
    purpose: "Roll readiness, gate, dashboard, CI trend, coverage, and sync-governance signals into one release-health report.",
    requiredInputs: [
      "Current candidate artifacts in `artifacts/release-readiness/` plus `.coverage/summary.json`, or explicit CLI overrides.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/release-health-summary-<short-sha>.json`",
      "`artifacts/release-readiness/release-health-summary-<short-sha>.md`",
    ],
  },
  "release:health:trend-baseline": {
    purpose: "Create the baseline history used to compare current release-health signals against earlier acceptable candidates.",
    requiredInputs: [
      "Historical release-health artifacts under `artifacts/release-readiness/`, with optional CLI filters for window size or candidate selection.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/release-health-trend-baseline.json`",
      "`artifacts/release-readiness/release-health-trend-baseline.md`",
    ],
  },
  "release:health:trend-compare": {
    purpose: "Compare the current candidate against the stored release-health baseline to highlight regressions or missing evidence.",
    requiredInputs: [
      "A current candidate plus baseline history under `artifacts/release-readiness/`, or explicit compare-mode CLI inputs.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/release-health-trend-compare.json`",
      "`artifacts/release-readiness/release-health-trend-compare.md`",
    ],
  },
  "release:phase1:candidate-dossier": {
    purpose: "Assemble the Phase 1 candidate dossier bundle, including runtime-observability, release-gate, and release-health companion reports.",
    requiredInputs: [
      "Pass `--candidate` and `--candidate-revision`; optionally provide supporting artifact paths such as snapshot, reconnect soak, WeChat artifacts, and runtime gate inputs.",
    ],
    producedArtifacts: [
      "Bundle directory `artifacts/release-readiness/phase1-candidate-dossier-<candidate>-<short-sha>/` with `phase1-candidate-dossier.json/.md`, `runtime-observability-dossier.json/.md`, `release-gate-summary.json/.md`, and `release-health-summary.json/.md`.",
    ],
  },
  "release:phase1:candidate-rehearsal": {
    purpose: "Run the full candidate rehearsal flow and stage outputs into one release-readiness bundle directory.",
    requiredInputs: [
      "Pass `--candidate` and optionally `--server-url`, target-surface settings, or prebuilt artifact paths to avoid rerunning every stage.",
    ],
    producedArtifacts: [
      "Bundle directory under `artifacts/release-readiness/phase1-candidate-rehearsal/` with staged JSON/Markdown outputs and a top-level `SUMMARY.md`.",
    ],
  },
  "release:phase1:same-revision-evidence-bundle": {
    purpose: "Generate the same-revision Phase 1 evidence bundle for a single candidate revision, including snapshot, dashboard, gate, and ledger scaffolding.",
    requiredInputs: [
      "Pass `--candidate` and `--candidate-revision`; optional prebuilt evidence paths can replace generated defaults.",
    ],
    producedArtifacts: [
      "Output directory under `artifacts/release-readiness/phase1-same-revision-evidence-bundle-<candidate>-<short-sha>/` containing `phase1-same-revision-evidence-bundle-manifest.json`, `phase1-same-revision-evidence-bundle.md`, and staged evidence artifacts.",
    ],
  },
  "release:pr-summary": {
    purpose: "Render the Markdown snippet used for release-oriented PR comments from gate and health artifacts.",
    requiredInputs: [
      "Release gate summary plus release health summary JSON inputs, passed explicitly or discovered from the release-readiness artifact directory.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/release-pr-comment.md`",
    ],
  },
  "release:readiness:dashboard": {
    purpose: "Render the reviewer-facing release-readiness dashboard that summarizes snapshot, WeChat, reconnect, persistence, and Cocos evidence.",
    requiredInputs: [
      "Release-readiness snapshot and supporting artifacts under `artifacts/release-readiness/` and `artifacts/wechat-release/`, or explicit CLI paths.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/release-readiness-dashboard.json`",
      "`artifacts/release-readiness/release-readiness-dashboard.md`",
    ],
  },
  "release:readiness:snapshot": {
    purpose: "Capture the branch-level release-readiness snapshot that records required checks and manual evidence status.",
    requiredInputs: [
      "Current revision plus any prerequisite automated/manual evidence; optional `--output` for a stable filename.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/release-readiness-<timestamp>.json`",
    ],
  },
  "release:reconnect-soak": {
    purpose: "Wrap the reconnect soak runtime test in a release-gate friendly JSON/Markdown report.",
    requiredInputs: [
      "A reachable runtime under test plus optional soak parameters and output-path overrides.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/colyseus-reconnect-soak-summary-<candidate-or-short-sha>.json`",
      "`artifacts/release-readiness/colyseus-reconnect-soak-summary-<candidate-or-short-sha>.md`",
    ],
  },
  "release:runtime-observability:gate": {
    purpose: "Evaluate candidate runtime observability evidence and produce a pass/fail gate packet.",
    requiredInputs: [
      "Candidate or environment details plus any runtime evidence paths required by the selected target surface.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/runtime-observability-gate-<candidate-or-short-sha>.json`",
      "`artifacts/release-readiness/runtime-observability-gate-<candidate-or-short-sha>.md`",
    ],
  },
  "release:runtime:slo-summary": {
    purpose: "Summarize runtime SLO observations into machine-readable, Markdown, and plain-text release artifacts.",
    requiredInputs: [
      "Current revision or candidate context plus any runtime measurements supplied through CLI flags.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/runtime-slo-summary-<short-sha>.json`",
      "`artifacts/release-readiness/runtime-slo-summary-<short-sha>.md`",
      "`artifacts/release-readiness/runtime-slo-summary-<short-sha>.txt`",
    ],
  },
  "release:same-candidate:evidence-audit": {
    purpose: "Audit whether all candidate evidence artifacts refer to the same revision and remain fresh enough for release review.",
    requiredInputs: [
      "Release-readiness, release-gate, Cocos bundle, manual-ledger, and WeChat summary artifacts, either discovered from defaults or passed explicitly.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/same-candidate-evidence-audit-<candidate>-<short-sha>.json`",
      "`artifacts/release-readiness/same-candidate-evidence-audit-<candidate>-<short-sha>.md`",
    ],
  },
  "release:wechat:rehearsal": {
    purpose: "Run the WeChat release rehearsal flow that chains prepare, package, verify, and validate steps into one summary.",
    requiredInputs: [
      "A WeChat build directory plus an artifacts directory; optional config/summary path overrides.",
    ],
    producedArtifacts: [
      "Summary files under the selected artifacts dir, typically `artifacts/wechat-release/wechat-release-rehearsal-<candidate>.json` and `.md`, alongside the package, validation, smoke, and upload artifacts it references.",
    ],
  },
  "smoke:client:release-candidate": {
    purpose: "Run the packaged H5 release-candidate smoke suite against `apps/client/dist` instead of the dev shell.",
    requiredInputs: [
      "A built client artifact under `apps/client/dist` or `--client-artifact-dir`, plus Playwright dependencies.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/client-release-candidate-smoke-<short-sha>-<timestamp>.json`",
      "Companion raw Playwright JSON report next to the structured artifact.",
    ],
  },
  "smoke:cocos:canonical-journey": {
    purpose: "Alias the canonical Cocos primary-client journey evidence workflow for smoke-oriented invocation.",
    requiredInputs: [
      "Same inputs as `release:cocos:primary-journey-evidence`, typically a candidate name and optional output overrides.",
    ],
    producedArtifacts: [
      "`artifacts/release-readiness/cocos-primary-journey-evidence-<candidate>-<short-sha>.json`",
      "`artifacts/release-readiness/cocos-primary-journey-evidence-<candidate>-<short-sha>.md`",
    ],
  },
  "smoke:wechat-release": {
    purpose: "Create or validate the WeChat smoke report template used to record physical-device or real-device-debugging release evidence.",
    requiredInputs: [
      "Pass `--artifacts-dir <dir>` or `--metadata <package.json>`; use `--check` to validate an existing smoke report instead of creating one.",
    ],
    producedArtifacts: [
      "`codex.wechat.smoke-report.json` in the selected artifacts directory, or validation of an existing smoke report when `--check` is used.",
    ],
  },
  "validate:analytics-schema": {
    purpose: "Validate analytics event/schema definitions before release or telemetry changes ship.",
    requiredInputs: [
      "Current analytics schema files from the repo.",
    ],
    producedArtifacts: [
      "No tracked artifact; exits non-zero on schema drift and reports findings on stdout/stderr.",
    ],
  },
  "validate:assets": {
    purpose: "Validate shipped art/content asset manifests, with an optional stricter Cocos release-ready mode.",
    requiredInputs: [
      "Current asset manifests in the repo; optional `--require-cocos-release-ready` when used as a release gate.",
    ],
    producedArtifacts: [
      "No tracked artifact; exits non-zero when asset metadata, coverage, or release-ready checks fail.",
    ],
  },
  "validate:battle": {
    purpose: "Run battle-balance validation across authored scenarios or custom skill/balance configs.",
    requiredInputs: [
      "Optional `--scenario`, `--count`, `--skill-config`, and `--balance-config` flags; otherwise it uses repo defaults.",
    ],
    producedArtifacts: [
      "No tracked artifact; prints the validation summary to stdout.",
    ],
  },
  "validate:content-pack": {
    purpose: "Validate one content-pack configuration set, optionally writing a machine-readable report.",
    requiredInputs: [
      "Config root dir plus optional `--map-pack` selections and `--report-path`.",
    ],
    producedArtifacts: [
      "Optional JSON report at the requested `--report-path`; otherwise this is an exit-code-only validation step.",
    ],
  },
  "validate:content-pack:all": {
    purpose: "Validate all shipped content-pack variants as a release-readiness sweep.",
    requiredInputs: [
      "Repo config pack definitions; optional `--report-path` if a consolidated JSON report is desired.",
    ],
    producedArtifacts: [
      "Optional JSON report at the requested `--report-path`; otherwise this is an exit-code-only validation step.",
    ],
  },
  "validate:e2e:fixtures": {
    purpose: "Check that the E2E fixture/config set remains internally consistent before Playwright-based gates run.",
    requiredInputs: [
      "Repo E2E fixture definitions under `configs/` and test config files.",
    ],
    producedArtifacts: [
      "No tracked artifact; exits non-zero when fixture metadata drifts.",
    ],
  },
  "validate:quickstart": {
    purpose: "Exercise the local contributor quickstart validation path that README users are expected to follow.",
    requiredInputs: [
      "A bootable local dev environment with repo dependencies installed.",
    ],
    producedArtifacts: [
      "No tracked artifact; this is a workflow gate driven by exit status and console output.",
    ],
  },
  "validate:redis-scaling": {
    purpose: "Validate Redis-backed scaling behavior for the multiplayer/runtime release path.",
    requiredInputs: [
      "A reachable Redis instance via `REDIS_URL` and any optional CLI/runtime flags accepted by the script.",
    ],
    producedArtifacts: [
      "No tracked artifact; exits non-zero if the scaling validation fails.",
    ],
  },
  "validate:wechat-build": {
    purpose: "Validate a built WeChat minigame export before packaging or RC review.",
    requiredInputs: [
      "Pass `--output-dir <wechat-build-dir>` and optional `--expect-exported-runtime` when validating a real export.",
    ],
    producedArtifacts: [
      "No tracked artifact; exits non-zero when the build directory or exported runtime shape is invalid.",
    ],
  },
  "validate:wechat-rc": {
    purpose: "Validate a packaged WeChat release candidate and summarize the artifact, smoke, runtime, and upload evidence.",
    requiredInputs: [
      "Pass `--artifacts-dir <release-artifacts-dir>` or explicit archive/metadata paths; optional expected revision/version/manual-check flags tighten the gate.",
    ],
    producedArtifacts: [
      "`codex.wechat.rc-validation-report.json` in the selected artifacts dir",
      "`codex.wechat.release-candidate-summary.json` in the selected artifacts dir",
      "`codex.wechat.release-candidate-summary.md` in the selected artifacts dir",
    ],
  },
};

type PackageJsonShape = {
  scripts?: PackageScripts;
};

function readPackageScripts(): PackageScripts {
  const packageJsonPath = path.resolve("package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJsonShape;

  return packageJson.scripts ?? {};
}

export function listRelevantPackageScripts(scripts = readPackageScripts()): Array<[string, string]> {
  return Object.entries(scripts)
    .filter(([script]) => RELEVANT_SCRIPT_PATTERN.test(script))
    .sort(([left], [right]) => left.localeCompare(right));
}

export function buildReleaseScriptInventoryEntries(): ReleaseScriptInventoryEntry[] {
  const scripts = readPackageScripts();
  const relevantScripts = listRelevantPackageScripts(scripts);
  const missingMetadata = relevantScripts
    .map(([script]) => script)
    .filter((script) => INVENTORY_METADATA[script] === undefined);
  const extraMetadata = Object.keys(INVENTORY_METADATA)
    .filter((script) => scripts[script] === undefined || !RELEVANT_SCRIPT_PATTERN.test(script))
    .sort((left, right) => left.localeCompare(right));

  if (missingMetadata.length > 0 || extraMetadata.length > 0) {
    const problems: string[] = [];

    if (missingMetadata.length > 0) {
      problems.push(`missing metadata for: ${missingMetadata.join(", ")}`);
    }
    if (extraMetadata.length > 0) {
      problems.push(`metadata without matching relevant script: ${extraMetadata.join(", ")}`);
    }

    throw new Error(`release script inventory metadata is out of sync with package.json (${problems.join("; ")})`);
  }

  return relevantScripts.map(([script, command]) => ({
    script,
    command,
    family: script.startsWith("release:") ? "release" : script.startsWith("validate:") ? "validate" : "smoke",
    ...INVENTORY_METADATA[script],
  }));
}

export function renderReleaseScriptInventoryMarkdown(entries: ReleaseScriptInventoryEntry[]): string {
  const lines: string[] = [
    "# Release Script Inventory",
    "",
    "Generated from the root `package.json` release/readiness script surface. Do not edit this file by hand; update `scripts/release-script-inventory.ts` and regenerate it.",
    "",
    `Relevant scripts: ${entries.length}`,
    "",
    "## Scope",
    "",
    "- Includes every root package script whose name starts with `release:`, `validate:`, or `smoke:`.",
    "- `Required inputs` lists the minimum operator-supplied flags, environment, or prerequisite artifacts needed to make the script meaningful.",
    "- `Produced artifacts` records default on-disk outputs when the script writes structured evidence; otherwise it calls out that the script is exit-code only.",
    "",
    "## Summary",
    "",
    "| Script | Family | Produced artifacts |",
    "| --- | --- | --- |",
    ...entries.map((entry) => {
      const artifactSummary = entry.producedArtifacts[0] ?? "None";
      return `| \`${entry.script}\` | ${entry.family} | ${artifactSummary.replace(/\|/g, "\\|")} |`;
    }),
    "",
  ];

  for (const entry of entries) {
    lines.push(`## \`${entry.script}\``);
    lines.push("");
    lines.push(`- Family: \`${entry.family}\``);
    lines.push(`- Command: \`${entry.command}\``);
    lines.push(`- Purpose: ${entry.purpose}`);
    lines.push("- Required inputs:");
    for (const requiredInput of entry.requiredInputs) {
      lines.push(`  - ${requiredInput}`);
    }
    lines.push("- Produced artifacts:");
    for (const artifact of entry.producedArtifacts) {
      lines.push(`  - ${artifact}`);
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
  const entries = buildReleaseScriptInventoryEntries();
  const nextMarkdown = renderReleaseScriptInventoryMarkdown(entries);

  if (args.check) {
    const currentMarkdown = fs.existsSync(INVENTORY_OUTPUT_PATH) ? fs.readFileSync(INVENTORY_OUTPUT_PATH, "utf8") : "";

    if (currentMarkdown !== nextMarkdown) {
      throw new Error(
        `release script inventory is stale. Regenerate ${path.relative(process.cwd(), INVENTORY_OUTPUT_PATH).replace(/\\/g, "/")} with \`npm run docs:release-script-inventory\`.`,
      );
    }

    console.log(`Release script inventory is up to date: ${path.relative(process.cwd(), INVENTORY_OUTPUT_PATH).replace(/\\/g, "/")}`);
    return;
  }

  fs.writeFileSync(INVENTORY_OUTPUT_PATH, nextMarkdown, "utf8");
  console.log(`Wrote release script inventory: ${path.relative(process.cwd(), INVENTORY_OUTPUT_PATH).replace(/\\/g, "/")}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}

export { INVENTORY_OUTPUT_PATH };
