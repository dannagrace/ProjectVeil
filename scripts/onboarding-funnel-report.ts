import fs from "node:fs";
import path from "node:path";
import {
  ONBOARDING_FUNNEL_STAGES,
  type OnboardingFunnelStageDefinition
} from "../packages/shared/src/index.ts";

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "analytics");
const DEFAULT_COMPLETION_RATE_THRESHOLD = 0.7;
const DEFAULT_MEDIAN_COMPLETION_SECONDS_THRESHOLD = 300;
const DEFAULT_STAGE_DROP_OFF_RATE_THRESHOLD = 0.35;

interface Args {
  inputPaths: string[];
  diagnosticsPaths: string[];
  outputPath?: string;
  markdownOutputPath?: string;
  completionRateThreshold: number;
  medianCompletionSecondsThreshold: number;
  stageDropOffRateThreshold: number;
}

interface RawAnalyticsEvent {
  name?: unknown;
  at?: unknown;
  playerId?: unknown;
  payload?: unknown;
}

interface DiagnosticFailureRecord {
  playerId: string;
  reason: string;
  at?: string;
  stageId?: string;
}

interface OnboardingParticipant {
  playerId: string;
  firstObservedAt?: string;
  stageTimes: Partial<Record<ReportStageId, string>>;
  highestStageIndex: number;
  failureReasons: Array<{
    reason: string;
    at?: string;
    stageId?: string;
    source: "analytics" | "diagnostics";
  }>;
}

interface StageReport {
  id: ReportStageId;
  label: string;
  successCriteria: string;
  evidenceNotes: string;
  reachedCount: number;
  reachedRate: number;
  dropOffCount: number;
  dropOffRateFromPrevious: number | null;
}

interface FailureReasonSummary {
  reason: string;
  count: number;
  playerCount: number;
  stageIds: string[];
}

interface OnboardingFunnelReport {
  schemaVersion: 1;
  generatedAt: string;
  summary: {
    entrants: number;
    completed: number;
    completionRate: number;
    medianCompletionSeconds: number | null;
    medianCompletionMinutes: number | null;
  };
  thresholds: {
    completionRate: number;
    medianCompletionSeconds: number;
    stageDropOffRate: number;
  };
  regressions: string[];
  observability: {
    inputCount: number;
    diagnosticsCount: number;
    entrantsWithFailureEvidence: number;
    entrantsWithoutFailureEvidence: number;
  };
  inputs: {
    inputPaths: string[];
    diagnosticsPaths: string[];
  };
  canonicalStages: OnboardingFunnelStageDefinition[];
  stageReports: StageReport[];
  pmSummary: {
    focusChainLabel: string;
    focusStages: Array<{
      id: ReportStageId;
      label: string;
      reachedCount: number;
      dropOffCount: number;
      dropOffRateFromPrevious: number | null;
    }>;
    narrative: string[];
  };
  topFailureReasons: FailureReasonSummary[];
  participants: Array<{
    playerId: string;
    firstObservedAt?: string;
    highestStageId?: ReportStageId;
    completed: boolean;
    failureReasons: string[];
  }>;
}

interface StageDefinition {
  id: string;
  label: string;
  successCriteria: string;
  evidenceNotes: string;
}

const SUPPLEMENTAL_ONBOARDING_FUNNEL_STAGES = [
  {
    id: "first_campaign_mission_started",
    label: "First Campaign Mission Started",
    successCriteria: "The player is handed from tutorial completion into the first chapter path.",
    evidenceNotes:
      "Prefer an explicit `stageId` marker in fixtures. Otherwise the report infers this stage from the first chapter mission completion artifact after onboarding completion."
  },
  {
    id: "first_battle_settled",
    label: "First Battle Settled",
    successCriteria: "The player's first chapter battle resolves and the settlement state is visible.",
    evidenceNotes:
      "Prefer an explicit `stageId` marker in fixtures. Otherwise the report infers this stage from the first `battle_end` artifact after chapter handoff."
  },
  {
    id: "first_reward_claimed",
    label: "First Reward Claimed",
    successCriteria: "The player's first post-battle reward is claimed and visible to PM review.",
    evidenceNotes:
      "Prefer an explicit `stageId` marker in fixtures. Otherwise the report infers this stage from the first reward-claim artifact after first battle settlement."
  }
] as const satisfies readonly StageDefinition[];

const REPORT_STAGE_DEFINITIONS = mergeStageDefinitions(ONBOARDING_FUNNEL_STAGES, SUPPLEMENTAL_ONBOARDING_FUNNEL_STAGES);
const POST_TUTORIAL_FOCUS_STAGE_IDS = [
  "onboarding_completed",
  "first_campaign_mission_started",
  "first_battle_settled",
  "first_reward_claimed"
] as const;

type ReportStageId = (typeof REPORT_STAGE_DEFINITIONS)[number]["id"];

function parseArgs(argv: string[]): Args {
  const args: Args = {
    inputPaths: [],
    diagnosticsPaths: [],
    completionRateThreshold: DEFAULT_COMPLETION_RATE_THRESHOLD,
    medianCompletionSecondsThreshold: DEFAULT_MEDIAN_COMPLETION_SECONDS_THRESHOLD,
    stageDropOffRateThreshold: DEFAULT_STAGE_DROP_OFF_RATE_THRESHOLD
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    const next = argv[index + 1];

    if (current === "--input" && next) {
      args.inputPaths.push(next);
      index += 1;
      continue;
    }
    if (current === "--diagnostics" && next) {
      args.diagnosticsPaths.push(next);
      index += 1;
      continue;
    }
    if (current === "--output" && next) {
      args.outputPath = next;
      index += 1;
      continue;
    }
    if (current === "--markdown-output" && next) {
      args.markdownOutputPath = next;
      index += 1;
      continue;
    }
    if (current === "--completion-rate-threshold" && next) {
      args.completionRateThreshold = parseThreshold(next, current);
      index += 1;
      continue;
    }
    if (current === "--median-completion-seconds-threshold" && next) {
      args.medianCompletionSecondsThreshold = parseThreshold(next, current);
      index += 1;
      continue;
    }
    if (current === "--stage-dropoff-threshold" && next) {
      args.stageDropOffRateThreshold = parseThreshold(next, current);
      index += 1;
      continue;
    }
    if (current === "--help") {
      printUsage();
      process.exit(0);
    }
    throw new Error(`Unknown or incomplete argument: ${current}`);
  }

  if (args.inputPaths.length === 0) {
    throw new Error("Pass at least one --input <path> pointing to analytics envelope JSON.");
  }

  return args;
}

function parseThreshold(value: string, flag: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid numeric value for ${flag}: ${value}`);
  }
  return parsed;
}

function printUsage(): void {
  console.log(`Usage: npm run analytics:onboarding:funnel -- --input <path> [--input <path>] [--diagnostics <path>]`);
}

function collectJsonPaths(inputPath: string): string[] {
  const resolvedPath = path.resolve(inputPath);
  const stat = fs.statSync(resolvedPath);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(resolvedPath, { withFileTypes: true })
      .flatMap((entry) => collectJsonPaths(path.join(resolvedPath, entry.name)))
      .filter((filePath) => filePath.endsWith(".json"))
      .sort();
  }
  return [resolvedPath];
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function extractAnalyticsEvents(payload: unknown): RawAnalyticsEvent[] {
  if (Array.isArray(payload)) {
    return payload as RawAnalyticsEvent[];
  }
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (Array.isArray(record.events)) {
      return record.events as RawAnalyticsEvent[];
    }
  }
  return [];
}

function extractDiagnosticFailures(payload: unknown): DiagnosticFailureRecord[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.failures)) {
    return normalizeDiagnosticFailures(record.failures);
  }
  if (Array.isArray(record.sessions)) {
    return normalizeSessionDiagnostics(record.sessions);
  }
  return [];
}

function normalizeDiagnosticFailures(items: unknown[]): DiagnosticFailureRecord[] {
  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const playerId = toNonEmptyString(record.playerId);
      const reason = toNonEmptyString(record.reason);
      if (!playerId || !reason) {
        return null;
      }
      return {
        playerId,
        reason,
        at: toNonEmptyString(record.at),
        stageId: toNonEmptyString(record.stageId)
      } satisfies DiagnosticFailureRecord;
    })
    .filter((item): item is DiagnosticFailureRecord => item !== null);
}

function normalizeSessionDiagnostics(items: unknown[]): DiagnosticFailureRecord[] {
  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const record = item as Record<string, unknown>;
      const playerId = toNonEmptyString(record.playerId);
      const reason = toNonEmptyString(record.failureReason) ?? toNonEmptyString(record.reason);
      if (!playerId || !reason) {
        return null;
      }
      return {
        playerId,
        reason,
        at: toNonEmptyString(record.at) ?? toNonEmptyString(record.startedAt),
        stageId: toNonEmptyString(record.lastStageId) ?? toNonEmptyString(record.stageId)
      } satisfies DiagnosticFailureRecord;
    })
    .filter((item): item is DiagnosticFailureRecord => item !== null);
}

function toNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function mergeStageDefinitions(
  sharedStages: readonly OnboardingFunnelStageDefinition[],
  supplementalStages: readonly StageDefinition[]
): readonly StageDefinition[] {
  const merged: StageDefinition[] = [];
  const seen = new Set<string>();
  for (const stage of [...sharedStages, ...supplementalStages]) {
    if (seen.has(stage.id)) {
      continue;
    }
    merged.push(stage);
    seen.add(stage.id);
  }
  return merged;
}

function getOrCreateParticipant(participants: Map<string, OnboardingParticipant>, playerId: string): OnboardingParticipant {
  const existing = participants.get(playerId);
  if (existing) {
    return existing;
  }

  const created: OnboardingParticipant = {
    playerId,
    stageTimes: {},
    highestStageIndex: -1,
    failureReasons: []
  };
  participants.set(playerId, created);
  return created;
}

function markStage(participant: OnboardingParticipant, stageId: ReportStageId, at?: string, options?: { inferPreviousStages?: boolean }): void {
  const stageIndex = REPORT_STAGE_DEFINITIONS.findIndex((stage) => stage.id === stageId);
  if (stageIndex < 0) {
    return;
  }

  if (at && (!participant.firstObservedAt || Date.parse(at) < Date.parse(participant.firstObservedAt))) {
    participant.firstObservedAt = at;
  }

  if (options?.inferPreviousStages) {
    for (let index = 0; index < stageIndex; index += 1) {
      const previousStageId = REPORT_STAGE_DEFINITIONS[index].id;
      participant.stageTimes[previousStageId] ??= at;
    }
  }

  participant.stageTimes[stageId] ??= at;
  participant.highestStageIndex = Math.max(participant.highestStageIndex, stageIndex);
}

function collectParticipants(events: RawAnalyticsEvent[], diagnosticFailures: DiagnosticFailureRecord[]): Map<string, OnboardingParticipant> {
  const participants = new Map<string, OnboardingParticipant>();

  const sortedEvents = events
    .map((event) => ({
      name: toNonEmptyString(event.name),
      at: toNonEmptyString(event.at),
      playerId: toNonEmptyString(event.playerId),
      payload: event.payload && typeof event.payload === "object" ? (event.payload as Record<string, unknown>) : {}
    }))
    .filter((event) => event.name && event.playerId)
    .sort((left, right) => Date.parse(left.at ?? "") - Date.parse(right.at ?? ""));

  for (const event of sortedEvents) {
    const participant = getOrCreateParticipant(participants, event.playerId!);
    const explicitStageId = resolveStageIdFromPayload(event.payload);

    if (event.name === "session_start" && looksLikeOnboardingSession(event.payload)) {
      markStage(participant, "onboarding_session_started", event.at);
      markStage(participant, "tutorial_step_1_seen", event.at);
      continue;
    }

    if (event.name === "mission_started" || event.name === "mission_complete") {
      markStage(participant, "first_campaign_mission_started", event.at, { inferPreviousStages: true });
      continue;
    }

    if (event.name === "battle_end") {
      markStage(participant, "first_battle_settled", event.at, { inferPreviousStages: true });
      continue;
    }

    if (event.name === "quest_complete" || event.name === "seasonal_event_reward_claimed") {
      markStage(participant, "first_reward_claimed", event.at, { inferPreviousStages: true });
      continue;
    }

    if (event.name !== "tutorial_step") {
      applyPostTutorialStageMarkers(participant, event.name, event.payload, event.at, explicitStageId);
      continue;
    }

    const stepId = toNonEmptyString(event.payload.stepId);
    const explicitFailureReason = toNonEmptyString(event.payload.failureReason) ?? toNonEmptyString(event.payload.reasonCode);
    if (stepId === "step_1") {
      markStage(participant, "onboarding_session_started", event.at);
      markStage(participant, "tutorial_step_1_seen", event.at, { inferPreviousStages: true });
    } else if (stepId === "step_2") {
      markStage(participant, "tutorial_step_2_seen", event.at, { inferPreviousStages: true });
    } else if (stepId === "step_3") {
      markStage(participant, "tutorial_step_3_seen", event.at, { inferPreviousStages: true });
    } else if (stepId === "tutorial_completed") {
      markStage(participant, "onboarding_completed", event.at, { inferPreviousStages: true });
    } else if (stepId === "tutorial_skipped") {
      markStage(participant, "tutorial_step_1_seen", event.at, { inferPreviousStages: true });
      participant.failureReasons.push({
        reason: explicitFailureReason ?? "manual_exit",
        at: event.at,
        stageId: explicitStageId ?? highestStageId(participant),
        source: "analytics"
      });
    }

    applyPostTutorialStageMarkers(participant, event.name, event.payload, event.at, explicitStageId);
  }

  for (const failure of diagnosticFailures) {
    const participant = getOrCreateParticipant(participants, failure.playerId);
    if (failure.at) {
      markStage(participant, "onboarding_session_started", failure.at);
      markStage(participant, "tutorial_step_1_seen", failure.at);
    }
    participant.failureReasons.push({
      reason: failure.reason,
      at: failure.at,
      stageId: normalizeStageId(failure.stageId) ?? highestStageId(participant),
      source: "diagnostics"
    });
  }

  for (const participant of participants.values()) {
    if (!participant.stageTimes.onboarding_session_started && participant.firstObservedAt) {
      markStage(participant, "onboarding_session_started", participant.firstObservedAt);
      markStage(participant, "tutorial_step_1_seen", participant.firstObservedAt);
    }
  }

  return participants;
}

function looksLikeOnboardingSession(payload: Record<string, unknown>): boolean {
  const onboardingFlag = payload.onboarding;
  const isNewPlayer = payload.isNewPlayer;
  const tutorialStep = payload.tutorialStep;

  if (onboardingFlag === true || isNewPlayer === true) {
    return true;
  }
  if (typeof tutorialStep === "number") {
    return tutorialStep <= 1;
  }
  return true;
}

function resolveStageIdFromPayload(payload: Record<string, unknown>): ReportStageId | undefined {
  return normalizeStageId(toNonEmptyString(payload.stageId));
}

function normalizeStageId(value?: string): ReportStageId | undefined {
  if (!value) {
    return undefined;
  }
  return REPORT_STAGE_DEFINITIONS.find((stage) => stage.id === value)?.id;
}

function highestStageId(participant: OnboardingParticipant): ReportStageId | undefined {
  return participant.highestStageIndex >= 0 ? REPORT_STAGE_DEFINITIONS[participant.highestStageIndex].id : undefined;
}

function applyPostTutorialStageMarkers(
  participant: OnboardingParticipant,
  eventName: string | undefined,
  payload: Record<string, unknown>,
  at?: string,
  explicitStageId?: ReportStageId
): void {
  const stageId = explicitStageId ?? resolveStageIdFromPayload(payload);
  if (stageId) {
    markStage(participant, stageId, at, stageId === "onboarding_completed" ? { inferPreviousStages: true } : undefined);
  }

  if (
    eventName === "mission_complete" &&
    participant.stageTimes.onboarding_completed &&
    !participant.stageTimes.first_campaign_mission_started
  ) {
    const chapterId = toNonEmptyString(payload.chapterId);
    if (chapterId === "chapter1") {
      markStage(participant, "first_campaign_mission_started", at, { inferPreviousStages: true });
    }
  }

  if (
    eventName === "battle_end" &&
    participant.stageTimes.first_campaign_mission_started &&
    !participant.stageTimes.first_battle_settled
  ) {
    markStage(participant, "first_battle_settled", at, { inferPreviousStages: true });
  }

  if (
    eventName === "quest_complete" &&
    participant.stageTimes.first_battle_settled &&
    !participant.stageTimes.first_reward_claimed
  ) {
    markStage(participant, "first_reward_claimed", at, { inferPreviousStages: true });
  }
}

function roundRate(value: number): number {
  return Number.isFinite(value) ? Number.parseFloat(value.toFixed(4)) : 0;
}

function calculateMedianCompletionSeconds(participants: OnboardingParticipant[]): number | null {
  const completedDurations = participants
    .map((participant) => {
      const startedAt = participant.stageTimes.onboarding_session_started ?? participant.firstObservedAt;
      const completedAt = getFullChainCompletionAt(participant);
      if (!startedAt || !completedAt) {
        return null;
      }
      const durationSeconds = Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000);
      return durationSeconds >= 0 ? durationSeconds : null;
    })
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right);

  if (completedDurations.length === 0) {
    return null;
  }

  const middle = Math.floor(completedDurations.length / 2);
  if (completedDurations.length % 2 === 1) {
    return completedDurations[middle];
  }
  return Math.round((completedDurations[middle - 1] + completedDurations[middle]) / 2);
}

function summarizeFailureReasons(participants: OnboardingParticipant[]): FailureReasonSummary[] {
  const failures = new Map<string, { count: number; players: Set<string>; stageIds: Set<string> }>();

  for (const participant of participants) {
    for (const failure of participant.failureReasons) {
      const entry = failures.get(failure.reason) ?? {
        count: 0,
        players: new Set<string>(),
        stageIds: new Set<string>()
      };
      entry.count += 1;
      entry.players.add(participant.playerId);
      if (failure.stageId) {
        entry.stageIds.add(failure.stageId);
      }
      failures.set(failure.reason, entry);
    }
  }

  return [...failures.entries()]
    .map(([reason, value]) => ({
      reason,
      count: value.count,
      playerCount: value.players.size,
      stageIds: [...value.stageIds].sort()
    }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason))
    .slice(0, 5);
}

function buildReport(args: Args, inputPaths: string[], diagnosticsPaths: string[], participantsMap: Map<string, OnboardingParticipant>): OnboardingFunnelReport {
  const participants = [...participantsMap.values()].sort((left, right) => left.playerId.localeCompare(right.playerId));
  const entrants = participants.length;
  const completed = participants.filter((participant) => Boolean(getFullChainCompletionAt(participant))).length;
  const completionRate = entrants > 0 ? roundRate(completed / entrants) : 0;
  const medianCompletionSeconds = calculateMedianCompletionSeconds(participants);
  const stageReports = REPORT_STAGE_DEFINITIONS.map((stage, index) => {
    const reachedCount = participants.filter((participant) => participant.highestStageIndex >= index).length;
    const previousReachedCount = index === 0 ? entrants : participants.filter((participant) => participant.highestStageIndex >= index - 1).length;
    const dropOffCount = index === 0 ? 0 : Math.max(0, previousReachedCount - reachedCount);
    return {
      id: stage.id,
      label: stage.label,
      successCriteria: stage.successCriteria,
      evidenceNotes: stage.evidenceNotes,
      reachedCount,
      reachedRate: entrants > 0 ? roundRate(reachedCount / entrants) : 0,
      dropOffCount,
      dropOffRateFromPrevious:
        index === 0 || previousReachedCount === 0 ? null : roundRate(dropOffCount / previousReachedCount)
    } satisfies StageReport;
  });

  const regressions: string[] = [];
  if (completionRate < args.completionRateThreshold) {
    regressions.push(
      `completion_rate_below_threshold:${completionRate} < ${args.completionRateThreshold}`
    );
  }
  if (medianCompletionSeconds != null && medianCompletionSeconds > args.medianCompletionSecondsThreshold) {
    regressions.push(
      `median_completion_time_above_threshold:${medianCompletionSeconds}s > ${args.medianCompletionSecondsThreshold}s`
    );
  }
  for (const stage of stageReports) {
    if (stage.dropOffRateFromPrevious != null && stage.dropOffRateFromPrevious > args.stageDropOffRateThreshold) {
      regressions.push(
        `stage_dropoff_above_threshold:${stage.id}:${stage.dropOffRateFromPrevious} > ${args.stageDropOffRateThreshold}`
      );
    }
  }

  const topFailureReasons = summarizeFailureReasons(participants);
  const entrantsWithFailureEvidence = participants.filter((participant) => participant.failureReasons.length > 0).length;
  const focusStages = POST_TUTORIAL_FOCUS_STAGE_IDS.map((stageId) => {
    const stage = stageReports.find((entry) => entry.id === stageId);
    if (!stage) {
      throw new Error(`Missing focus stage definition: ${stageId}`);
    }
    return stage;
  });
  const focusNarrative = buildFocusNarrative(entrants, focusStages);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      entrants,
      completed,
      completionRate,
      medianCompletionSeconds,
      medianCompletionMinutes:
        medianCompletionSeconds == null ? null : Number.parseFloat((medianCompletionSeconds / 60).toFixed(2))
    },
    thresholds: {
      completionRate: args.completionRateThreshold,
      medianCompletionSeconds: args.medianCompletionSecondsThreshold,
      stageDropOffRate: args.stageDropOffRateThreshold
    },
    regressions,
    observability: {
      inputCount: inputPaths.length,
      diagnosticsCount: diagnosticsPaths.length,
      entrantsWithFailureEvidence,
      entrantsWithoutFailureEvidence: Math.max(0, entrants - entrantsWithFailureEvidence)
    },
    inputs: {
      inputPaths,
      diagnosticsPaths
    },
    canonicalStages: [...ONBOARDING_FUNNEL_STAGES],
    stageReports,
    pmSummary: {
      focusChainLabel: "Tutorial Completed -> First Campaign Mission Started -> First Battle Settled -> First Reward Claimed",
      focusStages: focusStages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        reachedCount: stage.reachedCount,
        dropOffCount: stage.dropOffCount,
        dropOffRateFromPrevious: stage.dropOffRateFromPrevious
      })),
      narrative: focusNarrative
    },
    topFailureReasons,
    participants: participants.map((participant) => ({
      playerId: participant.playerId,
      firstObservedAt: participant.firstObservedAt,
      highestStageId: highestStageId(participant),
      completed: Boolean(getFullChainCompletionAt(participant)),
      failureReasons: [...new Set(participant.failureReasons.map((failure) => failure.reason))].sort()
    }))
  };
}

function renderMarkdown(report: OnboardingFunnelReport): string {
  const lines: string[] = [];
  lines.push("# Onboarding Funnel Dashboard");
  lines.push("");
  lines.push(`Generated at \`${report.generatedAt}\`.`);
  lines.push("");
  lines.push("## PM Summary");
  lines.push("");
  lines.push(`Focus chain: ${report.pmSummary.focusChainLabel}`);
  for (const line of report.pmSummary.narrative) {
    lines.push(`- ${line}`);
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Entrants: ${report.summary.entrants}`);
  lines.push(`- Completed: ${report.summary.completed}`);
  lines.push(`- Completion rate: ${formatPercent(report.summary.completionRate)}`);
  lines.push(
    `- Median completion time: ${report.summary.medianCompletionSeconds == null ? "n/a" : `${report.summary.medianCompletionSeconds}s (${report.summary.medianCompletionMinutes} min)`}`
  );
  lines.push(
    `- Failure reason coverage: ${report.observability.entrantsWithFailureEvidence}/${report.summary.entrants} entrants carried explicit failure evidence`
  );
  lines.push("");
  lines.push("## Canonical Stages");
  lines.push("");
  for (const stage of report.canonicalStages) {
    lines.push(`- \`${stage.id}\` ${stage.label}: ${stage.successCriteria}`);
    lines.push(`  Evidence: ${stage.evidenceNotes}`);
  }
  lines.push("");
  lines.push("## Focus Chain");
  lines.push("");
  for (const stage of report.pmSummary.focusStages) {
    lines.push(
      `- \`${stage.id}\` reached=${stage.reachedCount}, dropOff=${stage.dropOffCount}${
        stage.dropOffRateFromPrevious == null ? "" : ` (${formatPercent(stage.dropOffRateFromPrevious)} from previous stage)`
      }`
    );
  }
  lines.push("");
  lines.push("## Stage Drop-Off");
  lines.push("");
  for (const stage of report.stageReports) {
    lines.push(
      `- \`${stage.id}\` reached=${stage.reachedCount} (${formatPercent(stage.reachedRate)}), dropOff=${stage.dropOffCount}${
        stage.dropOffRateFromPrevious == null ? "" : ` (${formatPercent(stage.dropOffRateFromPrevious)} from previous stage)`
      }`
    );
  }
  lines.push("");
  lines.push("## Top Failure Reasons");
  lines.push("");
  if (report.topFailureReasons.length === 0) {
    lines.push("- No explicit failure reasons were present in the supplied evidence.");
  } else {
    for (const failure of report.topFailureReasons) {
      lines.push(
        `- \`${failure.reason}\` count=${failure.count}, players=${failure.playerCount}, stages=${
          failure.stageIds.length > 0 ? failure.stageIds.map((stageId) => `\`${stageId}\``).join(", ") : "unattributed"
        }`
      );
    }
  }
  lines.push("");
  lines.push("## Regression Flags");
  lines.push("");
  if (report.regressions.length === 0) {
    lines.push("- No default regression thresholds were exceeded.");
  } else {
    for (const regression of report.regressions) {
      lines.push(`- ${regression}`);
    }
  }
  lines.push("");
  lines.push("## Reading Guide");
  lines.push("");
  lines.push("- Start with completion rate and median completion time for overall onboarding health.");
  lines.push("- Then inspect the PM summary focus chain to see where the tutorial-to-reward handoff leaks.");
  lines.push("- After that, inspect the first stage with a large drop-off count or drop-off rate.");
  lines.push("- Use the failure reasons section only when explicit diagnostics were present; missing reasons mean the evidence did not explain abandonment.");
  return `${lines.join("\n")}\n`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function getFullChainCompletionAt(participant: OnboardingParticipant): string | undefined {
  return participant.stageTimes.first_reward_claimed;
}

function buildFocusNarrative(entrants: number, focusStages: Array<{ id: ReportStageId; label: string; reachedCount: number; dropOffCount: number }>): string[] {
  if (focusStages.length === 0) {
    return ["No post-tutorial focus stages were configured."];
  }

  const [tutorialCompleted, firstCampaignMissionStarted, firstBattleSettled, firstRewardClaimed] = focusStages;
  const fullChainReached = firstRewardClaimed?.reachedCount ?? 0;

  return [
    `Tutorial completion to first reward claim: ${fullChainReached}/${entrants} entrants reached the full post-tutorial chain.`,
    `Stage reach counts: ${tutorialCompleted.label} ${tutorialCompleted.reachedCount}, ${firstCampaignMissionStarted.label} ${firstCampaignMissionStarted.reachedCount}, ${firstBattleSettled.label} ${firstBattleSettled.reachedCount}, ${firstRewardClaimed.label} ${firstRewardClaimed.reachedCount}.`,
    `Drop-off sequence: ${firstCampaignMissionStarted.dropOffCount} before ${firstCampaignMissionStarted.label}, ${firstBattleSettled.dropOffCount} before ${firstBattleSettled.label}, ${firstRewardClaimed.dropOffCount} before ${firstRewardClaimed.label}.`
  ];
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inputPaths = [...new Set(args.inputPaths.flatMap((inputPath) => collectJsonPaths(inputPath)))];
  const diagnosticsPaths = [...new Set(args.diagnosticsPaths.flatMap((inputPath) => collectJsonPaths(inputPath)))];

  const events = inputPaths.flatMap((filePath) => extractAnalyticsEvents(readJson(filePath)));
  const diagnosticFailures = diagnosticsPaths.flatMap((filePath) => extractDiagnosticFailures(readJson(filePath)));
  const participants = collectParticipants(events, diagnosticFailures);
  const report = buildReport(args, inputPaths, diagnosticsPaths, participants);

  const outputPath = path.resolve(args.outputPath ?? path.join(DEFAULT_OUTPUT_DIR, "onboarding-funnel-report.json"));
  const markdownOutputPath = path.resolve(
    args.markdownOutputPath ?? path.join(DEFAULT_OUTPUT_DIR, "onboarding-funnel-report.md")
  );
  ensureParentDir(outputPath);
  ensureParentDir(markdownOutputPath);
  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(markdownOutputPath, renderMarkdown(report), "utf8");

  console.log(`Wrote onboarding funnel JSON report: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`Wrote onboarding funnel Markdown report: ${path.relative(process.cwd(), markdownOutputPath).replace(/\\/g, "/")}`);
  console.log(`Completion rate: ${formatPercent(report.summary.completionRate)}`);
  console.log(
    `Median completion time: ${
      report.summary.medianCompletionSeconds == null ? "n/a" : `${report.summary.medianCompletionSeconds}s`
    }`
  );
}

main();
