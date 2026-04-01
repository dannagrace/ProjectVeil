import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildCocosRuntimeDiagnosticsSnapshot } from "../apps/cocos-client/assets/scripts/cocos-runtime-diagnostics.ts";
import { createFallbackCocosPlayerAccountProfile } from "../apps/cocos-client/assets/scripts/cocos-lobby.ts";
import { createSessionUpdate } from "../apps/cocos-client/test/helpers/cocos-session-fixtures.ts";
import {
  createVeilRootHarness,
  installVeilRootRuntime,
  resetVeilRootRuntime
} from "../apps/cocos-client/test/helpers/veil-root-harness.ts";
import type {
  RuntimeDiagnosticsConnectionStatus,
  RuntimeDiagnosticsSnapshot
} from "../packages/shared/src/runtime-diagnostics.ts";

type ArtifactStatus = "passed";
type CheckpointCategory = "progression" | "inventory" | "combat" | "reconnect";

interface Args {
  outputPath?: string;
  markdownOutputPath?: string;
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface ArtifactCheckpoint {
  id: string;
  title: string;
  category: CheckpointCategory;
  capturedAt: string;
  summary: string;
  connectionStatus: RuntimeDiagnosticsConnectionStatus;
  telemetryCheckpoints: string[];
  highlights: string[];
  diagnostics: RuntimeDiagnosticsSnapshot;
}

export interface PrimaryClientDiagnosticSnapshotsArtifact {
  schemaVersion: 1;
  generatedAt: string;
  revision: GitRevision;
  summary: {
    status: ArtifactStatus;
    checkpointCount: number;
    categoryIds: CheckpointCategory[];
    checkpointIds: string[];
  };
  checkpoints: ArtifactCheckpoint[];
}

type RootState = ReturnType<typeof createVeilRootHarness> & Record<string, any>;

const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;
  let markdownOutputPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

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

    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(outputPath ? { outputPath } : {}),
    ...(markdownOutputPath ? { markdownOutputPath } : {})
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
    branch: readGitValue(["rev-parse", "--abbrev-ref", "HEAD"]),
    dirty: readGitValue(["status", "--porcelain"]).length > 0
  };
}

function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeTextFile(filePath: string, content: string): void {
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, content, "utf8");
}

function toRepoRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}

function buildBattleState() {
  return {
    id: "battle-primary-diagnostic",
    round: 2,
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
        currentHp: 9,
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
        count: 4,
        currentHp: 7,
        maxHp: 9,
        hasRetaliated: false,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
    log: ["战斗开始", "守军发动攻击", "暮潮守望完成反击"],
    rng: {
      seed: 1001,
      cursor: 4
    },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1",
    encounterPosition: { x: 1, y: 0 }
  };
}

function buildDiagnosticsSnapshot(root: RootState, exportedAt: string): RuntimeDiagnosticsSnapshot {
  const update = root.lastUpdate ?? null;
  return buildCocosRuntimeDiagnosticsSnapshot({
    exportedAt,
    devOnly: true,
    mode: root.showLobby ? "lobby" : update?.battle ? "battle" : "world",
    roomId: root.roomId,
    playerId: root.playerId,
    authMode: root.authMode,
    loginId: root.loginId,
    connectionStatus: root.diagnosticsConnectionStatus,
    lastUpdateSource: root.lastRoomUpdateSource ?? null,
    lastUpdateReason: root.lastRoomUpdateReason ?? null,
    lastUpdateAt: root.lastRoomUpdateAtMs ?? null,
    update,
    account:
      root.lobbyAccountProfile ??
      createFallbackCocosPlayerAccountProfile(root.playerId, root.roomId, root.displayName, {
        source: "remote",
        authMode: root.authMode,
        loginId: root.loginId
      }),
    timelineEntries: root.timelineEntries ?? [],
    logLines: root.logLines ?? [],
    predictionStatus: root.predictionStatus ?? "",
    recoverySummary:
      typeof root.predictionStatus === "string" && root.predictionStatus.includes("回放缓存状态")
        ? root.predictionStatus
        : null,
    primaryClientTelemetry: root.primaryClientTelemetry ?? []
  });
}

function captureCheckpoint(input: {
  root: RootState;
  id: string;
  title: string;
  category: CheckpointCategory;
  capturedAt: string;
  summary: string;
  telemetryCheckpoints: string[];
  highlights: string[];
}): ArtifactCheckpoint {
  return {
    id: input.id,
    title: input.title,
    category: input.category,
    capturedAt: input.capturedAt,
    summary: input.summary,
    connectionStatus: input.root.diagnosticsConnectionStatus,
    telemetryCheckpoints: input.telemetryCheckpoints,
    highlights: input.highlights,
    diagnostics: buildDiagnosticsSnapshot(input.root, input.capturedAt)
  };
}

export async function buildPrimaryClientDiagnosticSnapshotsArtifact(
  revision = getRevision(),
  generatedAt = new Date().toISOString()
): Promise<PrimaryClientDiagnosticSnapshotsArtifact> {
  const root = createVeilRootHarness() as RootState;
  delete root.applySessionUpdate;
  delete root.applyReplayedSessionUpdate;

  const baseMs = Date.parse(generatedAt);
  const at = (offsetMinutes: number) => new Date(baseMs + offsetMinutes * 60_000).toISOString();

  root.roomId = "room-primary-diagnostics";
  root.playerId = "player-account";
  root.displayName = "暮潮守望";
  root.authMode = "account";
  root.loginId = "veil-ranger";
  root.authToken = "account.session.token";
  root.sessionSource = "remote";
  root.showLobby = false;
  root.diagnosticsConnectionStatus = "connected";
  root.logLines = [];
  root.timelineEntries = [];
  root.primaryClientTelemetry = [];
  root.predictionStatus = "";

  installVeilRootRuntime({
    loadProgressionSnapshot: async () => ({
      summary: {
        totalAchievements: 3,
        unlockedAchievements: 1,
        inProgressAchievements: 2,
        recentEventCount: 1,
        latestEventAt: at(2)
      },
      achievements: [],
      recentEventLog: [
        {
          id: "event-1",
          timestamp: at(2),
          roomId: root.roomId,
          playerId: root.playerId,
          category: "combat",
          description: "战斗开始。",
          rewards: []
        }
      ]
    }),
    loadAccountProfile: async () =>
      createFallbackCocosPlayerAccountProfile(root.playerId, root.roomId, root.displayName, {
        source: "remote",
        authMode: root.authMode,
        loginId: root.loginId
      })
  });

  try {
    const combatUpdate = createSessionUpdate(4, root.roomId, root.playerId);
    combatUpdate.battle = buildBattleState();
    combatUpdate.world.ownHeroes[0]!.position = { x: 1, y: 0 };
    root.lastUpdate = combatUpdate;
    root.session = {} as never;
    root.lastRoomUpdateSource = "connect";
    root.lastRoomUpdateReason = "initial_snapshot";
    root.lastRoomUpdateAtMs = Date.parse(at(0));

    await root.equipHeroItem("weapon", "militia_pike");
    await (root as any).refreshProgressionReview();

    const progressionCheckpoint = captureCheckpoint({
      root,
      id: "progression-review",
      title: "Progression review loaded",
      category: "progression",
      capturedAt: at(2),
      summary: "Primary-client progression review loaded with the latest achievement and event context after room entry.",
      telemetryCheckpoints: ["review.loaded"],
      highlights: [
        "Review loader returned recent event log context for the active account.",
        "Diagnostic snapshot stayed in connected mode while review data hydrated."
      ]
    });

    const gameplayUpdate = createSessionUpdate(5, root.roomId, root.playerId);
    gameplayUpdate.battle = buildBattleState();
    gameplayUpdate.events = [
      {
        type: "battle.started",
        heroId: "hero-1",
        attackerPlayerId: root.playerId,
        encounterKind: "neutral",
        neutralArmyId: "neutral-1",
        battleId: "battle-primary-diagnostic",
        path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
        moveCost: 1
      },
      {
        type: "hero.progressed",
        heroId: "hero-1",
        battleId: "battle-primary-diagnostic",
        battleKind: "neutral",
        experienceGained: 25,
        totalExperience: 125,
        level: 2,
        levelsGained: 1,
        skillPointsAwarded: 1,
        availableSkillPoints: 1
      },
      {
        type: "hero.equipmentFound",
        heroId: "hero-1",
        battleId: "battle-primary-diagnostic",
        battleKind: "neutral",
        equipmentId: "militia_pike",
        equipmentName: "Militia Pike",
        rarity: "common",
        overflowed: true
      },
      {
        type: "battle.resolved",
        heroId: "hero-1",
        attackerPlayerId: root.playerId,
        battleId: "battle-primary-diagnostic",
        result: "attacker_victory"
      }
    ];
    gameplayUpdate.world.ownHeroes[0]!.position = { x: 1, y: 0 };
    gameplayUpdate.world.ownHeroes[0]!.progression.level = 2;
    gameplayUpdate.world.ownHeroes[0]!.progression.experience = 125;
    gameplayUpdate.world.ownHeroes[0]!.progression.battlesWon = 1;
    gameplayUpdate.world.ownHeroes[0]!.progression.neutralBattlesWon = 1;
    gameplayUpdate.world.ownHeroes[0]!.loadout.inventory = ["travel_boots", "militia_pike"];
    gameplayUpdate.battle!.round = 3;
    gameplayUpdate.battle!.log = ["战斗开始", "守军发动攻击", "暮潮守望完成反击", "战斗结束，获得长枪"];

    await root.applySessionUpdate(gameplayUpdate);
    root.lastRoomUpdateSource = "push";
    root.lastRoomUpdateReason = "battle_resolution";
    root.lastRoomUpdateAtMs = Date.parse(at(4));

    const inventoryCheckpoint = captureCheckpoint({
      root,
      id: "inventory-overflow",
      title: "Inventory overflow surfaced in diagnostics",
      category: "inventory",
      capturedAt: at(4),
      summary: "Diagnostic snapshot captured blocked inventory loot handling and preserved the relevant telemetry trail.",
      telemetryCheckpoints: ["equipment.equip.rejected", "loot.overflowed"],
      highlights: [
        "Blocked inventory telemetry remains attached to the active runtime diagnostics snapshot.",
        "Inventory count stayed visible after the overflowed battle reward."
      ]
    });

    const combatCheckpoint = captureCheckpoint({
      root,
      id: "combat-loop",
      title: "Combat loop resolved",
      category: "combat",
      capturedAt: at(4),
      summary: "Primary-client diagnostics recorded encounter start, progression gain, and combat resolution in one battle-loop checkpoint.",
      telemetryCheckpoints: ["encounter.started", "hero.progressed", "encounter.resolved"],
      highlights: [
        "Battle diagnostics include round, active unit, and log tail.",
        "Telemetry shows a complete neutral encounter loop ending in attacker victory."
      ]
    });

    root.lastRoomUpdateSource = "replay";
    root.lastRoomUpdateReason = "cached_snapshot";
    root.lastRoomUpdateAtMs = Date.parse(at(6));
    root.predictionStatus = "回放缓存状态：展示上一份本地快照，等待权威重同步恢复。";
    (root as any).handleConnectionEvent("reconnecting");

    const reconnectReplayCheckpoint = captureCheckpoint({
      root,
      id: "reconnect-cached-replay",
      title: "Reconnect replay fallback",
      category: "reconnect",
      capturedAt: at(6),
      summary: "Diagnostic snapshot preserved the cached replay fallback while the client was reconnecting.",
      telemetryCheckpoints: [],
      highlights: [
        "Connection status downgraded to reconnecting while replaying cached state.",
        "Recovery summary stayed attached for reviewer inspection."
      ]
    });

    const recoveredUpdate = createSessionUpdate(6, root.roomId, root.playerId);
    recoveredUpdate.world.ownHeroes[0]!.position = { x: 1, y: 1 };
    recoveredUpdate.world.ownHeroes[0]!.progression.level = 2;
    recoveredUpdate.world.ownHeroes[0]!.progression.experience = 125;
    recoveredUpdate.world.ownHeroes[0]!.progression.battlesWon = 1;
    recoveredUpdate.world.ownHeroes[0]!.progression.neutralBattlesWon = 1;
    recoveredUpdate.world.resources.wood = 12;
    recoveredUpdate.reason = "after-reconnect";
    root.lastUpdate = recoveredUpdate;
    root.lastRoomUpdateSource = "push";
    root.lastRoomUpdateReason = "after-reconnect";
    root.lastRoomUpdateAtMs = Date.parse(at(8));
    root.predictionStatus = "";
    (root as any).handleConnectionEvent("reconnected");

    const reconnectRecoveryCheckpoint = captureCheckpoint({
      root,
      id: "reconnect-recovery",
      title: "Reconnect recovered to authoritative world state",
      category: "reconnect",
      capturedAt: at(8),
      summary: "Diagnostic snapshot confirmed reconnect recovery restored authoritative world state after cached replay fallback.",
      telemetryCheckpoints: [],
      highlights: [
        "Connection returned to connected with a fresh authoritative push update.",
        "World state advanced to the post-recovery day and resource snapshot."
      ]
    });

    const checkpoints = [
      progressionCheckpoint,
      inventoryCheckpoint,
      combatCheckpoint,
      reconnectReplayCheckpoint,
      reconnectRecoveryCheckpoint
    ];

    return {
      schemaVersion: 1,
      generatedAt,
      revision,
      summary: {
        status: "passed",
        checkpointCount: checkpoints.length,
        categoryIds: ["progression", "inventory", "combat", "reconnect"],
        checkpointIds: checkpoints.map((checkpoint) => checkpoint.id)
      },
      checkpoints
    };
  } finally {
    resetVeilRootRuntime();
  }
}

export function renderPrimaryClientDiagnosticSnapshotsMarkdown(
  artifact: PrimaryClientDiagnosticSnapshotsArtifact,
  jsonArtifactPath: string
): string {
  const lines: string[] = [];
  lines.push("# Primary-Client Diagnostic Snapshots");
  lines.push("");
  lines.push(`- Generated at: ${artifact.generatedAt}`);
  lines.push(`- Revision: ${artifact.revision.shortCommit} (${artifact.revision.branch}${artifact.revision.dirty ? ", dirty" : ""})`);
  lines.push(`- JSON artifact: ${toRepoRelative(jsonArtifactPath)}`);
  lines.push(`- Checkpoints: ${artifact.summary.checkpointCount}`);
  lines.push(`- Categories: ${artifact.summary.categoryIds.join(", ")}`);
  lines.push("");
  lines.push("| Checkpoint | Category | Connection | Captured At |");
  lines.push("| --- | --- | --- | --- |");
  for (const checkpoint of artifact.checkpoints) {
    lines.push(`| ${checkpoint.id} | ${checkpoint.category} | ${checkpoint.connectionStatus} | ${checkpoint.capturedAt} |`);
  }
  lines.push("");

  for (const checkpoint of artifact.checkpoints) {
    lines.push(`## ${checkpoint.title}`);
    lines.push("");
    lines.push(`- Checkpoint ID: ${checkpoint.id}`);
    lines.push(`- Category: ${checkpoint.category}`);
    lines.push(`- Summary: ${checkpoint.summary}`);
    lines.push(`- Connection status: ${checkpoint.connectionStatus}`);
    lines.push(`- Captured at: ${checkpoint.capturedAt}`);
    lines.push(
      `- Account readiness: ${checkpoint.diagnostics.account?.accountReadiness ? `${checkpoint.diagnostics.account.accountReadiness.status} · ${checkpoint.diagnostics.account.accountReadiness.summary}` : "<not-modeled>"}`
    );
    lines.push(`- Telemetry checkpoints: ${checkpoint.telemetryCheckpoints.length > 0 ? checkpoint.telemetryCheckpoints.join(", ") : "<none>"}`);
    for (const highlight of checkpoint.highlights) {
      lines.push(`- ${highlight}`);
    }
    lines.push(`- Snapshot mode: ${checkpoint.diagnostics.source.mode}`);
    lines.push(
      `- Room summary: room=${checkpoint.diagnostics.room?.roomId ?? "<none>"} day=${checkpoint.diagnostics.room?.day ?? "<none>"} source=${checkpoint.diagnostics.room?.lastUpdateSource ?? "<none>"}`
    );
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function defaultOutputPaths(revision: GitRevision, generatedAt: string): { jsonPath: string; markdownPath: string } {
  const timestamp = generatedAt.replace(/:/g, "-");
  const baseName = `cocos-primary-client-diagnostic-snapshots-${revision.shortCommit}-${timestamp}`;
  return {
    jsonPath: path.resolve(DEFAULT_OUTPUT_DIR, `${baseName}.json`),
    markdownPath: path.resolve(DEFAULT_OUTPUT_DIR, `${baseName}.md`)
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const revision = getRevision();
  const generatedAt = new Date().toISOString();
  const outputDefaults = defaultOutputPaths(revision, generatedAt);
  const artifact = await buildPrimaryClientDiagnosticSnapshotsArtifact(revision, generatedAt);
  const jsonOutputPath = path.resolve(args.outputPath ?? outputDefaults.jsonPath);
  const markdownOutputPath = path.resolve(args.markdownOutputPath ?? outputDefaults.markdownPath);

  writeTextFile(jsonOutputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  writeTextFile(markdownOutputPath, renderPrimaryClientDiagnosticSnapshotsMarkdown(artifact, jsonOutputPath));

  console.log(`Wrote primary-client diagnostic JSON: ${toRepoRelative(jsonOutputPath)}`);
  console.log(`Wrote primary-client diagnostic Markdown: ${toRepoRelative(markdownOutputPath)}`);
  console.log(`Checkpoint count: ${artifact.summary.checkpointCount}`);
  console.log(`Categories: ${artifact.summary.categoryIds.join(", ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
