export type ReviewerSignalStatus = "pass" | "warn" | "fail";
export type ReadinessDecision = "ready" | "pending" | "blocked";

export interface ReviewerFacingSignal {
  id: string;
  label: string;
  status: ReviewerSignalStatus;
  summary: string;
  details: string[];
}

export interface ReviewerFacingTriageEntry {
  signalId: string;
  summary: string;
  nextStep: string;
}

export function formatReadinessTrendNoBaselineSummary(currentCandidate: string, currentDecision: ReadinessDecision): string {
  return `No previous candidate dashboard was available; current candidate ${currentCandidate} is ${currentDecision}.`;
}

export function formatReadinessTrendRegressionSummary(
  previousDecision: ReadinessDecision,
  previousCandidate: string,
  currentDecision: ReadinessDecision,
  currentCandidate: string
): string {
  return `Candidate readiness regressed from ${previousDecision} at ${previousCandidate} to ${currentDecision} at ${currentCandidate}.`;
}

export function formatReadinessTrendUnchangedUnreadySummary(
  currentDecision: ReadinessDecision,
  previousCandidate: string,
  currentCandidate: string
): string {
  return `Candidate readiness remains ${currentDecision} across ${previousCandidate} and ${currentCandidate}.`;
}

export function formatReadinessTrendHealthySummary(
  previousDecision: ReadinessDecision,
  previousCandidate: string,
  currentDecision: ReadinessDecision,
  currentCandidate: string
): string {
  if (previousDecision === currentDecision) {
    return `Candidate readiness remains ready across ${previousCandidate} and ${currentCandidate}.`;
  }
  return `Candidate readiness improved from ${previousDecision} at ${previousCandidate} to ${currentDecision} at ${currentCandidate}.`;
}

export function renderPrCommentHealthSignal(
  signal: ReviewerFacingSignal,
  triageEntry?: ReviewerFacingTriageEntry
): string[] {
  const statusLabel = signal.status.toUpperCase();
  const firstDetail = signal.details.find((detail) => detail.trim().length > 0);
  const summary = triageEntry?.summary ?? firstDetail ?? signal.summary;
  const lines = [`- **${signal.label}**: \`${statusLabel}\` ${summary}`];

  if (triageEntry) {
    lines.push(`  Next step: ${triageEntry.nextStep}`);
  }

  return lines;
}
