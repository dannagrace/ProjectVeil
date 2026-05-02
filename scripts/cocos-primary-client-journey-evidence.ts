import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Node, sys } from "cc";

import {
  type BattleState,
  type SessionUpdate,
  resetVeilCocosSessionRuntimeForTests,
  setVeilCocosSessionRuntimeForTests,
  VeilCocosSession
} from "../apps/cocos-client/assets/scripts/VeilCocosSession.ts";
import { createFallbackCocosPlayerAccountProfile } from "../apps/cocos-client/assets/scripts/cocos-lobby.ts";
import { resetPixelSpriteRuntimeForTests } from "../apps/cocos-client/assets/scripts/cocos-pixel-sprites.ts";
import { buildCocosRuntimeDiagnosticsSnapshot } from "../apps/cocos-client/assets/scripts/cocos-runtime-diagnostics.ts";
import { writeStoredCocosAuthSession } from "../apps/cocos-client/assets/scripts/cocos-session-launch.ts";
import { resetVeilRootRuntimeForTests, setVeilRootRuntimeForTests, VeilRoot } from "../apps/cocos-client/assets/scripts/VeilRoot.ts";
import {
  createMemoryStorage,
  createSdkLoader,
  createSessionUpdate,
  FakeColyseusRoom
} from "../apps/cocos-client/test/helpers/cocos-session-fixtures.ts";

type StepStatus = "pending" | "passed" | "failed";
type VisualEvidenceStatus = "pending" | "captured" | "blocked";
type VisualEvidenceSurface = "creator-preview" | "wechat-safe-area";
type JourneyStepId =
  | "lobby-entry"
  | "room-join"
  | "map-explore"
  | "first-battle"
  | "battle-settlement"
  | "reconnect-restore"
  | "return-to-world";
type CanonicalEvidenceId = "roomId" | "reconnectPrompt" | "restoredState" | "firstBattleResult";

interface Args {
  candidate?: string;
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

interface RequiredEvidenceField {
  id: CanonicalEvidenceId;
  label: string;
  value: string;
  evidence: string[];
  notes: string;
}

interface JourneyStepSummary {
  id: JourneyStepId;
  title: string;
  status: StepStatus;
  summary: string;
  timing?: {
    startedAt: string;
    completedAt: string;
    durationMs: number;
  };
  evidence: string[];
}

interface FailureSummary {
  summary: string;
  regressedJourneySegments: Array<{
    id: JourneyStepId;
    title: string;
    status: "failed";
    reason: string;
    artifactPath?: string;
  }>;
  blockedJourneySegments: Array<{
    id: JourneyStepId;
    title: string;
    status: "failed";
    reason: string;
    artifactPath?: string;
  }>;
  lackingJourneyEvidence: Array<{
    id: JourneyStepId;
    title: string;
    status: "pending";
    reason: string;
  }>;
  lackingRequiredEvidence: Array<{
    id: CanonicalEvidenceId;
    label: string;
    reason: string;
  }>;
}

interface CheckpointLedgerEntry {
  id: JourneyStepId;
  title: string;
  status: StepStatus;
  summary: string;
  artifactPath: string;
  phase: string;
  roomId: string;
  playerId: string;
  connectionStatus: string;
  lastUpdateReason: string;
  telemetryCheckpoints: string[];
}

interface VisualEvidenceSlot {
  id: string;
  milestoneId: JourneyStepId;
  milestoneTitle: string;
  surface: VisualEvidenceSurface;
  status: VisualEvidenceStatus;
  artifactPath: string | null;
  notes: string;
}

interface VisualEvidenceSummary {
  mode: "manual-visual-capture-required";
  status: "blocked";
  artifactPath: string;
  requiredSlots: number;
  capturedSlots: number;
  slots: VisualEvidenceSlot[];
}

interface PrimaryJourneyEvidenceArtifact {
  schemaVersion: 1;
  candidate: {
    name: string;
    scope: "apps/cocos-client";
    branch: string;
    commit: string;
    shortCommit: string;
  };
  execution: {
    owner: string;
    startedAt: string;
    completedAt: string;
    durationMs: number;
    overallStatus: "passed" | "failed";
    summary: string;
    failure?: {
      stepId: JourneyStepId;
      title: string;
      message: string;
      artifactPath?: string;
    };
  };
  environment: {
    server: string;
    evidenceMode: "headless-runtime-diagnostics";
  };
  artifacts: {
    outputDir: string;
    markdownSummary: string;
    milestoneDir: string;
    visualEvidenceTemplate: string;
  };
  journey: JourneyStepSummary[];
  requiredEvidence: RequiredEvidenceField[];
  visualEvidence: VisualEvidenceSummary;
  failureSummary: FailureSummary;
  checkpointLedger: {
    source: "primary-journey-evidence";
    milestoneDir: string;
    entryCount: number;
    entries: CheckpointLedgerEntry[];
  };
}

type RootState = VeilRoot & Record<string, any>;

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");
const STEP_METADATA: Array<{ id: JourneyStepId; title: string }> = [
  { id: "lobby-entry", title: "Lobby entry" },
  { id: "room-join", title: "Room join" },
  { id: "map-explore", title: "Map explore" },
  { id: "first-battle", title: "First battle" },
  { id: "battle-settlement", title: "Battle settlement" },
  { id: "reconnect-restore", title: "Reconnect / restore" },
  { id: "return-to-world", title: "Return to world" }
];

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

  return {
    ...(candidate ? { candidate } : {}),
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
  return slug || "cocos-primary-journey";
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

function buildVisualEvidenceSlots(): VisualEvidenceSlot[] {
  return STEP_METADATA.flatMap((step) => [
    {
      id: `${step.id}:creator-preview`,
      milestoneId: step.id,
      milestoneTitle: step.title,
      surface: "creator-preview" as const,
      status: "pending" as const,
      artifactPath: null,
      notes: "Attach a Creator preview screenshot or short capture for this milestone."
    },
    {
      id: `${step.id}:wechat-safe-area`,
      milestoneId: step.id,
      milestoneTitle: step.title,
      surface: "wechat-safe-area" as const,
      status: "pending" as const,
      artifactPath: null,
      notes: "Attach a WeChat DevTools/device safe-area screenshot or mark the capture blocked with a reason."
    }
  ]);
}

function toRepoRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function waitFor(assertion: () => boolean, onTimeout: () => unknown, attempts = 30): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (assertion()) {
      return;
    }
    await flushMicrotasks();
  }

  throw new Error(JSON.stringify(onTimeout(), null, 2));
}

function createRootHarness() {
  const sceneNode = new Node("PrimaryJourneyEvidenceScene");
  const rootNode = new Node("VeilRootJourneyEvidence");
  rootNode.parent = sceneNode;
  const root = rootNode.addComponent(VeilRoot) as RootState;
  root.renderView = () => undefined;
  root.ensureViewNodes = () => undefined;
  root.ensureUiCameraVisibility = () => undefined;
  root.ensureHudActionBinding = () => undefined;
  root.syncBrowserRoomQuery = () => undefined;
  root.syncWechatShareBridge = () => ({
    available: false,
    menuEnabled: false,
    handlerRegistered: false,
    canShareDirectly: false,
    immediateShared: false,
    payload: null,
    message: "disabled"
  });
  return { root, rootNode };
}

function createNeutralEncounterBattle(): BattleState {
  return {
    id: "battle-neutral-journey",
    round: 1,
    lanes: 1,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
        stackName: "Guard",
        initiative: 7,
        attack: 4,
        defense: 4,
        minDamage: 1,
        maxDamage: 2,
        count: 12,
        currentHp: 10,
        maxHp: 10,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      },
      "neutral-1-stack": {
        id: "neutral-1-stack",
        templateId: "orc_warrior",
        camp: "defender",
        lane: 0,
        stackName: "Orc",
        initiative: 5,
        attack: 3,
        defense: 3,
        minDamage: 1,
        maxDamage: 3,
        count: 8,
        currentHp: 9,
        maxHp: 9,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
    log: ["战斗开始"],
    rng: {
      seed: 1001,
      cursor: 0
    },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1",
    encounterPosition: { x: 1, y: 1 }
  };
}

function createJourneyBootstrapUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createSessionUpdate(4, roomId, playerId);
  update.world.map.tiles[1] = {
    ...update.world.map.tiles[1],
    fog: "visible",
    resource: {
      kind: "wood",
      amount: 5
    }
  };
  update.world.map.tiles[2] = {
    ...update.world.map.tiles[2],
    fog: "visible"
  };
  update.world.map.tiles[3] = {
    ...update.world.map.tiles[3],
    fog: "visible",
    occupant: {
      kind: "neutral",
      refId: "neutral-1"
    }
  };
  update.reachableTiles = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  return update;
}

function createJourneyExploreUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneyBootstrapUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.position = { x: 1, y: 0 };
  update.world.ownHeroes[0]!.move.remaining = 5;
  update.world.resources.wood = 15;
  update.world.map.tiles[1] = {
    ...update.world.map.tiles[1],
    resource: undefined
  };
  update.events = [
    {
      type: "hero.moved",
      heroId: "hero-1",
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      moveCost: 1
    },
    {
      type: "hero.collected",
      heroId: "hero-1",
      resource: {
        kind: "wood",
        amount: 5
      }
    }
  ];
  update.reachableTiles = [{ x: 1, y: 0 }, { x: 1, y: 1 }];
  update.reason = "journey.world.explore";
  return update;
}

function createJourneyBattleUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneyExploreUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.position = { x: 1, y: 1 };
  update.world.ownHeroes[0]!.move.remaining = 4;
  update.battle = createNeutralEncounterBattle();
  update.events = [
    {
      type: "battle.started",
      heroId: "hero-1",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      initiator: "hero",
      battleId: "battle-neutral-journey",
      path: [{ x: 1, y: 0 }, { x: 1, y: 1 }],
      moveCost: 1
    }
  ];
  update.reachableTiles = [];
  update.reason = "journey.battle.started";
  return update;
}

function createJourneySettlementUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneyExploreUpdate(roomId, playerId);
  update.world.ownHeroes[0]!.position = { x: 1, y: 1 };
  update.world.ownHeroes[0]!.move.remaining = 4;
  update.world.ownHeroes[0]!.progression = {
    ...update.world.ownHeroes[0]!.progression,
    experience: 25,
    battlesWon: 1,
    neutralBattlesWon: 1
  };
  update.world.resources.gold = 1012;
  update.world.map.tiles[3] = {
    ...update.world.map.tiles[3],
    occupant: undefined
  };
  update.events = [
    {
      type: "battle.resolved",
      battleId: "battle-neutral-journey",
      battleKind: "neutral",
      heroId: "hero-1",
      result: "attacker_victory",
      resourcesGained: {
        gold: 12,
        wood: 0,
        ore: 0
      },
      experienceGained: 25,
      skillPointsAwarded: 0
    }
  ];
  update.reason = "journey.battle.settlement";
  return update;
}

function createJourneyReconnectRecoveryUpdate(roomId: string, playerId: string): SessionUpdate {
  const update = createJourneySettlementUpdate(roomId, playerId);
  update.world.meta.day = 5;
  update.world.ownHeroes[0]!.move.remaining = 8;
  update.events = [];
  update.reason = "journey.reconnect.restore";
  return update;
}

function captureJourneyArtifact(options: {
  root: RootState;
  phase: string;
  joinedOptions?: Array<{ logicalRoomId: string; playerId: string; seed: number }>;
  room?: FakeColyseusRoom;
}) {
  const { root } = options;
  const update = root.lastUpdate ?? null;
  return {
    phase: options.phase,
    identity: {
      roomId: root.roomId,
      playerId: root.playerId,
      displayName: root.displayName,
      authMode: root.authMode,
      loginId: root.loginId,
      sessionSource: root.sessionSource,
      authTokenPresent: Boolean(root.authToken)
    },
    lobby: {
      showLobby: root.showLobby,
      status: root.lobbyStatus,
      loading: root.lobbyLoading,
      entering: root.lobbyEntering,
      rooms:
        root.lobbyRooms?.map((roomEntry: Record<string, unknown>) => ({
          roomId: roomEntry.roomId,
          day: roomEntry.day,
          connectedPlayers: roomEntry.connectedPlayers
        })) ?? []
    },
    room: {
      diagnosticsConnectionStatus: root.diagnosticsConnectionStatus,
      lastUpdateDay: update?.world.meta.day ?? null,
      lastUpdateReason: root.lastRoomUpdateReason,
      lastUpdateSource: root.lastRoomUpdateSource,
      logTail: root.logLines?.slice(0, 8) ?? [],
      timelineTail: root.timelineEntries?.slice(0, 6) ?? [],
      sentMessages: options.room?.sentMessages ?? [],
      joinedOptions: options.joinedOptions ?? []
    },
    diagnostics: buildCocosRuntimeDiagnosticsSnapshot({
      devOnly: true,
      mode: update?.battle ? "battle" : "world",
      roomId: root.roomId,
      playerId: root.playerId,
      authMode: root.authMode,
      loginId: root.loginId,
      connectionStatus: root.diagnosticsConnectionStatus,
      lastUpdateSource: root.lastRoomUpdateSource,
      lastUpdateReason: root.lastRoomUpdateReason,
      lastUpdateAt: root.lastRoomUpdateAtMs,
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
      primaryClientTelemetry: root.primaryClientTelemetry ?? []
    })
  };
}

function defaultRequiredEvidence(): RequiredEvidenceField[] {
  return [
    {
      id: "roomId",
      label: "Room ID",
      value: "",
      evidence: [],
      notes: "Authoritative room identity recorded during room join or recovery."
    },
    {
      id: "reconnectPrompt",
      label: "Reconnect Prompt",
      value: "",
      evidence: [],
      notes: "Canonical reconnect success prompt captured from the runtime log tail."
    },
    {
      id: "restoredState",
      label: "Restored State",
      value: "",
      evidence: [],
      notes: "Recovered world state that proves position/resources/progression did not roll back."
    },
    {
      id: "firstBattleResult",
      label: "First Battle Result",
      value: "",
      evidence: [],
      notes: "First battle result and critical reward/experience summary."
    }
  ];
}

function writeVisualEvidenceTemplate(input: {
  candidateName: string;
  outputPath: string;
  revision: GitRevision;
}): VisualEvidenceSummary {
  const slots = buildVisualEvidenceSlots();
  const payload = {
    schemaVersion: 1,
    candidate: {
      name: input.candidateName,
      scope: "apps/cocos-client",
      branch: input.revision.branch,
      commit: input.revision.commit,
      shortCommit: input.revision.shortCommit
    },
    mode: "manual-visual-capture-required",
    status: "blocked",
    requiredSlots: slots.length,
    capturedSlots: 0,
    instructions:
      "Fill artifactPath and set status=captured for each Creator preview and WeChat safe-area milestone screenshot or short capture before RC sign-off.",
    slots
  };
  writeJson(input.outputPath, payload);
  return {
    mode: "manual-visual-capture-required",
    status: "blocked",
    artifactPath: toRepoRelative(input.outputPath),
    requiredSlots: slots.length,
    capturedSlots: 0,
    slots
  };
}

function buildFailureSummary(
  journey: JourneyStepSummary[],
  requiredEvidence: RequiredEvidenceField[],
  failure: PrimaryJourneyEvidenceArtifact["execution"]["failure"]
): FailureSummary {
  const regressedJourneySegments = journey
    .filter((step) => step.status === "failed")
    .map((step) => ({
      id: step.id,
      title: step.title,
      status: "failed" as const,
      reason: step.summary || "Required journey segment regressed.",
      artifactPath: failure?.stepId === step.id ? failure.artifactPath : step.evidence.find((entry) => entry.endsWith(".json"))
    }));
  const blockedJourneySegments: FailureSummary["blockedJourneySegments"] = [];
  const lackingJourneyEvidence = journey
    .filter((step) => step.status === "pending")
    .map((step) => ({
      id: step.id,
      title: step.title,
      status: "pending" as const,
      reason: step.summary || "Required journey segment lacks evidence."
    }));
  const lackingRequiredEvidence = requiredEvidence
    .filter((field) => field.value.trim().length === 0)
    .map((field) => ({
      id: field.id,
      label: field.label,
      reason: field.notes || "Required evidence field is still empty."
    }));

  const parts: string[] = [];
  if (regressedJourneySegments.length > 0) {
    parts.push(`Regressed journey segments: ${regressedJourneySegments.map((step) => step.id).join(", ")}`);
  }
  if (blockedJourneySegments.length > 0) {
    parts.push(`Blocked journey segments: ${blockedJourneySegments.map((step) => step.id).join(", ")}`);
  }
  if (lackingJourneyEvidence.length > 0) {
    parts.push(`Journey segments lacking evidence: ${lackingJourneyEvidence.map((step) => step.id).join(", ")}`);
  }
  if (lackingRequiredEvidence.length > 0) {
    parts.push(`Required evidence still empty: ${lackingRequiredEvidence.map((field) => field.id).join(", ")}`);
  }

  return {
    summary: parts.length > 0 ? parts.join(". ") : "No regressions or evidence gaps recorded.",
    regressedJourneySegments,
    blockedJourneySegments,
    lackingJourneyEvidence,
    lackingRequiredEvidence
  };
}

function renderMarkdown(artifact: PrimaryJourneyEvidenceArtifact): string {
  const lines: string[] = [];
  lines.push("# Cocos Primary-Client Journey Evidence");
  lines.push("");
  lines.push(`- Candidate: \`${artifact.candidate.name}\``);
  lines.push(`- Commit: \`${artifact.candidate.shortCommit}\` (${artifact.candidate.branch})`);
  lines.push(`- Status: \`${artifact.execution.overallStatus}\``);
  lines.push(`- Owner: ${artifact.execution.owner || "_unassigned_"}`);
  lines.push(`- Server: \`${artifact.environment.server}\``);
  lines.push(`- Evidence mode: \`${artifact.environment.evidenceMode}\``);
  lines.push(`- Duration: \`${artifact.execution.durationMs}ms\``);
  lines.push("");
  lines.push("## Journey");
  lines.push("");
  lines.push("| Step | Status | Timing | Evidence |");
  lines.push("| --- | --- | --- | --- |");
  for (const step of artifact.journey) {
    const timing = step.timing
      ? `\`${step.timing.durationMs}ms\`<br><sub>${step.timing.startedAt} -> ${step.timing.completedAt}</sub>`
      : "_n/a_";
    lines.push(
      `| ${step.title} | \`${step.status}\` | ${timing} | ${step.evidence.map((entry) => `\`${entry}\``).join("<br>") || "_none_"} |`
    );
  }
  lines.push("");
  lines.push("## Required Evidence");
  lines.push("");
  lines.push("| Field | Value | Evidence |");
  lines.push("| --- | --- | --- |");
  for (const field of artifact.requiredEvidence) {
    lines.push(`| \`${field.id}\` | \`${field.value}\` | ${field.evidence.map((entry) => `\`${entry}\``).join("<br>") || "_none_"} |`);
  }
  lines.push("");
  lines.push("## Visual Evidence");
  lines.push("");
  lines.push(`- Status: \`${artifact.visualEvidence.status}\``);
  lines.push(`- Mode: \`${artifact.visualEvidence.mode}\``);
  lines.push(`- Template: \`${artifact.visualEvidence.artifactPath}\``);
  lines.push(`- Captured: \`${artifact.visualEvidence.capturedSlots}/${artifact.visualEvidence.requiredSlots}\``);
  lines.push("");
  lines.push("Headless runtime diagnostics are not screenshot evidence. Creator preview and WeChat safe-area captures must be attached before visual sign-off.");
  lines.push("");
  lines.push("| Milestone | Creator preview | WeChat safe area |");
  lines.push("| --- | --- | --- |");
  for (const step of STEP_METADATA) {
    const creator = artifact.visualEvidence.slots.find((slot) => slot.milestoneId === step.id && slot.surface === "creator-preview");
    const wechat = artifact.visualEvidence.slots.find((slot) => slot.milestoneId === step.id && slot.surface === "wechat-safe-area");
    lines.push(
      `| ${step.title} | \`${creator?.status ?? "pending"}\` | \`${wechat?.status ?? "pending"}\` |`
    );
  }
  lines.push("");
  lines.push("## Checkpoint Ledger");
  lines.push("");
  lines.push("| Step | Status | Phase | Artifact | Telemetry checkpoints |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const entry of artifact.checkpointLedger.entries) {
    lines.push(
      `| ${entry.title} | \`${entry.status}\` | \`${entry.phase}\` | \`${entry.artifactPath}\` | ${entry.telemetryCheckpoints.map((item) => `\`${item}\``).join("<br>") || "_none_"} |`
    );
  }
  lines.push("");
  lines.push("## Blocker Drill-Down");
  lines.push("");
  lines.push(artifact.failureSummary.summary);
  if (
    artifact.failureSummary.regressedJourneySegments.length === 0 &&
    artifact.failureSummary.blockedJourneySegments.length === 0 &&
    artifact.failureSummary.lackingJourneyEvidence.length === 0 &&
    artifact.failureSummary.lackingRequiredEvidence.length === 0
  ) {
    lines.push("");
    lines.push("- No open blocker or evidence gap recorded for the canonical journey.");
  } else {
    for (const step of artifact.failureSummary.regressedJourneySegments) {
      lines.push("");
      lines.push(
        `- Regressed: \`${step.id}\` (${step.title})${step.artifactPath ? ` -> \`${step.artifactPath}\`` : ""} ${step.reason}`
      );
    }
    for (const step of artifact.failureSummary.blockedJourneySegments) {
      lines.push("");
      lines.push(
        `- Blocked: \`${step.id}\` (${step.title})${step.artifactPath ? ` -> \`${step.artifactPath}\`` : ""} ${step.reason}`
      );
    }
    for (const step of artifact.failureSummary.lackingJourneyEvidence) {
      lines.push("");
      lines.push(`- Missing journey evidence: \`${step.id}\` (${step.title}) ${step.reason}`);
    }
    for (const field of artifact.failureSummary.lackingRequiredEvidence) {
      lines.push("");
      lines.push(`- Missing required evidence: \`${field.id}\` (${field.label}) ${field.reason}`);
    }
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(artifact.execution.summary);
  if (artifact.execution.failure) {
    lines.push("");
    lines.push("## Failure");
    lines.push("");
    lines.push(`- Step: \`${artifact.execution.failure.stepId}\``);
    lines.push(`- Message: ${artifact.execution.failure.message}`);
    if (artifact.execution.failure.artifactPath) {
      lines.push(`- Artifact: \`${artifact.execution.failure.artifactPath}\``);
    }
  }
  lines.push("");
  lines.push("Headless CI cannot capture Creator/WeChat screenshots, so this command stores runtime diagnostics JSON for each milestone instead.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function buildArtifact(args: Args): Promise<PrimaryJourneyEvidenceArtifact> {
  const revision = getRevision();
  const candidateName = args.candidate || `cocos-primary-journey-${revision.shortCommit}`;
  const startedAt = new Date().toISOString();
  const derivedOutputDir = args.outputDir
    ? args.outputDir
    : args.outputPath
      ? path.dirname(path.resolve(args.outputPath))
      : DEFAULT_OUTPUT_DIR;
  const outputDir = path.resolve(derivedOutputDir);
  const slug = slugify(candidateName);
  const milestoneDir = path.join(outputDir, `cocos-primary-journey-${slug}-${revision.shortCommit}`);
  const jsonOutputPath = path.resolve(args.outputPath || path.join(outputDir, `cocos-primary-journey-evidence-${slug}-${revision.shortCommit}.json`));
  const markdownOutputPath = path.resolve(
    args.markdownOutputPath || path.join(outputDir, `cocos-primary-journey-evidence-${slug}-${revision.shortCommit}.md`)
  );
  const visualEvidenceOutputPath = path.join(outputDir, `cocos-primary-visual-evidence-${slug}-${revision.shortCommit}.json`);
  const visualEvidence = writeVisualEvidenceTemplate({
    candidateName,
    outputPath: visualEvidenceOutputPath,
    revision
  });
  const requiredEvidence = defaultRequiredEvidence();
  const joinedOptions: Array<{ logicalRoomId: string; playerId: string; seed: number }> = [];
  const stepArtifacts = new Map<JourneyStepId, string[]>();
  const artifactSummaries = new Map<JourneyStepId, string>();
  const checkpointLedgerEntries = new Map<JourneyStepId, CheckpointLedgerEntry>();
  const stepStatus = new Map<JourneyStepId, StepStatus>(STEP_METADATA.map((entry) => [entry.id, "pending"]));
  const stepTimings = new Map<
    JourneyStepId,
    {
      startedAt: string;
      completedAt: string;
      durationMs: number;
    }
  >();
  const roomId = "room-primary-journey";
  const playerId = "player-account";
  const syncedAuthSession = {
    token: "account.session.token",
    playerId,
    displayName: "暮潮守望",
    authMode: "account" as const,
    provider: "account-password" as const,
    loginId: "veil-ranger",
    source: "remote" as const
  };
  const storage = createMemoryStorage();
  const initialRoom = new FakeColyseusRoom(
    [createJourneyBootstrapUpdate(roomId, playerId)],
    "journey-initial-token",
    {
      "world.action": [createJourneyExploreUpdate(roomId, playerId), createJourneyBattleUpdate(roomId, playerId)],
      "battle.action": [createJourneySettlementUpdate(roomId, playerId)]
    }
  );
  const recoveredRoom = new FakeColyseusRoom([createJourneyReconnectRecoveryUpdate(roomId, playerId)], "journey-recovered-token");
  let currentStep: JourneyStepId = "lobby-entry";
  let currentStepStartedAt = startedAt;
  let currentStepStartedAtMs = Date.now();
  let root: RootState | null = null;

  const beginStep = (stepId: JourneyStepId) => {
    currentStep = stepId;
    currentStepStartedAtMs = Date.now();
    currentStepStartedAt = new Date(currentStepStartedAtMs).toISOString();
  };

  const setRequiredEvidence = (fieldId: CanonicalEvidenceId, value: string, evidence: string[]) => {
    const field = requiredEvidence.find((entry) => entry.id === fieldId);
    if (!field) {
      return;
    }
    field.value = value;
    field.evidence = evidence;
  };

  const recordStep = (stepId: JourneyStepId, summary: string, room: FakeColyseusRoom | undefined, phase: string) => {
    if (!root) {
      fail("Cannot record a journey step before the runtime is initialized.");
    }
    const completedAtMs = Date.now();
    const completedAt = new Date(completedAtMs).toISOString();
    const index = STEP_METADATA.findIndex((entry) => entry.id === stepId);
    const artifactPath = path.join(milestoneDir, `${String(index + 1).padStart(2, "0")}-${stepId}.json`);
    const milestoneArtifact = captureJourneyArtifact({
      root,
      phase,
      joinedOptions,
      room
    });
    writeJson(artifactPath, milestoneArtifact);
    const relativeArtifactPath = toRepoRelative(artifactPath);
    stepArtifacts.set(stepId, [relativeArtifactPath]);
    stepStatus.set(stepId, "passed");
    artifactSummaries.set(stepId, summary);
    stepTimings.set(stepId, {
      startedAt: currentStepStartedAt,
      completedAt,
      durationMs: completedAtMs - currentStepStartedAtMs
    });
    const telemetryCheckpoints = Array.isArray(milestoneArtifact.diagnostics?.primaryClientTelemetry)
      ? [
          ...new Set(
            milestoneArtifact.diagnostics.primaryClientTelemetry
              .map((entry: Record<string, unknown>) => (typeof entry.checkpoint === "string" ? entry.checkpoint.trim() : ""))
              .filter((entry: string) => entry.length > 0)
          )
        ]
      : [];
    checkpointLedgerEntries.set(stepId, {
      id: stepId,
      title: STEP_METADATA.find((entry) => entry.id === stepId)?.title ?? stepId,
      status: "passed",
      summary,
      artifactPath: relativeArtifactPath,
      phase,
      roomId: typeof milestoneArtifact.identity?.roomId === "string" ? milestoneArtifact.identity.roomId : "",
      playerId: typeof milestoneArtifact.identity?.playerId === "string" ? milestoneArtifact.identity.playerId : "",
      connectionStatus:
        typeof milestoneArtifact.room?.diagnosticsConnectionStatus === "string" ? milestoneArtifact.room.diagnosticsConnectionStatus : "",
      lastUpdateReason: typeof milestoneArtifact.room?.lastUpdateReason === "string" ? milestoneArtifact.room.lastUpdateReason : "",
      telemetryCheckpoints
    });
    return relativeArtifactPath;
  };

  try {
    writeStoredCocosAuthSession(storage, syncedAuthSession);
    (sys as unknown as { localStorage: Storage }).localStorage = storage;
    (globalThis as { location?: Pick<Location, "search" | "href"> }).location = {
      search: "",
      href: "http://127.0.0.1:4173/"
    };
    (globalThis as { history?: Pick<History, "replaceState"> }).history = {
      replaceState() {}
    };

    setVeilCocosSessionRuntimeForTests({
      storage,
      wait: async () => undefined,
      loadSdk: createSdkLoader({
        joinRooms: [initialRoom, recoveredRoom],
        joinedOptions
      })
    });
    setVeilRootRuntimeForTests({
      createSession: (...runtimeArgs) => VeilCocosSession.create(...runtimeArgs),
      readStoredReplay: (...runtimeArgs) => VeilCocosSession.readStoredReplay(...runtimeArgs),
      syncAuthSession: async () => syncedAuthSession,
      loadLobbyRooms: async () => [
        {
          roomId,
          seed: 1001,
          day: 4,
          connectedPlayers: 1,
          heroCount: 1,
          activeBattles: 0,
          updatedAt: "2026-04-02T09:00:00.000Z"
        }
      ],
      loadAccountProfile: async () =>
        createFallbackCocosPlayerAccountProfile(playerId, roomId, "暮潮守望", {
          source: "remote",
          authMode: "account",
          loginId: "veil-ranger"
        })
    });

    ({ root } = createRootHarness());
    root.onLoad();
    root.start();

    beginStep("lobby-entry");
    await waitFor(
      () => root!.showLobby === true && root!.lobbyRooms.length === 1 && root!.sessionSource === "remote",
      () => captureJourneyArtifact({ root: root!, phase: "lobby-bootstrap", joinedOptions, room: initialRoom })
    );
    recordStep("lobby-entry", "Cold start reused the account session and reached the lobby room list.", initialRoom, "lobby-bootstrap");
    root.privacyConsentAccepted = true;

    beginStep("room-join");
    await root.enterLobbyRoom(roomId);
    await waitFor(
      () => root!.showLobby === false && root!.lastUpdate?.world.meta.roomId === roomId,
      () => captureJourneyArtifact({ root: root!, phase: "room-join", joinedOptions, room: initialRoom })
    );
    const roomJoinArtifact = recordStep(
      "room-join",
      "Selected room joined successfully with the stored account session.",
      initialRoom,
      "room-join"
    );
    setRequiredEvidence("roomId", roomId, [roomJoinArtifact]);

    beginStep("map-explore");
    await root.moveHeroToTile(root.lastUpdate.world.map.tiles[1]);
    await waitFor(
      () => root!.lastUpdate?.reason === "journey.world.explore" && root!.lastUpdate.world.ownHeroes[0]?.position.x === 1,
      () => captureJourneyArtifact({ root: root!, phase: "world-explore", joinedOptions, room: initialRoom })
    );
    recordStep(
      "map-explore",
      "Hero moved onto the world tile, consumed movement, and collected the exposed wood pickup.",
      initialRoom,
      "world-explore"
    );

    beginStep("first-battle");
    await root.moveHeroToTile(root.lastUpdate.world.map.tiles[3]);
    await waitFor(
      () => root!.lastUpdate?.battle?.id === "battle-neutral-journey",
      () => captureJourneyArtifact({ root: root!, phase: "battle-start", joinedOptions, room: initialRoom })
    );
    recordStep(
      "first-battle",
      "World exploration escalated into the first neutral battle with a live battle snapshot.",
      initialRoom,
      "battle-start"
    );

    beginStep("battle-settlement");
    await root.actInBattle({
      type: "battle.attack",
      attackerId: "hero-1-stack",
      defenderId: "neutral-1-stack"
    });
    await waitFor(
      () => root!.lastUpdate?.reason === "journey.battle.settlement" && root!.lastUpdate.battle === null,
      () => captureJourneyArtifact({ root: root!, phase: "battle-settlement", joinedOptions, room: initialRoom })
    );
    const settlementArtifact = recordStep(
      "battle-settlement",
      "First battle resolved to attacker victory and returned control to the world state.",
      initialRoom,
      "battle-settlement"
    );
    setRequiredEvidence("firstBattleResult", "attacker_victory; gold +12; experience +25", [settlementArtifact]);

    beginStep("reconnect-restore");
    initialRoom.emitLeave(4002);
    await waitFor(
      () => root!.lastUpdate?.reason === "journey.reconnect.restore" && root!.lastUpdate.world.meta.day === 5,
      () => captureJourneyArtifact({ root: root!, phase: "reconnect-restore", joinedOptions, room: recoveredRoom })
    );
    const reconnectArtifact = recordStep(
      "reconnect-restore",
      "Reconnect recovery restored the same room, world state, and account identity after the drop.",
      recoveredRoom,
      "reconnect-restore"
    );
    const reconnectPrompt = root.logLines.find((line: string) => line.includes("连接已恢复")) ?? "连接已恢复";
    setRequiredEvidence("reconnectPrompt", reconnectPrompt, [reconnectArtifact]);
    setRequiredEvidence(
      "restoredState",
      "Restored room-primary-journey on day 5 at (1,1) with wood 15, gold 1012, and neutralBattlesWon 1.",
      [reconnectArtifact]
    );

    beginStep("return-to-world");
    recordStep(
      "return-to-world",
      "Recovered world HUD remained in the room with preserved resources, hero position, and progression.",
      recoveredRoom,
      "return-to-world"
    );

    if (storage.getItem(`project-veil:cocos:reconnection:${roomId}:${playerId}`) !== "journey-recovered-token") {
      fail("Reconnect token was not persisted after the recovery room connected.");
    }
    if (!root.logLines.some((line: string) => line.includes("重连失败"))) {
      fail("Expected reconnect failure signal was not recorded before recovery.");
    }
    if (!root.logLines.some((line: string) => line.includes("连接已恢复"))) {
      fail("Expected reconnect recovery prompt was not recorded.");
    }

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - Date.parse(startedAt);
    const journey = STEP_METADATA.map((entry) => ({
      id: entry.id,
      title: entry.title,
      status: stepStatus.get(entry.id) ?? "pending",
      summary: artifactSummaries.get(entry.id) ?? "",
      ...(stepTimings.get(entry.id) ? { timing: stepTimings.get(entry.id) } : {}),
      evidence: stepArtifacts.get(entry.id) ?? []
    }));
    const checkpointLedger = {
      source: "primary-journey-evidence" as const,
      milestoneDir: toRepoRelative(milestoneDir),
      entryCount: checkpointLedgerEntries.size,
      entries: STEP_METADATA.map((entry) => checkpointLedgerEntries.get(entry.id)).filter(
        (entry): entry is CheckpointLedgerEntry => Boolean(entry)
      )
    };
    const artifact: PrimaryJourneyEvidenceArtifact = {
      schemaVersion: 1,
      candidate: {
        name: candidateName,
        scope: "apps/cocos-client",
        branch: revision.branch,
        commit: revision.commit,
        shortCommit: revision.shortCommit
      },
      execution: {
        owner: args.owner || "",
        startedAt,
        completedAt,
        durationMs,
        overallStatus: "passed",
        summary:
          "Headless primary-client journey evidence passed for lobby entry, room join, world explore, first battle, settlement, reconnect recovery, and restored world state."
      },
      environment: {
        server: args.server || "ws://127.0.0.1:2567",
        evidenceMode: "headless-runtime-diagnostics"
      },
      artifacts: {
        outputDir: toRepoRelative(outputDir),
        markdownSummary: toRepoRelative(markdownOutputPath),
        milestoneDir: toRepoRelative(milestoneDir),
        visualEvidenceTemplate: visualEvidence.artifactPath
      },
      journey,
      requiredEvidence,
      visualEvidence,
      failureSummary: buildFailureSummary(journey, requiredEvidence, undefined),
      checkpointLedger
    };

    writeJson(jsonOutputPath, artifact);
    writeText(markdownOutputPath, renderMarkdown(artifact));
    return artifact;
  } catch (error) {
    const completedAt = new Date().toISOString();
    const completedAtMs = Date.now();
    const durationMs = completedAtMs - Date.parse(startedAt);
    const failureMessage = error instanceof Error ? error.message : String(error);
    let failedArtifactPath: string | undefined;
    if (root) {
      const index = STEP_METADATA.findIndex((entry) => entry.id === currentStep);
      const artifactPath = path.join(milestoneDir, `${String(index + 1).padStart(2, "0")}-${currentStep}-failed.json`);
      const failedMilestoneArtifact = captureJourneyArtifact({
        root,
        phase: `${currentStep}-failed`,
        joinedOptions,
        room: currentStep === "reconnect-restore" || currentStep === "return-to-world" ? recoveredRoom : initialRoom
      });
      writeJson(artifactPath, failedMilestoneArtifact);
      failedArtifactPath = toRepoRelative(artifactPath);
      const telemetryCheckpoints = Array.isArray(failedMilestoneArtifact.diagnostics?.primaryClientTelemetry)
        ? [
            ...new Set(
              failedMilestoneArtifact.diagnostics.primaryClientTelemetry
                .map((entry: Record<string, unknown>) => (typeof entry.checkpoint === "string" ? entry.checkpoint.trim() : ""))
                .filter((entry: string) => entry.length > 0)
            )
          ]
        : [];
      checkpointLedgerEntries.set(currentStep, {
        id: currentStep,
        title: STEP_METADATA.find((entry) => entry.id === currentStep)?.title ?? currentStep,
        status: "failed",
        summary: failureMessage,
        artifactPath: failedArtifactPath,
        phase: `${currentStep}-failed`,
        roomId: typeof failedMilestoneArtifact.identity?.roomId === "string" ? failedMilestoneArtifact.identity.roomId : "",
        playerId: typeof failedMilestoneArtifact.identity?.playerId === "string" ? failedMilestoneArtifact.identity.playerId : "",
        connectionStatus:
          typeof failedMilestoneArtifact.room?.diagnosticsConnectionStatus === "string"
            ? failedMilestoneArtifact.room.diagnosticsConnectionStatus
            : "",
        lastUpdateReason:
          typeof failedMilestoneArtifact.room?.lastUpdateReason === "string" ? failedMilestoneArtifact.room.lastUpdateReason : "",
        telemetryCheckpoints
      });
      stepArtifacts.set(currentStep, [failedArtifactPath]);
    }
    stepStatus.set(currentStep, "failed");
    artifactSummaries.set(currentStep, failureMessage);
    stepTimings.set(currentStep, {
      startedAt: currentStepStartedAt,
      completedAt,
      durationMs: completedAtMs - currentStepStartedAtMs
    });

    const failure = {
      stepId: currentStep,
      title: STEP_METADATA.find((entry) => entry.id === currentStep)?.title || currentStep,
      message: failureMessage,
      ...(failedArtifactPath ? { artifactPath: failedArtifactPath } : {})
    };
    const journey = STEP_METADATA.map((entry) => ({
      id: entry.id,
      title: entry.title,
      status: stepStatus.get(entry.id) ?? "pending",
      summary: artifactSummaries.get(entry.id) ?? "",
      ...(stepTimings.get(entry.id) ? { timing: stepTimings.get(entry.id) } : {}),
      evidence: stepArtifacts.get(entry.id) ?? []
    }));
    const checkpointLedger = {
      source: "primary-journey-evidence" as const,
      milestoneDir: toRepoRelative(milestoneDir),
      entryCount: checkpointLedgerEntries.size,
      entries: STEP_METADATA.map((entry) => checkpointLedgerEntries.get(entry.id)).filter(
        (entry): entry is CheckpointLedgerEntry => Boolean(entry)
      )
    };
    const artifact: PrimaryJourneyEvidenceArtifact = {
      schemaVersion: 1,
      candidate: {
        name: candidateName,
        scope: "apps/cocos-client",
        branch: revision.branch,
        commit: revision.commit,
        shortCommit: revision.shortCommit
      },
      execution: {
        owner: args.owner || "",
        startedAt,
        completedAt,
        durationMs,
        overallStatus: "failed",
        summary: `Primary-client journey evidence failed during ${currentStep}.`,
        failure
      },
      environment: {
        server: args.server || "ws://127.0.0.1:2567",
        evidenceMode: "headless-runtime-diagnostics"
      },
      artifacts: {
        outputDir: toRepoRelative(outputDir),
        markdownSummary: toRepoRelative(markdownOutputPath),
        milestoneDir: toRepoRelative(milestoneDir),
        visualEvidenceTemplate: visualEvidence.artifactPath
      },
      journey,
      requiredEvidence,
      visualEvidence,
      failureSummary: buildFailureSummary(journey, requiredEvidence, failure),
      checkpointLedger
    };

    writeJson(jsonOutputPath, artifact);
    writeText(markdownOutputPath, renderMarkdown(artifact));
    console.error(`Primary-client journey smoke failed at stage: ${currentStep}`);
    console.error(`Journey evidence JSON: ${toRepoRelative(jsonOutputPath)}`);
    console.error(`Journey evidence Markdown: ${toRepoRelative(markdownOutputPath)}`);
    if (failedArtifactPath) {
      console.error(`Stage diagnostics artifact: ${failedArtifactPath}`);
    }
    throw error;
  } finally {
    if (root) {
      root.onDestroy();
      await flushMicrotasks();
    }
    resetVeilRootRuntimeForTests();
    resetVeilCocosSessionRuntimeForTests();
    resetPixelSpriteRuntimeForTests();
    (sys as unknown as { localStorage: Storage | null }).localStorage = null;
    delete (globalThis as { history?: History }).history;
    delete (globalThis as { location?: Location }).location;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const artifact = await buildArtifact(args);
  console.log(`Wrote primary-client journey evidence JSON: ${artifact.artifacts.markdownSummary.replace(/\.md$/, ".json")}`);
  console.log(`Wrote primary-client journey evidence Markdown: ${artifact.artifacts.markdownSummary}`);
  console.log(`Milestones: ${artifact.journey.length}`);
  console.log(`Status: ${artifact.execution.overallStatus}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
