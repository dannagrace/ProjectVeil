import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

type StepKind = "command" | "manual";

interface StepDefinition {
  id: string;
  kind: StepKind;
  command?: string;
  summary: string;
}

interface SurfaceRule {
  id: string;
  label: string;
  rationale: string;
  requiredStepIds: string[];
  optionalStepIds: string[];
  humanOverride: string;
  prefixes?: string[];
  exact?: string[];
  suffixes?: string[];
  includes?: string[];
}

interface MatchedSurface {
  id: string;
  label: string;
  rationale: string;
  humanOverride: string;
  matchedPaths: string[];
}

export interface ValidationPlanStep {
  id: string;
  kind: StepKind;
  command?: string;
  summary: string;
  sources: string[];
}

export interface ValidationPlan {
  matchedSurfaces: MatchedSurface[];
  requiredSteps: ValidationPlanStep[];
  optionalSteps: ValidationPlanStep[];
  unmatchedPaths: string[];
  humanOverrides: string[];
  detectedPaths: string[];
}

interface CliArgs {
  base?: string;
  head?: string;
  branch?: string;
  pr?: string;
  paths: string[];
  json: boolean;
  markdown: boolean;
  text: boolean;
  help: boolean;
}

interface RenderOptions {
  comparisonLabel?: string;
}

const STEP_DEFINITIONS: StepDefinition[] = [
  {
    id: "review-rendered-markdown",
    kind: "manual",
    summary: "Review rendered Markdown plus every edited path and command reference."
  },
  {
    id: "validate-quickstart",
    kind: "command",
    command: "npm run validate:quickstart",
    summary: "Re-check contributor setup or local-dev boot assumptions when docs or runtime boot guidance changed."
  },
  {
    id: "typecheck-shared",
    kind: "command",
    command: "npm run typecheck:shared",
    summary: "Typecheck shared gameplay logic and payload helpers."
  },
  {
    id: "test-shared",
    kind: "command",
    command: "npm run test:shared",
    summary: "Run shared gameplay and contract-adjacent unit coverage."
  },
  {
    id: "test-contracts",
    kind: "command",
    command: "npm run test:contracts",
    summary: "Re-check shared payload or snapshot contracts when cross-runtime message shapes changed."
  },
  {
    id: "typecheck-server",
    kind: "command",
    command: "npm run typecheck:server",
    summary: "Typecheck the server runtime surface."
  },
  {
    id: "nearest-server-test",
    kind: "manual",
    summary: "Run the nearest targeted `node:test` suite for the touched server subsystem."
  },
  {
    id: "typecheck-client-h5",
    kind: "command",
    command: "npm run typecheck:client:h5",
    summary: "Typecheck the H5 shell and browser-facing client code."
  },
  {
    id: "test-e2e-smoke",
    kind: "command",
    command: "npm run test:e2e:smoke",
    summary: "Cover the baseline H5 smoke path."
  },
  {
    id: "test-e2e-h5-connectivity",
    kind: "command",
    command: "npm run test:e2e:h5:connectivity",
    summary: "Escalate when browser-to-server connectivity assumptions changed."
  },
  {
    id: "typecheck-cocos",
    kind: "command",
    command: "npm run typecheck:cocos",
    summary: "Typecheck the Cocos primary client."
  },
  {
    id: "check-wechat-build",
    kind: "command",
    command: "npm run check:wechat-build",
    summary: "Validate the shipped WeChat build/export surface used by CI."
  },
  {
    id: "audit-cocos-primary-delivery",
    kind: "command",
    command:
      "npm run audit:cocos-primary-delivery -- --output-dir apps/cocos-client/test/fixtures/wechatgame-export --artifacts-dir artifacts/wechat-release --expect-exported-runtime",
    summary: "Audit exported runtime assumptions when delivery metadata or release-facing Cocos evidence changed."
  },
  {
    id: "typecheck-ci",
    kind: "command",
    command: "npm run typecheck:ci",
    summary: "Typecheck all major CI-covered surfaces."
  },
  {
    id: "validate-content-pack",
    kind: "command",
    command: "npm run validate:content-pack",
    summary: "Validate shipped config/content inputs."
  },
  {
    id: "validate-content-pack-all",
    kind: "command",
    command: "npm run validate:content-pack:all",
    summary: "Escalate when the change affects multiple shipped map packs."
  },
  {
    id: "validate-battle",
    kind: "command",
    command: "npm run validate:battle",
    summary: "Validate balance, skills, or unit tuning changes."
  },
  {
    id: "test-phase1-release-persistence",
    kind: "command",
    command: "npm run test:phase1-release-persistence",
    summary: "Cover release-facing persistence or migration expectations."
  },
  {
    id: "validate-wechat-rc",
    kind: "command",
    command: "npm run validate:wechat-rc",
    summary: "Validate WeChat release-candidate evidence when packaging or candidate assembly changed."
  },
  {
    id: "smoke-wechat-release",
    kind: "command",
    command: "npm run smoke:wechat-release",
    summary: "Escalate when device/runtime smoke handling or WeChat release evidence changed."
  },
  {
    id: "verify-wechat-release",
    kind: "command",
    command: "npm run verify:wechat-release",
    summary: "Re-verify packaged WeChat artifacts when packaging logic changed."
  },
  {
    id: "release-cocos-rc-bundle",
    kind: "command",
    command: "npm run release:cocos-rc:bundle",
    summary: "Rebuild Cocos release-candidate evidence when candidate bundle assembly changed."
  },
  {
    id: "release-readiness-dashboard",
    kind: "command",
    command: "npm run release:readiness:dashboard",
    summary: "Rebuild the operator-facing readiness dashboard when observability or release health rollups changed."
  },
  {
    id: "release-health-summary",
    kind: "command",
    command: "npm run release:health:summary",
    summary: "Refresh the top-level release health rollup when observability or gate semantics changed."
  },
  {
    id: "review-runtime-observability",
    kind: "manual",
    summary:
      "If the change is release-facing, re-check `/api/runtime/health`, `/api/runtime/auth-readiness`, and `/api/runtime/metrics` for the candidate environment."
  },
  {
    id: "test-coverage-ci",
    kind: "command",
    command: "npm run test:coverage:ci",
    summary: "Escalate when repo-wide tooling or dependency changes widen the blast radius."
  }
];

const STEP_DEFINITION_MAP = new Map(STEP_DEFINITIONS.map((step) => [step.id, step]));

const SURFACE_RULES: SurfaceRule[] = [
  {
    id: "docs-process",
    label: "Docs or process guidance",
    rationale: "Docs and contributor workflow edits still need path/command verification even when no runtime code changed.",
    requiredStepIds: ["review-rendered-markdown"],
    optionalStepIds: ["validate-quickstart"],
    humanOverride: "If you edited a documented command, rerun that exact command when practical even if it is only optional here.",
    prefixes: [
      "docs/",
      ".github/ISSUE_TEMPLATE/"
    ],
    exact: ["README.md", "MOE.md", "progress.md"]
  },
  {
    id: "shared-gameplay",
    label: "Shared gameplay logic",
    rationale: "Shared logic changes can affect multiple runtimes and should keep contract coverage close.",
    requiredStepIds: ["typecheck-shared", "test-shared"],
    optionalStepIds: ["test-contracts"],
    humanOverride: "Escalate to multiplayer or runtime-specific checks if both clients and server consume the changed behavior.",
    prefixes: ["packages/shared/"]
  },
  {
    id: "server-runtime",
    label: "Server runtime",
    rationale: "Server route, room, auth, and runtime changes need server type safety plus subsystem-specific coverage.",
    requiredStepIds: ["typecheck-server", "nearest-server-test"],
    optionalStepIds: ["validate-quickstart"],
    humanOverride: "Prefer the nearest touched server suite over a generic full run, then escalate if room/session behavior changed.",
    prefixes: ["apps/server/"]
  },
  {
    id: "h5-shell",
    label: "H5 shell",
    rationale: "Browser-facing shell changes should keep H5 smoke aligned with the verification matrix.",
    requiredStepIds: ["typecheck-client-h5", "test-e2e-smoke"],
    optionalStepIds: ["test-e2e-h5-connectivity"],
    humanOverride: "If the change only touches a narrow browser helper, keep the smoke run but choose the nearest extra connectivity diagnostic only when assumptions changed.",
    prefixes: ["apps/client/", "tests/e2e/"],
    suffixes: [".spec.ts"],
    includes: ["playwright."]
  },
  {
    id: "cocos-primary-client",
    label: "Cocos primary client",
    rationale: "Primary-client and WeChat export changes should keep Cocos type safety and build validation together.",
    requiredStepIds: ["typecheck-cocos", "check-wechat-build"],
    optionalStepIds: ["audit-cocos-primary-delivery"],
    humanOverride: "If the change is runtime-only and does not affect exported delivery metadata, the audit step can stay optional.",
    prefixes: ["apps/cocos-client/"]
  },
  {
    id: "cocos-release-evidence",
    label: "Cocos release evidence",
    rationale: "Canonical main-client journey evidence and RC bundle scripts should keep the release-facing artifact path executable.",
    requiredStepIds: ["release-cocos-rc-bundle"],
    optionalStepIds: ["validate-wechat-rc"],
    humanOverride:
      "If the change only affects one evidence stage, keep the bundle rebuild as the default end-to-end check and widen to WeChat RC validation only when the touched path changes imported device evidence semantics.",
    exact: [
      "scripts/cocos-primary-client-journey-evidence.ts",
      "scripts/cocos-rc-evidence-bundle.ts",
      "scripts/cocos-release-candidate-snapshot.ts",
      "docs/cocos-release-evidence-template.md"
    ]
  },
  {
    id: "release-packaging",
    label: "Release packaging or candidate evidence",
    rationale: "Packaging and reviewer-facing candidate assembly should point back to the existing WeChat and release bundle commands.",
    requiredStepIds: ["check-wechat-build"],
    optionalStepIds: ["verify-wechat-release", "validate-wechat-rc", "smoke-wechat-release", "release-cocos-rc-bundle"],
    humanOverride: "Pick the nearest changed packaging or evidence command first, then widen to smoke or bundle assembly only when the edited flow reaches those artifacts.",
    prefixes: [
      "scripts/prepare-wechat-",
      "scripts/package-wechat-",
      "scripts/upload-wechat-",
      "scripts/download-wechat-",
      "scripts/verify-wechat-",
      "scripts/validate-wechat-",
      "scripts/smoke-wechat-",
      "docs/wechat-",
      "docs/cocos-release-evidence-template.md",
      "docs/same-revision-release-evidence-runbook.md",
      "docs/release-evidence/",
      "artifacts/wechat-release/"
    ]
  },
  {
    id: "observability",
    label: "Runtime observability",
    rationale: "Observability edits should keep server validation and release-health rollups aligned with the runtime endpoints they describe.",
    requiredStepIds: ["typecheck-server", "nearest-server-test"],
    optionalStepIds: ["release-readiness-dashboard", "release-health-summary", "review-runtime-observability"],
    humanOverride: "When the change affects release-facing metrics or diagnostics, capture runtime endpoint evidence instead of assuming local typecheck proves the candidate surface.",
    prefixes: [
      "apps/server/src/observability",
      "docs/wechat-runtime-observability-signoff",
      "docs/release-evidence/wechat-runtime-observability-signoff",
      "scripts/release-health-summary.ts",
      "scripts/release-readiness-dashboard.ts"
    ]
  },
  {
    id: "content-config",
    label: "Content or config inputs",
    rationale: "Config and content changes should reuse the existing validators instead of ad hoc spot checks.",
    requiredStepIds: ["validate-content-pack"],
    optionalStepIds: ["validate-battle", "validate-content-pack-all", "test-phase1-release-persistence"],
    humanOverride: "Use the battle validator only for balance or unit tuning, and add the persistence regression when storage or release-facing data flows changed.",
    prefixes: [
      "configs/",
      "scripts/validate-content-pack.ts",
      "scripts/validate-battle-balance.ts",
      "scripts/migrate",
      "docs/content-pack-validation.md",
      "docs/core-gameplay-release-readiness.md",
      "docs/mysql-persistence.md"
    ]
  },
  {
    id: "repo-tooling",
    label: "Repo tooling",
    rationale: "Repo-wide script or dependency changes can affect multiple validation entry points even when no runtime surface is obvious.",
    requiredStepIds: ["typecheck-ci"],
    optionalStepIds: ["test-coverage-ci"],
    humanOverride: "If the tooling change only affects one surface, prefer that surface's targeted checks over broad coverage runs.",
    prefixes: ["scripts/test/"],
    exact: [
      "package.json",
      "package-lock.json",
      "scripts/minimal-validation-plan.ts",
      "tsconfig.base.json",
      "tsconfig.ops-tooling.json"
    ],
    suffixes: [".config.ts"]
  }
];

function normalizePath(filePath: string): string {
  return filePath.replaceAll(path.sep, "/").replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function matchesRule(filePath: string, rule: SurfaceRule): boolean {
  const normalizedPath = normalizePath(filePath);
  if (rule.exact?.includes(normalizedPath)) {
    return true;
  }
  if (rule.prefixes?.some((prefix) => normalizedPath.startsWith(prefix))) {
    return true;
  }
  if (rule.suffixes?.some((suffix) => normalizedPath.endsWith(suffix))) {
    return true;
  }
  if (rule.includes?.some((segment) => normalizedPath.includes(segment))) {
    return true;
  }
  return false;
}

function uniqueSorted(values: Iterable<string>): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function buildSteps(stepIds: string[], sourcesByStep: Map<string, Set<string>>): ValidationPlanStep[] {
  const orderedStepIds = STEP_DEFINITIONS.map((step) => step.id).filter((stepId) => stepIds.includes(stepId));

  return orderedStepIds.flatMap((stepId) => {
    const definition = STEP_DEFINITION_MAP.get(stepId);
    if (!definition) {
      return [];
    }

    return [
      {
        id: definition.id,
        kind: definition.kind,
        command: definition.command,
        summary: definition.summary,
        sources: uniqueSorted(sourcesByStep.get(stepId) ?? [])
      }
    ];
  });
}

export function inferValidationPlan(filePaths: string[]): ValidationPlan {
  const detectedPaths = uniqueSorted(filePaths.map(normalizePath).filter((filePath) => filePath.length > 0));
  const matchedSurfaceMap = new Map<string, MatchedSurface>();
  const unmatchedPaths: string[] = [];

  for (const filePath of detectedPaths) {
    const matches = SURFACE_RULES.filter((rule) => matchesRule(filePath, rule));

    if (matches.length === 0) {
      unmatchedPaths.push(filePath);
      continue;
    }

    for (const rule of matches) {
      const existing = matchedSurfaceMap.get(rule.id);
      if (existing) {
        existing.matchedPaths.push(filePath);
        continue;
      }

      matchedSurfaceMap.set(rule.id, {
        id: rule.id,
        label: rule.label,
        rationale: rule.rationale,
        humanOverride: rule.humanOverride,
        matchedPaths: [filePath]
      });
    }
  }

  const matchedSurfaces = SURFACE_RULES.flatMap((rule) => {
    const matchedSurface = matchedSurfaceMap.get(rule.id);
    if (!matchedSurface) {
      return [];
    }

    matchedSurface.matchedPaths = uniqueSorted(matchedSurface.matchedPaths);
    return [matchedSurface];
  });

  const requiredStepIds: string[] = [];
  const optionalStepIds: string[] = [];
  const requiredSourcesByStep = new Map<string, Set<string>>();
  const optionalSourcesByStep = new Map<string, Set<string>>();

  for (const matchedSurface of matchedSurfaces) {
    const rule = SURFACE_RULES.find((entry) => entry.id === matchedSurface.id);
    if (!rule) {
      continue;
    }

    for (const stepId of rule.requiredStepIds) {
      if (!requiredStepIds.includes(stepId)) {
        requiredStepIds.push(stepId);
      }
      if (!requiredSourcesByStep.has(stepId)) {
        requiredSourcesByStep.set(stepId, new Set<string>());
      }
      requiredSourcesByStep.get(stepId)?.add(matchedSurface.label);
    }

    for (const stepId of rule.optionalStepIds) {
      if (requiredStepIds.includes(stepId) || optionalStepIds.includes(stepId)) {
        continue;
      }
      optionalStepIds.push(stepId);
      if (!optionalSourcesByStep.has(stepId)) {
        optionalSourcesByStep.set(stepId, new Set<string>());
      }
      optionalSourcesByStep.get(stepId)?.add(matchedSurface.label);
    }
  }

  const humanOverrides = uniqueSorted(
    matchedSurfaces.map((surface) => surface.humanOverride).concat(
      matchedSurfaces.length > 1
        ? ["This change crosses multiple surfaces. Combine the required checks from each matched surface and prefer the higher-risk path when they conflict."]
        : [],
      unmatchedPaths.length > 0
        ? ["Some paths did not match a maintained surface. Use `docs/verification-matrix.md` to add the nearest higher-risk checks before merging."]
        : []
    )
  );

  return {
    matchedSurfaces,
    requiredSteps: buildSteps(requiredStepIds, requiredSourcesByStep),
    optionalSteps: buildSteps(optionalStepIds, optionalSourcesByStep),
    unmatchedPaths,
    humanOverrides,
    detectedPaths
  };
}

function readGitPathList(args: string[]): string[] {
  const output = execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });

  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function detectPathsFromGit(base?: string, head = "HEAD"): string[] {
  const includeHeadWorkspace = head === "HEAD";
  const workspacePaths = includeHeadWorkspace
    ? readGitPathList(["diff", "--name-only", "--diff-filter=ACMR"]).concat(
        readGitPathList(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])
      )
    : [];
  const diffPaths =
    typeof base === "string"
      ? workspacePaths.concat(readGitPathList(["diff", "--name-only", "--diff-filter=ACMR", `${base}...${head}`]))
      : workspacePaths.concat(readGitPathList(["diff", "--name-only", "--diff-filter=ACMR", "origin/main...HEAD"]));

  return uniqueSorted(diffPaths);
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    paths: [],
    json: false,
    markdown: false,
    text: false,
    help: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--base") {
      if (!next) {
        throw new Error("Missing value for --base.");
      }
      parsed.base = next;
      index += 1;
      continue;
    }

    if (arg === "--head") {
      if (!next) {
        throw new Error("Missing value for --head.");
      }
      parsed.head = next;
      index += 1;
      continue;
    }

    if (arg === "--path") {
      if (!next) {
        throw new Error("Missing value for --path.");
      }
      parsed.paths.push(next);
      index += 1;
      continue;
    }

    if (arg === "--branch") {
      if (!next) {
        throw new Error("Missing value for --branch.");
      }
      parsed.branch = next;
      index += 1;
      continue;
    }

    if (arg === "--pr") {
      if (!next) {
        throw new Error("Missing value for --pr.");
      }
      parsed.pr = next;
      index += 1;
      continue;
    }

    if (arg === "--json") {
      parsed.json = true;
      continue;
    }

    if (arg === "--markdown") {
      parsed.markdown = true;
      continue;
    }

    if (arg === "--text") {
      parsed.text = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }

    parsed.paths.push(arg);
  }

  return parsed;
}

function printHelp(): void {
  console.log(
    "Usage: npm run plan:validation:minimal -- [--base <ref> --head <ref> | --branch <ref> | --pr <number>] [--path <file> ...] [--markdown|--text|--json]"
  );
  console.log("");
  console.log("Examples:");
  console.log("  npm run plan:validation:minimal -- apps/cocos-client/assets/scripts/VeilRoot.ts");
  console.log("  npm run plan:validation:minimal -- --base origin/main --head HEAD");
  console.log("  npm run plan:validation:minimal -- --branch origin/main --markdown");
  console.log("  npm run plan:validation:minimal -- --pr 708");
  console.log("  npm run plan:validation:minimal -- --path apps/server/src/observability.ts --path docs/wechat-runtime-observability-signoff.md");
}

function formatStep(step: ValidationPlanStep): string {
  const sourceText = step.sources.length > 0 ? ` [from ${step.sources.join(", ")}]` : "";
  if (step.kind === "command" && step.command) {
    return `- ${step.command}${sourceText}\n  ${step.summary}`;
  }

  return `- ${step.summary}${sourceText}`;
}

function formatMarkdownList(values: string[]): string {
  return values.map((value) => `\`${value}\``).join(", ");
}

function renderMarkdownValidationPlan(plan: ValidationPlan, options?: RenderOptions): string {
  const lines: string[] = [];

  lines.push("## Recommended Minimal Validation Plan");
  lines.push("");
  if (options?.comparisonLabel) {
    lines.push(`Comparison: \`${options.comparisonLabel}\``);
  }
  lines.push(`Detected paths: ${plan.detectedPaths.length}`);

  if (plan.matchedSurfaces.length > 0) {
    lines.push("");
    lines.push("### Changed surfaces");
    for (const surface of plan.matchedSurfaces) {
      lines.push(`- **${surface.label}**: ${surface.rationale}`);
      lines.push(`  Paths: ${formatMarkdownList(surface.matchedPaths)}`);
    }
  }

  lines.push("");
  lines.push("### Required checks");
  if (plan.requiredSteps.length === 0) {
    lines.push("- [ ] No required steps inferred from the matched paths.");
  } else {
    for (const step of plan.requiredSteps) {
      lines.push(
        `- [ ] ${step.kind === "command" && step.command ? `\`${step.command}\`` : step.summary}`
      );
      if (step.kind !== "command" || !step.command) {
        lines.push(`  Reason: ${step.summary}`);
      } else {
        lines.push(`  Reason: ${step.summary}`);
      }
      if (step.sources.length > 0) {
        lines.push(`  Required because: ${step.sources.join(", ")}`);
      }
    }
  }

  lines.push("");
  lines.push("### Optional diagnostics");
  if (plan.optionalSteps.length === 0) {
    lines.push("- None.");
  } else {
    for (const step of plan.optionalSteps) {
      lines.push(
        `- [ ] ${step.kind === "command" && step.command ? `\`${step.command}\`` : step.summary}`
      );
      lines.push(`  Reason: ${step.summary}`);
      if (step.sources.length > 0) {
        lines.push(`  Consider because: ${step.sources.join(", ")}`);
      }
    }
  }

  if (plan.unmatchedPaths.length > 0) {
    lines.push("");
    lines.push("### Unmatched paths");
    for (const filePath of plan.unmatchedPaths) {
      lines.push(`- \`${filePath}\``);
    }
  }

  if (plan.humanOverrides.length > 0) {
    lines.push("");
    lines.push("### Reviewer notes");
    for (const override of plan.humanOverrides) {
      lines.push(`- ${override}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function renderPlainTextValidationPlan(plan: ValidationPlan, options?: RenderOptions): string {
  const lines: string[] = [];

  lines.push("Recommended minimal validation plan");
  lines.push("");
  if (options?.comparisonLabel) {
    lines.push(`Comparison: ${options.comparisonLabel}`);
  }
  lines.push(`Detected paths: ${plan.detectedPaths.length}`);

  if (plan.matchedSurfaces.length > 0) {
    lines.push("");
    lines.push("Matched surfaces:");
    for (const surface of plan.matchedSurfaces) {
      lines.push(`- ${surface.label}: ${surface.matchedPaths.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("Required:");
  if (plan.requiredSteps.length === 0) {
    lines.push("- No required steps inferred from the matched paths.");
  } else {
    for (const step of plan.requiredSteps) {
      lines.push(formatStep(step));
    }
  }

  lines.push("");
  lines.push("Optional diagnostics:");
  if (plan.optionalSteps.length === 0) {
    lines.push("- None.");
  } else {
    for (const step of plan.optionalSteps) {
      lines.push(formatStep(step));
    }
  }

  if (plan.unmatchedPaths.length > 0) {
    lines.push("");
    lines.push("Unmatched paths:");
    for (const filePath of plan.unmatchedPaths) {
      lines.push(`- ${filePath}`);
    }
  }

  if (plan.humanOverrides.length > 0) {
    lines.push("");
    lines.push("Human overrides:");
    for (const override of plan.humanOverrides) {
      lines.push(`- ${override}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

export function renderValidationPlan(plan: ValidationPlan, options?: RenderOptions): string {
  return renderMarkdownValidationPlan(plan, options);
}

function readPullRequestPathList(pr: string): string[] {
  const output = execFileSync("gh", ["pr", "diff", pr, "--name-only"], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"]
  });

  return output
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function main(): void {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }

  if (args.json && (args.markdown || args.text)) {
    throw new Error("Choose only one output format: --json, --markdown, or --text.");
  }

  if (args.pr && (args.base || args.head || args.branch || args.paths.length > 0)) {
    throw new Error("--pr cannot be combined with --base, --head, --branch, or explicit paths.");
  }

  const head = args.head ?? "HEAD";
  const comparisonLabel = args.pr
    ? `PR #${args.pr}`
    : args.branch
      ? `${args.branch}...${head}`
      : args.base
        ? `${args.base}...${head}`
        : args.paths.length > 0
          ? "explicit paths"
          : "working tree + index + origin/main...HEAD";

  const detectedPaths = args.paths.length > 0
    ? args.paths
    : args.pr
      ? uniqueSorted(readPullRequestPathList(args.pr))
      : detectPathsFromGit(args.branch ?? args.base, head);
  const plan = inferValidationPlan(detectedPaths);

  if (plan.detectedPaths.length === 0) {
    throw new Error("No changed paths detected. Pass explicit paths or use --branch, --base/--head, or --pr.");
  }

  if (args.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  process.stdout.write(
    args.text
      ? renderPlainTextValidationPlan(plan, { comparisonLabel })
      : renderValidationPlan(plan, { comparisonLabel })
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
