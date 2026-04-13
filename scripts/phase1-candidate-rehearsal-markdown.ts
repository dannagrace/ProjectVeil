type TargetSurface = "h5" | "wechat";

interface StageResult {
  id: string;
  title: string;
  status: "passed" | "failed" | "skipped";
  summary: string;
  command?: string;
  exitCode?: number | null;
  outputs?: string[];
}

export interface RehearsalArtifacts {
  candidateEvidenceManifestPath?: string;
  candidateEvidenceManifestMarkdownPath?: string;
  stableH5SmokePath?: string;
  stableReconnectSoakPath?: string;
  cocosRcReconnectReplayPath?: string;
  cocosRcReconnectReplayMarkdownPath?: string;
  stableRuntimeReportPath?: string;
  runtimeObservabilityBundlePath?: string;
  runtimeObservabilityBundleMarkdownPath?: string;
  runtimeObservabilityEvidencePath?: string;
  runtimeObservabilityEvidenceMarkdownPath?: string;
  runtimeObservabilityGatePath?: string;
  runtimeObservabilityGateMarkdownPath?: string;
  stableWechatArtifactsDir?: string;
  releaseReadinessSnapshotPath?: string;
  wechatCandidateSummaryPath?: string;
  wechatCandidateMarkdownPath?: string;
  persistencePath?: string;
  cocosPrimaryJourneyEvidencePath?: string;
  cocosPrimaryJourneyEvidenceMarkdownPath?: string;
  cocosMainJourneyReplayGatePath?: string;
  cocosMainJourneyReplayGateMarkdownPath?: string;
  cocosPrimaryDiagnosticsPath?: string;
  cocosPrimaryDiagnosticsMarkdownPath?: string;
  candidateRevisionTriageInputPath?: string;
  candidateRevisionTriageDigestPath?: string;
  candidateRevisionTriageDigestMarkdownPath?: string;
  cocosBundlePath?: string;
  cocosBundleMarkdownPath?: string;
  releaseGateSummaryPath?: string;
  releaseGateMarkdownPath?: string;
  ciTrendSummaryPath?: string;
  ciTrendMarkdownPath?: string;
  releaseHealthSummaryPath?: string;
  releaseHealthMarkdownPath?: string;
  sameRevisionEvidenceBundleManifestPath?: string;
  sameRevisionEvidenceBundleMarkdownPath?: string;
  phase1ReleaseEvidenceDriftGatePath?: string;
  phase1ReleaseEvidenceDriftGateMarkdownPath?: string;
  manualEvidenceLedgerPath?: string;
  releaseReadinessDashboardPath?: string;
  releaseReadinessDashboardMarkdownPath?: string;
  candidateEvidenceAuditPath?: string;
  candidateEvidenceAuditMarkdownPath?: string;
  candidateEvidenceFreshnessGuardPath?: string;
  candidateEvidenceFreshnessGuardMarkdownPath?: string;
  candidateEvidenceOwnerReminderPath?: string;
  candidateEvidenceOwnerReminderMarkdownPath?: string;
  candidateEvidenceFreshnessHistoryPath?: string;
  releaseEvidenceIndexPath?: string;
  releaseEvidenceIndexMarkdownPath?: string;
  phase1CandidateDossierPath?: string;
  phase1CandidateDossierMarkdownPath?: string;
  phase1ExitAuditPath?: string;
  phase1ExitAuditMarkdownPath?: string;
  phase1ExitDossierFreshnessGatePath?: string;
  phase1ExitDossierFreshnessGateMarkdownPath?: string;
  goNoGoPacketPath?: string;
  goNoGoPacketMarkdownPath?: string;
  releasePrCommentPath?: string;
  summaryPath?: string;
  markdownPath?: string;
}

export interface RehearsalReport {
  schemaVersion: 1;
  generatedAt: string;
  candidate: {
    name: string;
    revision: string;
    shortRevision: string;
    branch: string;
    dirty: boolean;
    targetSurface: TargetSurface;
  };
  summary: {
    status: "passed" | "failed";
    stageFailures: string[];
    missingArtifacts: string[];
    releaseGateStatus: string;
    releaseHealthStatus: string;
    phase1CandidateStatus: string;
  };
  runUrl?: string;
  artifactBundleDir: string;
  artifacts: RehearsalArtifacts;
  stages: StageResult[];
}

export function renderMarkdown(report: RehearsalReport): string {
  const lines: string[] = [];
  lines.push("# Phase 1 Candidate Rehearsal", "");
  lines.push(`- Candidate: \`${report.candidate.name}\``);
  lines.push(`- Revision: \`${report.candidate.shortRevision}\``);
  lines.push(`- Branch: \`${report.candidate.branch}\``);
  lines.push(`- Target surface: \`${report.candidate.targetSurface}\``);
  lines.push(`- Rehearsal status: **${report.summary.status.toUpperCase()}**`);
  lines.push(`- Release gate summary: \`${report.summary.releaseGateStatus}\``);
  lines.push(`- Release health summary: \`${report.summary.releaseHealthStatus}\``);
  lines.push(`- Phase 1 dossier summary: \`${report.summary.phase1CandidateStatus}\``);
  lines.push(`- Artifact bundle: \`${report.artifactBundleDir}\``);
  if (report.runUrl) {
    lines.push(`- Workflow run: ${report.runUrl}`);
  }
  lines.push("");

  if (report.summary.stageFailures.length > 0) {
    lines.push("## Stage Failures", "");
    for (const failure of report.summary.stageFailures) {
      lines.push(`- ${failure}`);
    }
    lines.push("");
  }

  if (report.summary.missingArtifacts.length > 0) {
    lines.push("## Missing Artifacts", "");
    for (const artifact of report.summary.missingArtifacts) {
      lines.push(`- ${artifact}`);
    }
    lines.push("");
  }

  lines.push(
    "## Reviewer Front Door",
    "",
    "Open this section first. It is the canonical packet-level reviewer entrypoint from `SUMMARY.md`.",
    ""
  );
  if (report.artifacts.candidateEvidenceManifestMarkdownPath) {
    lines.push(`- Release candidate manifest markdown: \`${report.artifacts.candidateEvidenceManifestMarkdownPath}\``);
  }
  if (report.artifacts.candidateEvidenceAuditMarkdownPath) {
    lines.push(`- Same-candidate evidence audit markdown: \`${report.artifacts.candidateEvidenceAuditMarkdownPath}\``);
  }
  if (report.artifacts.candidateEvidenceManifestPath) {
    lines.push(`- Release candidate manifest JSON: \`${report.artifacts.candidateEvidenceManifestPath}\``);
  }
  if (report.artifacts.releaseEvidenceIndexPath) {
    lines.push(`- Current release evidence index: \`${report.artifacts.releaseEvidenceIndexPath}\``);
  }
  if (report.artifacts.releaseEvidenceIndexMarkdownPath) {
    lines.push(`- Current release evidence index markdown: \`${report.artifacts.releaseEvidenceIndexMarkdownPath}\``);
  }
  if (report.artifacts.releaseGateSummaryPath) {
    lines.push(`- Release gate summary: \`${report.artifacts.releaseGateSummaryPath}\``);
  }
  if (report.artifacts.releaseGateMarkdownPath) {
    lines.push(`- Release gate summary markdown: \`${report.artifacts.releaseGateMarkdownPath}\``);
  }
  if (report.artifacts.releaseHealthSummaryPath) {
    lines.push(`- Release health summary: \`${report.artifacts.releaseHealthSummaryPath}\``);
  }
  if (report.artifacts.releaseHealthMarkdownPath) {
    lines.push(`- Release health summary markdown: \`${report.artifacts.releaseHealthMarkdownPath}\``);
  }
  if (report.artifacts.ciTrendSummaryPath) {
    lines.push(`- CI trend summary: \`${report.artifacts.ciTrendSummaryPath}\``);
  }
  if (report.artifacts.ciTrendMarkdownPath) {
    lines.push(`- CI trend summary markdown: \`${report.artifacts.ciTrendMarkdownPath}\``);
  }
  if (report.artifacts.releaseReadinessSnapshotPath) {
    lines.push(`- Release readiness snapshot: \`${report.artifacts.releaseReadinessSnapshotPath}\``);
  }
  if (report.artifacts.runtimeObservabilityGatePath) {
    lines.push(`- Runtime observability gate: \`${report.artifacts.runtimeObservabilityGatePath}\``);
  }
  if (report.artifacts.runtimeObservabilityGateMarkdownPath) {
    lines.push(`- Runtime observability gate markdown: \`${report.artifacts.runtimeObservabilityGateMarkdownPath}\``);
  }
  if (report.artifacts.stableH5SmokePath) {
    lines.push(`- H5 candidate smoke: \`${report.artifacts.stableH5SmokePath}\``);
  }
  if (report.artifacts.stableReconnectSoakPath) {
    lines.push(`- Reconnect soak summary: \`${report.artifacts.stableReconnectSoakPath}\``);
  }
  if (report.artifacts.cocosRcReconnectReplayPath) {
    lines.push(`- Cocos reconnect replay: \`${report.artifacts.cocosRcReconnectReplayPath}\``);
  }
  if (report.artifacts.wechatCandidateSummaryPath) {
    lines.push(`- WeChat candidate summary: \`${report.artifacts.wechatCandidateSummaryPath}\``);
  }
  if (report.artifacts.runtimeObservabilityBundlePath) {
    lines.push(`- Runtime observability bundle: \`${report.artifacts.runtimeObservabilityBundlePath}\``);
  }
  if (report.artifacts.runtimeObservabilityEvidencePath) {
    lines.push(`- Runtime observability evidence: \`${report.artifacts.runtimeObservabilityEvidencePath}\``);
  }
  if (report.artifacts.candidateEvidenceAuditPath) {
    lines.push(`- Candidate evidence audit: \`${report.artifacts.candidateEvidenceAuditPath}\``);
  }
  if (report.artifacts.candidateEvidenceFreshnessGuardPath) {
    lines.push(`- Candidate freshness guard: \`${report.artifacts.candidateEvidenceFreshnessGuardPath}\``);
  }
  if (report.artifacts.candidateEvidenceOwnerReminderPath) {
    lines.push(`- Candidate owner reminder: \`${report.artifacts.candidateEvidenceOwnerReminderPath}\``);
  }
  if (report.artifacts.candidateEvidenceFreshnessHistoryPath) {
    lines.push(`- Candidate freshness history: \`${report.artifacts.candidateEvidenceFreshnessHistoryPath}\``);
  }
  if (report.artifacts.releaseReadinessDashboardPath) {
    lines.push(`- Release readiness dashboard: \`${report.artifacts.releaseReadinessDashboardPath}\``);
  }
  if (report.artifacts.sameRevisionEvidenceBundleManifestPath) {
    lines.push(`- Same-revision evidence bundle manifest: \`${report.artifacts.sameRevisionEvidenceBundleManifestPath}\``);
  }
  if (report.artifacts.phase1ReleaseEvidenceDriftGatePath) {
    lines.push(`- Phase 1 release evidence drift gate: \`${report.artifacts.phase1ReleaseEvidenceDriftGatePath}\``);
  }
  if (report.artifacts.phase1ExitAuditPath) {
    lines.push(`- Phase 1 exit audit: \`${report.artifacts.phase1ExitAuditPath}\``);
  }
  if (report.artifacts.phase1ExitDossierFreshnessGatePath) {
    lines.push(`- Phase 1 exit dossier freshness gate: \`${report.artifacts.phase1ExitDossierFreshnessGatePath}\``);
  }
  if (report.artifacts.phase1CandidateDossierPath) {
    lines.push(`- Phase 1 candidate dossier: \`${report.artifacts.phase1CandidateDossierPath}\``);
  }
  if (report.artifacts.phase1CandidateDossierMarkdownPath) {
    lines.push(`- Phase 1 candidate dossier markdown: \`${report.artifacts.phase1CandidateDossierMarkdownPath}\``);
  }
  if (report.artifacts.manualEvidenceLedgerPath) {
    lines.push(`- Manual evidence owner ledger: \`${report.artifacts.manualEvidenceLedgerPath}\``);
  }
  if (report.artifacts.cocosPrimaryJourneyEvidencePath) {
    lines.push(`- Cocos primary journey evidence: \`${report.artifacts.cocosPrimaryJourneyEvidencePath}\``);
  }
  if (report.artifacts.cocosMainJourneyReplayGatePath) {
    lines.push(`- Cocos main-journey replay gate: \`${report.artifacts.cocosMainJourneyReplayGatePath}\``);
  }
  if (report.artifacts.cocosPrimaryDiagnosticsPath) {
    lines.push(`- Cocos primary diagnostics: \`${report.artifacts.cocosPrimaryDiagnosticsPath}\``);
  }
  if (report.artifacts.candidateRevisionTriageDigestPath) {
    lines.push(`- Candidate revision triage digest: \`${report.artifacts.candidateRevisionTriageDigestPath}\``);
  }
  if (report.artifacts.cocosBundlePath) {
    lines.push(`- Cocos RC bundle: \`${report.artifacts.cocosBundlePath}\``);
  }
  if (report.artifacts.goNoGoPacketPath) {
    lines.push(`- Go/no-go packet: \`${report.artifacts.goNoGoPacketPath}\``);
  }
  if (report.artifacts.releasePrCommentPath) {
    lines.push(`- Release PR summary: \`${report.artifacts.releasePrCommentPath}\``);
  }
  lines.push("");

  lines.push("## Generated Outputs", "");
  const artifactEntries = Object.entries(report.artifacts)
    .filter(([, value]) => typeof value === "string" && value.length > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [key, value] of artifactEntries) {
    lines.push(`- ${key}: \`${value}\``);
  }
  lines.push("");

  lines.push("## Stage Results", "");
  lines.push("| Stage | Status | Notes |");
  lines.push("| --- | --- | --- |");
  for (const stage of report.stages) {
    lines.push(`| ${stage.title} | ${stage.status.toUpperCase()} | ${stage.summary.replace(/\|/g, "\\|")} |`);
  }
  lines.push("");

  lines.push("## Notes", "");
  lines.push("- This rehearsal validates artifact generation and candidate-scoped evidence packaging on `main`.");
  lines.push("- The dossier can remain `pending` when live runtime sampling or WeChat manual-review evidence is intentionally absent from automation.");
  return `${lines.join("\n")}\n`;
}
