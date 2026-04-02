import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  renderPrCommentHealthSignal,
  renderReviewerFacingMarkdownEntry,
  type ReviewerFacingSignal,
  type ReviewerFacingTriageEntry
} from "./release-reporting-contract.ts";

interface Args {
  releaseGateSummaryPath?: string;
  releaseHealthSummaryPath?: string;
  goNoGoPacketPath?: string;
  outputPath?: string;
  runUrl?: string;
}

interface ReleaseGateSummaryReport {
  generatedAt: string;
  revision: {
    shortCommit: string;
    branch: string;
  };
  summary: {
    status: "passed" | "failed";
    passedGates: number;
    totalGates: number;
  };
  gates: Array<{
    id: string;
    label: string;
    status: "passed" | "failed";
    summary: string;
    failures?: string[];
  }>;
  triage: {
    blockers: Array<{
      title: string;
      impactedSurface: "h5" | "wechat";
      summary: string;
      nextStep: string;
      artifacts: Array<{ path: string }>;
    }>;
    warnings: Array<{
      title: string;
      impactedSurface: "h5" | "wechat";
      summary: string;
      nextStep: string;
      artifacts: Array<{ path: string }>;
    }>;
  };
}

interface ReleaseHealthSummaryReport {
  generatedAt: string;
  summary: {
    status: "healthy" | "warning" | "blocking";
    blockerCount: number;
    warningCount: number;
    infoCount: number;
  };
  signals: Array<{
    id: string;
    label: string;
    status: "pass" | "warn" | "fail";
    summary: string;
    details: string[];
  }>;
  triage: {
    blockers: Array<{
      signalId: string;
      summary: string;
      nextStep: string;
    }>;
    warnings: Array<{
      signalId: string;
      summary: string;
      nextStep: string;
    }>;
  };
}

interface GoNoGoDecisionPacket {
  generatedAt: string;
  decision: {
    status: "go" | "no_go";
    summary: string;
  };
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    targetSurface: "h5" | "wechat";
  };
  inputs: {
    dossierPath: string;
    releaseGateSummaryPath: string;
    wechatCandidateSummaryPath?: string;
  };
  sections: {
    blockerSummary: {
      blockers: Array<{
        title: string;
        summary: string;
        artifactPath?: string;
        nextStep?: string;
      }>;
      warnings: Array<{
        title: string;
        summary: string;
        artifactPath?: string;
      }>;
    };
    unresolvedManualChecks: Array<{
      title: string;
      status: "passed" | "failed" | "pending" | "not_applicable";
      artifactPath?: string;
    }>;
  };
}

const COMMENT_MARKER = "<!-- project-veil-release-summary -->";

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let releaseGateSummaryPath: string | undefined;
  let releaseHealthSummaryPath: string | undefined;
  let goNoGoPacketPath: string | undefined;
  let outputPath: string | undefined;
  let runUrl: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--release-gate-summary" && next) {
      releaseGateSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--release-health-summary" && next) {
      releaseHealthSummaryPath = next;
      index += 1;
      continue;
    }
    if (arg === "--go-no-go-packet" && next) {
      goNoGoPacketPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--run-url" && next) {
      runUrl = next;
      index += 1;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(releaseGateSummaryPath ? { releaseGateSummaryPath } : {}),
    ...(releaseHealthSummaryPath ? { releaseHealthSummaryPath } : {}),
    ...(goNoGoPacketPath ? { goNoGoPacketPath } : {}),
    ...(outputPath ? { outputPath } : {}),
    ...(runUrl ? { runUrl } : {})
  };
}

function readJsonFile<T>(filePath: string | undefined): T {
  if (!filePath) {
    fail("Missing required file path.");
  }
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8")) as T;
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

function toDisplayPath(filePath: string): string {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(process.cwd(), absolutePath).replace(/\\/g, "/");
  if (relativePath.length > 0 && !relativePath.startsWith("../")) {
    return relativePath;
  }

  const normalizedAbsolutePath = absolutePath.replace(/\\/g, "/");
  for (const marker of ["/release-readiness/", "/wechat-release/", "/runtime-regression/", "/baseline/", "/configs/"]) {
    const markerIndex = normalizedAbsolutePath.lastIndexOf(marker);
    if (markerIndex >= 0) {
      return normalizedAbsolutePath.slice(markerIndex + 1);
    }
  }

  return normalizedAbsolutePath;
}

function summarizeGate(gate: ReleaseGateSummaryReport["gates"][number]): string {
  const statusLabel = gate.status === "passed" ? "PASS" : "FAIL";
  const firstFailure = gate.failures?.find((failure) => failure.trim().length > 0);
  return `- **${gate.label}**: \`${statusLabel}\` ${firstFailure ?? gate.summary}`;
}

function renderGoNoGoPacketSection(packet: GoNoGoDecisionPacket, packetPath: string): string[] {
  const packetMarkdownPath = packetPath.endsWith(".json") ? packetPath.replace(/\.json$/u, ".md") : undefined;
  const keyArtifacts = [
    packetPath,
    ...(packetMarkdownPath ? [packetMarkdownPath] : []),
    packet.inputs.dossierPath,
    packet.inputs.releaseGateSummaryPath,
    ...(packet.inputs.wechatCandidateSummaryPath ? [packet.inputs.wechatCandidateSummaryPath] : []),
    ...packet.sections.blockerSummary.blockers.flatMap((item) => (item.artifactPath ? [item.artifactPath] : [])),
    ...packet.sections.blockerSummary.warnings.flatMap((item) => (item.artifactPath ? [item.artifactPath] : [])),
    ...packet.sections.unresolvedManualChecks.flatMap((item) => (item.artifactPath ? [item.artifactPath] : []))
  ].filter((item, index, values) => values.indexOf(item) === index);

  return [
    "### Go/No-Go Packet",
    "",
    ...renderReviewerFacingMarkdownEntry(
      "Go/No-Go verdict",
      `${packet.candidate.name} @ ${packet.candidate.shortRevision}: \`${packet.decision.status.toUpperCase()}\` with ${packet.sections.blockerSummary.blockers.length} blocker(s) and ${packet.sections.blockerSummary.warnings.length} warning(s).`,
      {
        status: packet.decision.status === "go" ? "pass" : "fail",
        nextStep: packet.sections.blockerSummary.blockers[0]?.nextStep,
        artifacts: keyArtifacts.map((artifactPath) => ({ path: artifactPath })),
        toDisplayPath
      }
    ),
    `- Packet summary: ${packet.decision.summary}`,
    `- Target surface: \`${packet.candidate.targetSurface}\` on branch \`${packet.candidate.branch}\``,
    `- Unresolved manual checks: ${packet.sections.unresolvedManualChecks.length}`,
    ...(packet.sections.blockerSummary.blockers.length === 0
      ? []
      : packet.sections.blockerSummary.blockers
          .slice(0, 2)
          .map((item) => `- Blocking signal: **${item.title}** ${item.summary}`)),
    ...(packet.sections.blockerSummary.warnings.length === 0
      ? []
      : packet.sections.blockerSummary.warnings
          .slice(0, 2)
          .map((item) => `- Advisory signal: **${item.title}** ${item.summary}`)),
    ""
  ];
}

export function renderPrComment(
  releaseGateReport: ReleaseGateSummaryReport,
  releaseHealthReport: ReleaseHealthSummaryReport,
  options?: {
    runUrl?: string;
    goNoGoPacket?: GoNoGoDecisionPacket;
    goNoGoPacketPath?: string;
  }
): string {
  const healthSignals = releaseHealthReport.signals.filter(
    (signal) => signal.id !== "release-readiness" && signal.id !== "release-gate"
  );

  const lines = [
    COMMENT_MARKER,
    "## Release Automation Summary",
    "",
    `- Revision: \`${releaseGateReport.revision.shortCommit}\` on \`${releaseGateReport.revision.branch}\``,
    `- Release readiness: **${releaseGateReport.summary.status.toUpperCase()}** (${releaseGateReport.summary.passedGates}/${releaseGateReport.summary.totalGates} gates passing)`,
    `- Release health: **${releaseHealthReport.summary.status.toUpperCase()}** (${releaseHealthReport.summary.blockerCount} blocker, ${releaseHealthReport.summary.warningCount} warning, ${releaseHealthReport.summary.infoCount} info)`,
    ...(options?.goNoGoPacket
      ? [
          `- Go/no-go packet: **${options.goNoGoPacket.decision.status.toUpperCase()}** (${options.goNoGoPacket.sections.blockerSummary.blockers.length} blocker, ${options.goNoGoPacket.sections.blockerSummary.warnings.length} warning)`
        ]
      : []),
    ...(options?.runUrl ? [`- CI run: ${options.runUrl}`] : []),
    "",
    ...(options?.goNoGoPacket && options.goNoGoPacketPath
      ? renderGoNoGoPacketSection(options.goNoGoPacket, options.goNoGoPacketPath)
      : []),
    "### Triage",
    "",
    ...renderReviewerFacingMarkdownEntry(
      "Release blockers",
      releaseGateReport.triage.blockers.length === 0
        ? "No blocking release-gate triage items."
        : `${releaseGateReport.triage.blockers.length} blocking release-gate item(s) need operator follow-up.`,
      {
        status: releaseGateReport.triage.blockers.length === 0 ? "pass" : "fail",
        nextStep: releaseGateReport.triage.blockers[0]?.nextStep,
        artifacts: releaseGateReport.triage.blockers[0]?.artifacts
      }
    ),
    ...(releaseGateReport.triage.blockers.length === 0
      ? []
      : releaseGateReport.triage.blockers.map(
          (entry) => `  - **${entry.title}** (${entry.impactedSurface}): ${entry.summary}`
        )),
    ...renderReviewerFacingMarkdownEntry(
      "Release warnings",
      releaseGateReport.triage.warnings.length === 0
        ? "No advisory release-gate warnings."
        : `${releaseGateReport.triage.warnings.length} advisory release-gate warning(s) are worth checking before promotion.`,
      {
        status: releaseGateReport.triage.warnings.length === 0 ? "pass" : "warn",
        nextStep: releaseGateReport.triage.warnings[0]?.nextStep,
        artifacts: releaseGateReport.triage.warnings[0]?.artifacts
      }
    ),
    ...(releaseGateReport.triage.warnings.length === 0
      ? []
      : releaseGateReport.triage.warnings.map(
          (entry) => `  - **${entry.title}** (${entry.impactedSurface}): ${entry.summary}`
        )),
    "",
    "### Release Readiness",
    "",
    ...releaseGateReport.gates.map((gate) => summarizeGate(gate)),
    "",
    "### Release Health",
    ""
  ];
  const healthTriageBySignalId = new Map<string, ReviewerFacingTriageEntry>(
    [...releaseHealthReport.triage.blockers, ...releaseHealthReport.triage.warnings].map((entry) => [entry.signalId, entry])
  );

  if (healthSignals.length === 0) {
    lines.push("- No additional release-health signals were available beyond release readiness.");
  } else {
    for (const signal of healthSignals) {
      lines.push(
        ...renderPrCommentHealthSignal(
          signal as ReviewerFacingSignal,
          healthTriageBySignalId.get(signal.id)
        )
      );
    }
  }

  lines.push("");
  lines.push(`<sub>Updated from CI artifacts at \`${releaseHealthReport.generatedAt}\`.</sub>`);

  return `${lines.join("\n").trim()}\n`;
}

function main(): void {
  const args = parseArgs(process.argv);
  const releaseGateReport = readJsonFile<ReleaseGateSummaryReport>(args.releaseGateSummaryPath);
  const releaseHealthReport = readJsonFile<ReleaseHealthSummaryReport>(args.releaseHealthSummaryPath);
  const content = renderPrComment(releaseGateReport, releaseHealthReport, {
    runUrl: args.runUrl,
    ...(args.goNoGoPacketPath
      ? {
          goNoGoPacket: readJsonFile<GoNoGoDecisionPacket>(args.goNoGoPacketPath),
          goNoGoPacketPath: args.goNoGoPacketPath
        }
      : {})
  });
  const outputPath = path.resolve(args.outputPath ?? path.join("artifacts", "release-readiness", "release-pr-comment.md"));
  writeFile(outputPath, content);
  console.log(`Wrote release PR comment markdown: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
