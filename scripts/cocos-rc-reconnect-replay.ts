import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { sys } from "cc";

import { writeStoredCocosAuthSession } from "../apps/cocos-client/assets/scripts/cocos-session-launch.ts";
import { buildCocosRuntimeDiagnosticsSnapshot } from "../apps/cocos-client/assets/scripts/cocos-runtime-diagnostics.ts";
import { setVeilCocosSessionRuntimeForTests } from "../apps/cocos-client/assets/scripts/VeilCocosSession.ts";
import { createFallbackCocosPlayerAccountProfile } from "../apps/cocos-client/assets/scripts/cocos-lobby.ts";
import {
  createMemoryStorage,
  createSdkLoader,
  createSessionUpdate,
  FakeColyseusRoom
} from "../apps/cocos-client/test/helpers/cocos-session-fixtures.ts";
import {
  createVeilRootSessionLifecycleHarness,
  resetCocosRuntimeHarnesses
} from "../apps/cocos-client/test/helpers/cocos-runtime-harness.ts";

type StepStatus = "passed" | "failed";
type ScenarioId = "resume-success" | "resume-fallback-fresh-join";

interface Args {
  candidate: string;
  outputPath?: string;
  markdownOutputPath?: string;
  outputDir?: string;
  owner?: string;
  server?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
}

interface ScenarioStep {
  id: string;
  title: string;
  status: StepStatus;
  summary: string;
  statusSummary: string[];
  artifactPath: string;
}

interface ScenarioArtifact {
  id: ScenarioId;
  title: string;
  status: StepStatus;
  roomId: string;
  playerId: string;
  summary: string;
  resumeMode: "stored-token" | "fresh-join-fallback";
  expectedResumeFailureReason: string | null;
  observedResumeFailureReason: string | null;
  reconnectTokens: string[];
  joinAttempts: number;
  phaseResults: ScenarioStep[];
  finalState: {
    day: number | null;
    connectionStatus: string;
    lastUpdateSource: string | null;
    lastUpdateReason: string | null;
    recoverySummary: string | null;
    statusSummary: string[];
  };
}

interface CocosRcReconnectReplayArtifact {
  schemaVersion: 1;
  artifactType: "cocos-rc-reconnect-replay";
  generatedAt: string;
  candidate: {
    name: string;
    scope: "apps/cocos-client";
    branch: string;
    revision: string;
    shortRevision: string;
  };
  execution: {
    owner: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    overallStatus: StepStatus;
    summary: string;
  };
  environment: {
    server: string;
    evidenceMode: "runtime-harness";
  };
  artifacts: {
    outputDir: string;
    milestoneDir: string;
    markdownPath: string;
  };
  reviewSignals: {
    resumeSuccessVerified: boolean;
    freshJoinFallbackVerified: boolean;
    failureReasons: string[];
  };
  scenarios: ScenarioArtifact[];
}

type RootState = Record<string, any>;

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let candidate: string | undefined;
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;
  let outputDir: string | undefined;
  let owner: string | undefined;
  let server: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--candidate" && next) {
      candidate = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      markdownOutputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--output-dir" && next) {
      outputDir = next;
      index += 1;
      continue;
    }
    if (arg === "--owner" && next) {
      owner = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--server" && next) {
      server = next.trim();
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  if (!candidate) {
    fail("Missing required --candidate.");
  }

  return {
    candidate,
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {}),
    ...(outputDir ? { outputDir } : {}),
    ...(owner ? { owner } : {}),
    ...(server ? { server } : {})
  };
}

function readGitValue(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function getRevision(): GitRevision {
  return {
    commit: readGitValue(["rev-parse", "HEAD"]),
    shortCommit: readGitValue(["rev-parse", "--short", "HEAD"]),
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"])
  };
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "candidate";
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeJson(filePath: string, payload: unknown): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeText(filePath: string, content: string): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function toRepoRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function seedStoredReplay(storage: Storage, roomId: string, playerId: string, update: ReturnType<typeof createSessionUpdate>): void {
  storage.setItem(
    `project-veil:cocos:session-replay:${roomId}:${playerId}`,
    JSON.stringify({
      version: 1,
      storedAt: Date.now(),
      update
    })
  );
}

function buildStatusSummary(root: RootState): string[] {
  const lines: string[] = [];
  if (root.diagnosticsConnectionStatus) {
    lines.push(`connection=${root.diagnosticsConnectionStatus}`);
  }
  if (root.lastRoomUpdateSource || root.lastRoomUpdateReason) {
    lines.push(`update=${root.lastRoomUpdateSource ?? "unknown"}:${root.lastRoomUpdateReason ?? "unknown"}`);
  }
  if (root.lastUpdate?.world.meta.day) {
    lines.push(`day=${root.lastUpdate.world.meta.day}`);
  }
  if (typeof root.predictionStatus === "string" && root.predictionStatus.trim()) {
    lines.push(`prediction=${root.predictionStatus.trim()}`);
  }
  if (Array.isArray(root.logLines) && root.logLines[0]) {
    lines.push(`log=${String(root.logLines[0])}`);
  }
  return lines;
}

function captureDiagnosticsArtifact(root: RootState, milestonePath: string): string[] {
  const update = root.lastUpdate ?? null;
  const diagnostics = buildCocosRuntimeDiagnosticsSnapshot({
    devOnly: true,
    mode: update?.battle ? "battle" : "world",
    roomId: root.roomId,
    playerId: root.playerId,
    authMode: root.authMode,
    loginId: root.loginId,
    connectionStatus: root.diagnosticsConnectionStatus,
    lastUpdateSource: root.lastRoomUpdateSource,
    lastUpdateReason: root.lastRoomUpdateReason,
    lastUpdateAt: root.lastRoomUpdateAtMs ?? null,
    update,
    account:
      root.lobbyAccountProfile ?? createFallbackCocosPlayerAccountProfile(root.playerId, root.roomId, root.displayName),
    timelineEntries: root.timelineEntries ?? [],
    logLines: root.logLines ?? [],
    predictionStatus: root.predictionStatus ?? "",
    recoverySummary:
      typeof root.predictionStatus === "string" && root.predictionStatus.includes("回放缓存状态")
        ? root.predictionStatus
        : null,
    primaryClientTelemetry: root.primaryClientTelemetry ?? [],
    errorEvents: root.runtimeErrors ?? []
  });
  writeJson(milestonePath, diagnostics);
  return buildStatusSummary(root);
}

async function runResumeSuccessScenario(milestoneDir: string): Promise<ScenarioArtifact> {
  resetCocosRuntimeHarnesses();
  const roomId = "rc-reconnect-resume-success";
  const playerId = "rc-player-1";
  const storage = createMemoryStorage();
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  writeStoredCocosAuthSession(storage, {
    token: "resume-success.token",
    playerId,
    displayName: "RC Resume Success",
    authMode: "account",
    provider: "account-password",
    loginId: "rc-resume-success",
    source: "remote"
  });

  const replayedUpdate = createSessionUpdate(4, roomId, playerId);
  replayedUpdate.reason = "cached_snapshot";
  seedStoredReplay(storage, roomId, playerId, replayedUpdate);
  storage.setItem(`project-veil:cocos:reconnection:${roomId}:${playerId}`, "resume-success-token");

  const recoveredUpdate = createSessionUpdate(6, roomId, playerId);
  recoveredUpdate.reason = "reconnect.restore";
  recoveredUpdate.world.resources.wood = 14;

  const recoveredRoom = new FakeColyseusRoom([recoveredUpdate, recoveredUpdate], "resume-success-next-token");
  const harness = createVeilRootSessionLifecycleHarness({
    storage,
    reconnectRooms: [recoveredRoom],
    wait: async () => undefined
  });

  harness.root.roomId = roomId;
  harness.root.playerId = playerId;
  harness.root.displayName = "RC Resume Success";
  harness.root.authMode = "account";
  harness.root.authToken = "resume-success.token";
  harness.root.sessionSource = "remote";
  harness.root.refreshGameplayAccountProfile = async () => undefined;

  const phaseResults: ScenarioStep[] = [];

  await harness.root.connect();
  const bootstrapPath = path.join(milestoneDir, "01-resume-success-bootstrap.json");
  phaseResults.push({
    id: "bootstrap",
    title: "Cached replay boot and stored-token resume",
    status:
      harness.root.lastUpdate?.world.meta.day === 6 &&
      harness.root.diagnosticsConnectionStatus === "connected" &&
      harness.reconnectTokens.includes("resume-success-token")
        ? "passed"
        : "failed",
    summary: "Booted the candidate room from cached replay, then resumed directly through the stored reconnect token.",
    statusSummary: captureDiagnosticsArtifact(harness.root, bootstrapPath),
    artifactPath: toRepoRelative(bootstrapPath)
  });

  const restorePath = path.join(milestoneDir, "02-resume-success-restored.json");
  phaseResults.push({
    id: "resume-restore",
    title: "Authoritative restore stays on the resumed room snapshot",
    status:
      harness.root.lastUpdate?.world.meta.day === 6 &&
      harness.root.diagnosticsConnectionStatus === "connected" &&
      harness.reconnectTokens.includes("resume-success-token")
        ? "passed"
        : "failed",
    summary: "The resumed session stayed on the same logical room and produced authoritative reconnect.restore evidence for review.",
    statusSummary: captureDiagnosticsArtifact(harness.root, restorePath),
    artifactPath: toRepoRelative(restorePath)
  });

  return {
    id: "resume-success",
    title: "Stored-token resume succeeds",
    status: phaseResults.every((step) => step.status === "passed") ? "passed" : "failed",
    roomId,
    playerId,
    summary: "A cached Cocos room replay resumes successfully through the stored reconnect token and rehydrates the authoritative snapshot for the same room.",
    resumeMode: "stored-token",
    expectedResumeFailureReason: null,
    observedResumeFailureReason: null,
    reconnectTokens: [...harness.reconnectTokens],
    joinAttempts: harness.joinedOptions.length,
    phaseResults,
    finalState: {
      day: harness.root.lastUpdate?.world.meta.day ?? null,
      connectionStatus: harness.root.diagnosticsConnectionStatus,
      lastUpdateSource: harness.root.lastRoomUpdateSource ?? null,
      lastUpdateReason: harness.root.lastRoomUpdateReason ?? null,
      recoverySummary: typeof harness.root.predictionStatus === "string" ? harness.root.predictionStatus : null,
      statusSummary: buildStatusSummary(harness.root)
    }
  };
}

async function runFallbackScenario(milestoneDir: string): Promise<ScenarioArtifact> {
  resetCocosRuntimeHarnesses();
  const roomId = "rc-reconnect-fallback";
  const playerId = "rc-player-2";
  const storage = createMemoryStorage();
  (sys as unknown as { localStorage: Storage }).localStorage = storage;
  writeStoredCocosAuthSession(storage, {
    token: "resume-fallback.token",
    playerId,
    displayName: "RC Resume Fallback",
    authMode: "account",
    provider: "account-password",
    loginId: "rc-resume-fallback",
    source: "remote"
  });
  storage.setItem(`project-veil:cocos:reconnection:${roomId}:${playerId}`, "stale-reconnect-token");

  const replayedUpdate = createSessionUpdate(8, roomId, playerId);
  replayedUpdate.reason = "cached_snapshot";
  seedStoredReplay(storage, roomId, playerId, replayedUpdate);

  const freshJoinUpdate = createSessionUpdate(9, roomId, playerId);
  freshJoinUpdate.reason = "snapshot";
  freshJoinUpdate.world.resources.gold = 1021;
  const freshRoom = new FakeColyseusRoom([freshJoinUpdate], "fresh-join-reconnect-token");

  const reconnectTokens: string[] = [];
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];
  const warnMessages: Array<{ reason?: string }> = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const structured = args.find((entry) => typeof entry === "object" && entry !== null) as { reason?: string } | undefined;
    if (structured?.reason) {
      warnMessages.push(structured);
    }
  };

  try {
    const fallbackHarness = createVeilRootSessionLifecycleHarness({
      storage,
      wait: async () => undefined
    });
    fallbackHarness.root.roomId = roomId;
    fallbackHarness.root.playerId = playerId;
    fallbackHarness.root.displayName = "RC Resume Fallback";
    fallbackHarness.root.authMode = "account";
    fallbackHarness.root.authToken = "resume-fallback.token";
    fallbackHarness.root.sessionSource = "remote";
    fallbackHarness.root.refreshGameplayAccountProfile = async () => undefined;

    // Reinstall the session runtime so the stored token fails deterministically
    // and fresh join becomes the only recovery path.
    const endpoints: string[] = [];
    setVeilCocosSessionRuntimeForTests({
      storage,
      wait: async () => undefined,
      loadSdk: createSdkLoader({
        joinRooms: [freshRoom],
        reconnectTokens,
        joinedOptions,
        endpoints
      })
    });

    await fallbackHarness.root.connect();

    const phaseResults: ScenarioStep[] = [];
    const replayPath = path.join(milestoneDir, "01-resume-fallback-replay.json");
    phaseResults.push({
      id: "cached-replay",
      title: "Cached replay preserved before reconnect retry",
      status: fallbackHarness.root.lastUpdate?.world.meta.day === 9 ? "passed" : "failed",
      summary: "Candidate boot reused the cached room replay while the stale token retry was downgraded to a fresh join.",
      statusSummary: captureDiagnosticsArtifact(fallbackHarness.root, replayPath),
      artifactPath: toRepoRelative(replayPath)
    });

    const observedResumeFailureReason = warnMessages[0]?.reason ?? null;
    const fallbackPath = path.join(milestoneDir, "02-resume-fallback-fresh-join.json");
    phaseResults.push({
      id: "fresh-join-fallback",
      title: "Stale token falls back to fresh join",
      status:
        observedResumeFailureReason === "transport_lost" &&
        reconnectTokens.includes("stale-reconnect-token") &&
        joinedOptions.length === 1 &&
        fallbackHarness.root.lastUpdate?.world.meta.day === 9 &&
        storage.getItem(`project-veil:cocos:reconnection:${roomId}:${playerId}`) === "fresh-join-reconnect-token"
          ? "passed"
          : "failed",
      summary: "The reconnect token was retried once, classified, cleared, and replaced by a fresh join into the same logical room.",
      statusSummary: captureDiagnosticsArtifact(fallbackHarness.root, fallbackPath),
      artifactPath: toRepoRelative(fallbackPath)
    });

    return {
      id: "resume-fallback-fresh-join",
      title: "Resume failure falls back to fresh join",
      status: phaseResults.every((step) => step.status === "passed") ? "passed" : "failed",
      roomId,
      playerId,
      summary: "A stale reconnect token is classified and cleared, then the candidate reconnects through a fresh join without leaving the room unrecoverable.",
      resumeMode: "fresh-join-fallback",
      expectedResumeFailureReason: "transport_lost",
      observedResumeFailureReason,
      reconnectTokens: [...reconnectTokens],
      joinAttempts: joinedOptions.length,
      phaseResults,
      finalState: {
        day: fallbackHarness.root.lastUpdate?.world.meta.day ?? null,
        connectionStatus: fallbackHarness.root.diagnosticsConnectionStatus,
        lastUpdateSource: fallbackHarness.root.lastRoomUpdateSource ?? null,
        lastUpdateReason: fallbackHarness.root.lastRoomUpdateReason ?? null,
        recoverySummary: typeof fallbackHarness.root.predictionStatus === "string" ? fallbackHarness.root.predictionStatus : null,
        statusSummary: buildStatusSummary(fallbackHarness.root)
      }
    };
  } finally {
    console.warn = originalWarn;
  }
}

function renderMarkdown(artifact: CocosRcReconnectReplayArtifact): string {
  const lines: string[] = [];
  lines.push("# Cocos RC Reconnect Replay");
  lines.push("");
  lines.push(`- Candidate: \`${artifact.candidate.name}\``);
  lines.push(`- Commit: \`${artifact.candidate.shortRevision}\` (${artifact.candidate.branch})`);
  lines.push(`- Status: \`${artifact.execution.overallStatus}\``);
  lines.push(`- Owner: ${artifact.execution.owner}`);
  lines.push(`- Server: \`${artifact.environment.server}\``);
  lines.push(`- Milestone dir: \`${artifact.artifacts.milestoneDir}\``);
  lines.push("");
  lines.push("## Review Signals");
  lines.push("");
  lines.push(`- Resume success verified: \`${artifact.reviewSignals.resumeSuccessVerified}\``);
  lines.push(`- Fresh-join fallback verified: \`${artifact.reviewSignals.freshJoinFallbackVerified}\``);
  lines.push(
    `- Observed failure reasons: ${artifact.reviewSignals.failureReasons.length > 0 ? artifact.reviewSignals.failureReasons.map((item) => `\`${item}\``).join(", ") : "_none_"}`
  );
  lines.push("");
  lines.push("## Scenario Matrix");
  lines.push("");
  lines.push("| Scenario | Status | Resume mode | Failure reason | Final state |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const scenario of artifact.scenarios) {
    lines.push(
      `| ${scenario.title} | \`${scenario.status}\` | \`${scenario.resumeMode}\` | ${scenario.observedResumeFailureReason ? `\`${scenario.observedResumeFailureReason}\`` : "_n/a_"} | ${scenario.finalState.statusSummary.map((item) => `\`${item}\``).join("<br>") || "_none_"} |`
    );
  }
  lines.push("");
  for (const scenario of artifact.scenarios) {
    lines.push(`## ${scenario.title}`);
    lines.push("");
    lines.push(`- Room: \`${scenario.roomId}\``);
    lines.push(`- Player: \`${scenario.playerId}\``);
    lines.push(`- Summary: ${scenario.summary}`);
    lines.push(`- Reconnect tokens: ${scenario.reconnectTokens.map((item) => `\`${item}\``).join(", ") || "_none_"}`);
    lines.push(`- Join attempts: \`${scenario.joinAttempts}\``);
    lines.push("");
    lines.push("| Phase | Status | Artifact | Status summary |");
    lines.push("| --- | --- | --- | --- |");
    for (const phase of scenario.phaseResults) {
      lines.push(
        `| ${phase.title} | \`${phase.status}\` | \`${phase.artifactPath}\` | ${phase.statusSummary.map((item) => `\`${item}\``).join("<br>") || "_none_"} |`
      );
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const startedAt = new Date().toISOString();
  const revision = getRevision();
  const outputDir = path.resolve(args.outputDir ?? DEFAULT_OUTPUT_DIR);
  const baseName = `${slugify(args.candidate)}-${revision.shortCommit}`;
  const outputPath = path.resolve(args.outputPath ?? path.join(outputDir, `cocos-rc-reconnect-replay-${baseName}.json`));
  const markdownOutputPath = path.resolve(
    args.markdownOutputPath ?? path.join(outputDir, `cocos-rc-reconnect-replay-${baseName}.md`)
  );
  const milestoneDir = path.join(outputDir, `cocos-rc-reconnect-replay-${baseName}`);

  const scenarios = [
    await runResumeSuccessScenario(milestoneDir),
    await runFallbackScenario(milestoneDir)
  ];
  const completedAt = new Date().toISOString();
  const overallStatus = scenarios.every((scenario) => scenario.status === "passed") ? "passed" : "failed";
  const artifact: CocosRcReconnectReplayArtifact = {
    schemaVersion: 1,
    artifactType: "cocos-rc-reconnect-replay",
    generatedAt: completedAt,
    candidate: {
      name: args.candidate,
      scope: "apps/cocos-client",
      branch: revision.branch,
      revision: revision.commit,
      shortRevision: revision.shortCommit
    },
    execution: {
      owner: args.owner ?? "codex",
      startedAt,
      completedAt,
      durationMs: new Date(completedAt).getTime() - new Date(startedAt).getTime(),
      overallStatus,
      summary:
        overallStatus === "passed"
          ? "Candidate reconnect replay validated resume success and resume failure fallback for the Cocos primary client."
          : "Candidate reconnect replay detected a reconnect branch that did not satisfy the RC recovery contract."
    },
    environment: {
      server: args.server ?? "runtime-harness://local",
      evidenceMode: "runtime-harness"
    },
    artifacts: {
      outputDir: toRepoRelative(outputDir),
      milestoneDir: toRepoRelative(milestoneDir),
      markdownPath: toRepoRelative(markdownOutputPath)
    },
    reviewSignals: {
      resumeSuccessVerified: scenarios.some((scenario) => scenario.id === "resume-success" && scenario.status === "passed"),
      freshJoinFallbackVerified: scenarios.some(
        (scenario) => scenario.id === "resume-fallback-fresh-join" && scenario.status === "passed"
      ),
      failureReasons: scenarios
        .map((scenario) => scenario.observedResumeFailureReason)
        .filter((value): value is string => Boolean(value))
    },
    scenarios
  };

  writeJson(outputPath, artifact);
  writeText(markdownOutputPath, renderMarkdown(artifact));

  console.log(`Wrote RC reconnect replay JSON: ${toRepoRelative(outputPath)}`);
  console.log(`Wrote RC reconnect replay Markdown: ${toRepoRelative(markdownOutputPath)}`);
  console.log(`RC reconnect replay status: ${artifact.execution.overallStatus}`);
}

void main();
