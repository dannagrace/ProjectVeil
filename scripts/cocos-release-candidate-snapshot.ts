import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type EvidenceStatus = "pending" | "blocked" | "passed" | "failed" | "not_applicable";
type SnapshotResult = "pending" | "blocked" | "passed" | "failed" | "partial";
type BuildSurface = "creator_preview" | "wechat_preview" | "wechat_upload_candidate" | "other";
type JourneyStepId = "lobby-entry" | "room-join" | "map-explore" | "first-battle" | "reconnect-restore" | "return-to-world";
type CanonicalEvidenceId = "roomId" | "reconnectPrompt" | "restoredState" | "firstBattleResult";

interface Args {
  outputPath?: string;
  candidate?: string;
  owner?: string;
  buildSurface?: BuildSurface;
  server?: string;
  creatorVersion?: string;
  wechatClient?: string;
  device?: string;
  notes?: string;
  check: boolean;
  force: boolean;
  wechatSmokeReportPath?: string;
  releaseReadinessSnapshotPath?: string;
}

interface LinkedEvidenceRef {
  path: string;
  summary?: string;
  result?: string;
  sourceRevision?: string;
}

interface ReleaseReadinessSnapshotCheck {
  id: string;
  kind?: "automated" | "manual";
  required?: boolean;
  status?: "passed" | "failed" | "pending" | "not_applicable";
}

interface ReleaseReadinessSnapshot {
  checks?: ReleaseReadinessSnapshotCheck[];
}

interface WechatSmokeReportCase {
  id?: string;
  status?: "pending" | "blocked" | "passed" | "failed" | "not_applicable";
  notes?: string;
  evidence?: string[];
  requiredEvidence?: Partial<Record<CanonicalEvidenceId | "shareScene" | "shareQuery" | "roundtripState", string>>;
}

interface WechatSmokeReport {
  execution?: {
    tester?: string;
    device?: string;
    clientVersion?: string;
    executedAt?: string;
    result?: "pending" | "blocked" | "passed" | "failed";
    summary?: string;
  };
  artifact?: {
    sourceRevision?: string;
  };
  cases?: WechatSmokeReportCase[];
}

interface CanonicalEvidenceField {
  id: CanonicalEvidenceId;
  label: string;
  required: true;
  value: string;
  notes: string;
  evidence: string[];
}

interface JourneyStep {
  id: JourneyStepId;
  title: string;
  required: boolean;
  status: EvidenceStatus;
  notes: string;
  evidence: string[];
  sourceRefs: string[];
}

interface EvidenceMapping {
  source: "creator-preview" | "wechat-smoke-report";
  sourceField: string;
  target: string;
  notes: string;
}

interface CocosReleaseCandidateSnapshot {
  schemaVersion: 1;
  candidate: {
    name: string;
    scope: "apps/cocos-client";
    branch: string;
    commit: string;
    shortCommit: string;
    buildSurface: BuildSurface;
  };
  execution: {
    owner: string;
    executedAt: string;
    overallStatus: SnapshotResult;
    summary: string;
    notes: string;
  };
  environment: {
    server: string;
    cocosCreatorVersion: string;
    wechatClient: string;
    device: string;
  };
  linkedEvidence: {
    releaseReadinessSnapshot?: LinkedEvidenceRef;
    wechatSmokeReport?: LinkedEvidenceRef;
  };
  mappings: EvidenceMapping[];
  requiredEvidence: CanonicalEvidenceField[];
  journey: JourneyStep[];
}

const DEFAULT_OUTPUT_DIR = path.join("artifacts", "release-evidence");
const REQUIRED_JOURNEY_STEP_IDS: JourneyStepId[] = [
  "lobby-entry",
  "room-join",
  "map-explore",
  "first-battle",
  "reconnect-restore",
  "return-to-world"
];
const REQUIRED_EVIDENCE_IDS: CanonicalEvidenceId[] = ["roomId", "reconnectPrompt", "restoredState", "firstBattleResult"];

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let outputPath: string | undefined;
  let candidate: string | undefined;
  let owner: string | undefined;
  let buildSurface: BuildSurface | undefined;
  let server: string | undefined;
  let creatorVersion: string | undefined;
  let wechatClient: string | undefined;
  let device: string | undefined;
  let notes: string | undefined;
  let check = false;
  let force = false;
  let wechatSmokeReportPath: string | undefined;
  let releaseReadinessSnapshotPath: string | undefined;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--output" && next) {
      outputPath = next;
      index += 1;
      continue;
    }
    if (arg === "--candidate" && next) {
      candidate = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--owner" && next) {
      owner = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--build-surface" && next) {
      buildSurface = parseBuildSurface(next);
      index += 1;
      continue;
    }
    if (arg === "--server" && next) {
      server = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--creator-version" && next) {
      creatorVersion = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-client" && next) {
      wechatClient = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--device" && next) {
      device = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--notes" && next) {
      notes = next.trim();
      index += 1;
      continue;
    }
    if (arg === "--wechat-smoke-report" && next) {
      wechatSmokeReportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--release-readiness-snapshot" && next) {
      releaseReadinessSnapshotPath = next;
      index += 1;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return {
    ...(outputPath ? { outputPath } : {}),
    ...(candidate ? { candidate } : {}),
    ...(owner ? { owner } : {}),
    ...(buildSurface ? { buildSurface } : {}),
    ...(server ? { server } : {}),
    ...(creatorVersion ? { creatorVersion } : {}),
    ...(wechatClient ? { wechatClient } : {}),
    ...(device ? { device } : {}),
    ...(notes ? { notes } : {}),
    ...(wechatSmokeReportPath ? { wechatSmokeReportPath } : {}),
    ...(releaseReadinessSnapshotPath ? { releaseReadinessSnapshotPath } : {}),
    check,
    force
  };
}

function parseBuildSurface(value: string): BuildSurface {
  if (
    value === "creator_preview" ||
    value === "wechat_preview" ||
    value === "wechat_upload_candidate" ||
    value === "other"
  ) {
    return value;
  }
  fail(`Unsupported build surface: ${value}`);
}

function getGitValue(args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, payload: unknown, force: boolean): void {
  if (!force && fs.existsSync(filePath)) {
    fail(`Output file already exists: ${filePath}. Pass --force to overwrite.`);
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function defaultOutputPath(): string {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  return path.resolve(DEFAULT_OUTPUT_DIR, `cocos-rc-snapshot-${timestamp}.json`);
}

function buildMappings(): EvidenceMapping[] {
  return [
    {
      source: "creator-preview",
      sourceField: "HUD / Session text",
      target: "requiredEvidence.roomId",
      notes: "Creator 预览截图或录屏必须能直接看到房间号。"
    },
    {
      source: "creator-preview",
      sourceField: "恢复提示文本",
      target: "requiredEvidence.reconnectPrompt",
      notes: "使用 reconnect canonical scenario 的同一组成功信号。"
    },
    {
      source: "creator-preview",
      sourceField: "恢复后的 HUD / 世界状态",
      target: "requiredEvidence.restoredState",
      notes: "记录恢复后关键状态未回档，例如位置、资源、房间阶段或战斗摘要。"
    },
    {
      source: "creator-preview",
      sourceField: "首战结算面板",
      target: "requiredEvidence.firstBattleResult",
      notes: "至少记录胜负与关键奖励/伤害结果。"
    },
    {
      source: "wechat-smoke-report",
      sourceField: "cases[login-lobby]",
      target: "journey[lobby-entry]",
      notes: "微信 smoke 的登录/Lobby 结果映射到统一主链路起点。"
    },
    {
      source: "wechat-smoke-report",
      sourceField: "cases[room-entry]",
      target: "journey[room-join]",
      notes: "房间进入结果保留在同一 RC 快照，而不是另起口径。"
    },
    {
      source: "wechat-smoke-report",
      sourceField: "cases[reconnect-recovery]",
      target: "journey[reconnect-restore] + requiredEvidence.roomId + requiredEvidence.reconnectPrompt + requiredEvidence.restoredState",
      notes: "同一条 reconnect case 必须同时说明原 roomId、恢复提示和恢复后关键状态。"
    },
    {
      source: "wechat-smoke-report",
      sourceField: "execution.summary",
      target: "execution.summary",
      notes: "WeChat RC 结果可以复用 smoke 总结，但仍需补齐首战与返回世界证据。"
    }
  ];
}

function buildRequiredEvidence(): CanonicalEvidenceField[] {
  return [
    {
      id: "roomId",
      label: "Room ID",
      required: true,
      value: "",
      notes: "必填。至少在进房或恢复后记录一个权威 roomId。",
      evidence: []
    },
    {
      id: "reconnectPrompt",
      label: "Reconnect Prompt",
      required: true,
      value: "",
      notes: "必填。记录恢复提示、重连文案或对应 HUD 文本。",
      evidence: []
    },
    {
      id: "restoredState",
      label: "Restored State",
      required: true,
      value: "",
      notes: "必填。记录恢复后仍保留的关键状态，例如位置、资源、房间阶段或 battle summary。",
      evidence: []
    },
    {
      id: "firstBattleResult",
      label: "First Battle Result",
      required: true,
      value: "",
      notes: "必填。记录首战胜负、关键伤害/奖励或结算摘要。",
      evidence: []
    }
  ];
}

function buildJourney(): JourneyStep[] {
  return [
    {
      id: "lobby-entry",
      title: "Lobby entry",
      required: true,
      status: "pending",
      notes: "冷启动后进入 Lobby，并记录账号态或游客降级结果。",
      evidence: [],
      sourceRefs: []
    },
    {
      id: "room-join",
      title: "Room join",
      required: true,
      status: "pending",
      notes: "从 Lobby 创建或加入房间，并记录 roomId / player identity。",
      evidence: [],
      sourceRefs: []
    },
    {
      id: "map-explore",
      title: "Map explore",
      required: true,
      status: "pending",
      notes: "进入世界后完成一次基础探索或交互，证明大地图主链路可用。",
      evidence: [],
      sourceRefs: []
    },
    {
      id: "first-battle",
      title: "First battle",
      required: true,
      status: "pending",
      notes: "进入首场遭遇战并完成一次完整结算。",
      evidence: [],
      sourceRefs: []
    },
    {
      id: "reconnect-restore",
      title: "Reconnect / restore",
      required: true,
      status: "pending",
      notes: "复用 reconnect canonical scenario，记录 roomId、恢复提示和恢复后关键状态。",
      evidence: [],
      sourceRefs: []
    },
    {
      id: "return-to-world",
      title: "Return to world",
      required: true,
      status: "pending",
      notes: "首场战斗后回到世界态，HUD/地图可继续交互。",
      evidence: [],
      sourceRefs: []
    }
  ];
}

function readLinkedEvidenceRef(filePath: string, kind: "release-readiness" | "wechat-smoke"): LinkedEvidenceRef {
  const resolvedPath = path.resolve(filePath);
  if (!fs.existsSync(resolvedPath)) {
    fail(`Linked evidence file does not exist: ${resolvedPath}`);
  }

  const payload = readJsonFile<Record<string, unknown>>(resolvedPath);
  if (kind === "release-readiness") {
    const summary = payload.summary as { status?: string } | undefined;
    const revision = payload.revision as { shortCommit?: string } | undefined;
    return {
      path: resolvedPath,
      ...(summary?.status ? { result: summary.status } : {}),
      ...(revision?.shortCommit ? { sourceRevision: revision.shortCommit } : {}),
      summary: "Release readiness snapshot reference"
    };
  }

  const execution = payload.execution as { result?: string; summary?: string } | undefined;
  const artifact = payload.artifact as { sourceRevision?: string } | undefined;
  return {
    path: resolvedPath,
    ...(execution?.summary ? { summary: execution.summary } : {}),
    ...(execution?.result ? { result: execution.result } : {}),
    ...(artifact?.sourceRevision ? { sourceRevision: artifact.sourceRevision } : {})
  };
}

function buildTemplate(args: Args): CocosReleaseCandidateSnapshot {
  const commit = getGitValue(["rev-parse", "HEAD"]);
  const shortCommit = getGitValue(["rev-parse", "--short", "HEAD"]);
  const branch = getGitValue(["rev-parse", "--abbrev-ref", "HEAD"]);

  const snapshot: CocosReleaseCandidateSnapshot = {
    schemaVersion: 1,
    candidate: {
      name: args.candidate || `cocos-rc-${shortCommit}`,
      scope: "apps/cocos-client",
      branch,
      commit,
      shortCommit,
      buildSurface: args.buildSurface || "creator_preview"
    },
    execution: {
      owner: args.owner || "",
      executedAt: "",
      overallStatus: "pending",
      summary: "Fill after completing the canonical Cocos RC path: Lobby -> room -> explore -> first battle -> reconnect -> return to world.",
      notes: args.notes || ""
    },
    environment: {
      server: args.server || "",
      cocosCreatorVersion: args.creatorVersion || "",
      wechatClient: args.wechatClient || "",
      device: args.device || ""
    },
    linkedEvidence: {
      ...(args.releaseReadinessSnapshotPath
        ? { releaseReadinessSnapshot: readLinkedEvidenceRef(args.releaseReadinessSnapshotPath, "release-readiness") }
        : {}),
      ...(args.wechatSmokeReportPath ? { wechatSmokeReport: readLinkedEvidenceRef(args.wechatSmokeReportPath, "wechat-smoke") } : {})
    },
    mappings: buildMappings(),
    requiredEvidence: buildRequiredEvidence(),
    journey: buildJourney()
  };

  if (args.wechatSmokeReportPath) {
    applyWechatSmokeReport(snapshot, readJsonFile<WechatSmokeReport>(path.resolve(args.wechatSmokeReportPath)));
  }

  return snapshot;
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function assertStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(`${label} must be a string array.`);
  }
  return value as string[];
}

function assertEvidenceStatus(value: unknown, label: string): EvidenceStatus {
  if (value === "pending" || value === "blocked" || value === "passed" || value === "failed" || value === "not_applicable") {
    return value;
  }
  fail(`${label} has unsupported status: ${String(value)}`);
}

function assertSnapshotResult(value: unknown): SnapshotResult {
  if (value === "pending" || value === "blocked" || value === "passed" || value === "failed" || value === "partial") {
    return value;
  }
  fail(`execution.overallStatus has unsupported value: ${String(value)}`);
}

function mapSmokeStatusToJourneyStatus(value: WechatSmokeReportCase["status"]): EvidenceStatus {
  if (value === "failed") {
    return "failed";
  }
  if (value === "blocked") {
    return "blocked";
  }
  if (value === "passed") {
    return "passed";
  }
  if (value === "not_applicable") {
    return "not_applicable";
  }
  return "pending";
}

function applyCaseToJourneyStep(
  snapshot: CocosReleaseCandidateSnapshot,
  stepId: JourneyStepId,
  entry: WechatSmokeReportCase | undefined
): void {
  if (!entry) {
    return;
  }
  const step = snapshot.journey.find((candidate) => candidate.id === stepId);
  if (!step) {
    return;
  }
  step.status = mapSmokeStatusToJourneyStatus(entry.status);
  step.notes = entry.notes?.trim() || step.notes;
  step.evidence = Array.isArray(entry.evidence) ? entry.evidence.filter((item): item is string => typeof item === "string") : [];
  step.sourceRefs = ["wechat-smoke-report"];
}

function applyRequiredEvidenceValue(
  snapshot: CocosReleaseCandidateSnapshot,
  fieldId: CanonicalEvidenceId,
  value: string | undefined,
  evidence: string[]
): void {
  if (!value?.trim()) {
    return;
  }
  const field = snapshot.requiredEvidence.find((entry) => entry.id === fieldId);
  if (!field) {
    return;
  }
  field.value = value.trim();
  field.evidence = evidence;
}

function applyWechatSmokeReport(snapshot: CocosReleaseCandidateSnapshot, report: WechatSmokeReport): void {
  const caseById = new Map((report.cases ?? []).map((entry) => [entry.id, entry]));
  const loginLobby = caseById.get("login-lobby");
  const roomEntry = caseById.get("room-entry");
  const reconnect = caseById.get("reconnect-recovery");

  applyCaseToJourneyStep(snapshot, "lobby-entry", loginLobby);
  applyCaseToJourneyStep(snapshot, "room-join", roomEntry);
  applyCaseToJourneyStep(snapshot, "reconnect-restore", reconnect);

  const reconnectEvidence = reconnect?.requiredEvidence;
  const reconnectArtifacts = Array.isArray(reconnect?.evidence)
    ? reconnect.evidence.filter((item): item is string => typeof item === "string")
    : [];
  applyRequiredEvidenceValue(snapshot, "roomId", reconnectEvidence?.roomId, reconnectArtifacts);
  applyRequiredEvidenceValue(snapshot, "reconnectPrompt", reconnectEvidence?.reconnectPrompt, reconnectArtifacts);
  applyRequiredEvidenceValue(snapshot, "restoredState", reconnectEvidence?.restoredState, reconnectArtifacts);

  if (!snapshot.execution.owner && report.execution?.tester?.trim()) {
    snapshot.execution.owner = report.execution.tester.trim();
  }
  if (!snapshot.execution.executedAt && report.execution?.executedAt?.trim()) {
    snapshot.execution.executedAt = report.execution.executedAt.trim();
  }
  if (!snapshot.environment.device && report.execution?.device?.trim()) {
    snapshot.environment.device = report.execution.device.trim();
  }
  if (!snapshot.environment.wechatClient && report.execution?.clientVersion?.trim()) {
    snapshot.environment.wechatClient = report.execution.clientVersion.trim();
  }

  const mappedSteps = snapshot.journey.filter((step) => ["lobby-entry", "room-join", "reconnect-restore"].includes(step.id));
  const hasFailedMappedStep = mappedSteps.some((step) => step.status === "failed");
  const hasBlockedMappedStep = mappedSteps.some((step) => step.status === "blocked");
  const hasPendingUnmappedStep = snapshot.journey.some((step) => step.required && step.status === "pending");
  if (hasFailedMappedStep) {
    snapshot.execution.overallStatus = "failed";
  } else if (hasBlockedMappedStep) {
    snapshot.execution.overallStatus = "blocked";
  } else if (hasPendingUnmappedStep) {
    snapshot.execution.overallStatus = "partial";
  } else {
    snapshot.execution.overallStatus = report.execution?.result === "passed" ? "passed" : "partial";
  }

  const importedSummary = report.execution?.summary?.trim();
  if (importedSummary) {
    snapshot.execution.summary = importedSummary;
  } else if (report.execution?.result === "blocked") {
    snapshot.execution.summary =
      "Imported WeChat smoke evidence is blocked; complete the missing device/runtime steps before treating this RC snapshot as passed.";
  } else if (hasPendingUnmappedStep) {
    snapshot.execution.summary =
      "Imported WeChat smoke evidence populated lobby, room, and reconnect steps; creator-preview evidence is still required for explore, first battle, and return-to-world.";
  }
}

function validateLinkedReleaseReadinessSnapshot(snapshotRef: LinkedEvidenceRef | undefined): void {
  if (!snapshotRef) {
    return;
  }

  const readinessSnapshot = readJsonFile<ReleaseReadinessSnapshot>(snapshotRef.path);
  const pendingRequiredManualChecks = (readinessSnapshot.checks ?? []).filter(
    (check) => check.kind === "manual" && check.required === true && check.status === "pending"
  );
  if (pendingRequiredManualChecks.length > 0) {
    fail(
      `Linked release readiness snapshot still has pending required manual checks: ${pendingRequiredManualChecks.map((check) => check.id).join(", ")}.`
    );
  }
}

function validateSnapshot(snapshot: CocosReleaseCandidateSnapshot): void {
  if (snapshot.schemaVersion !== 1) {
    fail(`Snapshot schemaVersion must be 1, received ${JSON.stringify(snapshot.schemaVersion)}.`);
  }

  assertNonEmptyString(snapshot.candidate.name, "candidate.name");
  assertNonEmptyString(snapshot.candidate.scope, "candidate.scope");
  assertNonEmptyString(snapshot.candidate.branch, "candidate.branch");
  assertNonEmptyString(snapshot.candidate.commit, "candidate.commit");
  assertNonEmptyString(snapshot.candidate.shortCommit, "candidate.shortCommit");
  parseBuildSurface(snapshot.candidate.buildSurface);
  assertNonEmptyString(snapshot.execution.owner, "execution.owner");
  assertNonEmptyString(snapshot.execution.executedAt, "execution.executedAt");
  assertSnapshotResult(snapshot.execution.overallStatus);
  if (snapshot.execution.overallStatus === "pending") {
    fail("execution.overallStatus must not be pending when using --check.");
  }
  if (snapshot.execution.overallStatus === "blocked") {
    fail("execution.overallStatus is blocked; required device/runtime evidence is still missing.");
  }
  assertNonEmptyString(snapshot.execution.summary, "execution.summary");
  assertNonEmptyString(snapshot.environment.server, "environment.server");

  const journeyById = new Map<JourneyStepId, JourneyStep>();
  for (const step of snapshot.journey) {
    if (journeyById.has(step.id)) {
      fail(`Duplicate journey step id: ${step.id}`);
    }
    assertEvidenceStatus(step.status, `journey[${step.id}].status`);
    assertNonEmptyString(step.title, `journey[${step.id}].title`);
    assertStringArray(step.evidence, `journey[${step.id}].evidence`);
    assertStringArray(step.sourceRefs, `journey[${step.id}].sourceRefs`);
    if (step.required && step.status === "blocked") {
      fail(`Required journey step ${step.id} is blocked.`);
    }
    if (step.required && step.status === "pending") {
      fail(`Required journey step ${step.id} is still pending.`);
    }
    journeyById.set(step.id, step);
  }

  for (const requiredId of REQUIRED_JOURNEY_STEP_IDS) {
    if (!journeyById.has(requiredId)) {
      fail(`Missing required journey step: ${requiredId}`);
    }
  }

  const evidenceById = new Map<CanonicalEvidenceId, CanonicalEvidenceField>();
  for (const field of snapshot.requiredEvidence) {
    if (evidenceById.has(field.id)) {
      fail(`Duplicate required evidence id: ${field.id}`);
    }
    assertNonEmptyString(field.label, `requiredEvidence[${field.id}].label`);
    assertNonEmptyString(field.value, `requiredEvidence[${field.id}].value`);
    assertStringArray(field.evidence, `requiredEvidence[${field.id}].evidence`);
    evidenceById.set(field.id, field);
  }

  for (const requiredId of REQUIRED_EVIDENCE_IDS) {
    if (!evidenceById.has(requiredId)) {
      fail(`Missing required evidence field: ${requiredId}`);
    }
  }

  validateLinkedReleaseReadinessSnapshot(snapshot.linkedEvidence.releaseReadinessSnapshot);
}

function main(): void {
  const args = parseArgs(process.argv);
  const outputPath = path.resolve(args.outputPath || defaultOutputPath());

  if (args.check) {
    if (!fs.existsSync(outputPath)) {
      fail(`Snapshot file does not exist: ${outputPath}`);
    }
    const snapshot = readJsonFile<CocosReleaseCandidateSnapshot>(outputPath);
    validateSnapshot(snapshot);
    console.log(`Validated Cocos RC snapshot: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
    console.log(`  Candidate: ${snapshot.candidate.name}`);
    console.log(`  Surface: ${snapshot.candidate.buildSurface}`);
    console.log(`  Result: ${snapshot.execution.overallStatus}`);
    return;
  }

  const snapshot = buildTemplate(args);
  writeJsonFile(outputPath, snapshot, args.force);
  console.log(`Wrote Cocos RC snapshot template: ${path.relative(process.cwd(), outputPath).replace(/\\/g, "/")}`);
  console.log(`  Candidate: ${snapshot.candidate.name}`);
  console.log(`  Surface: ${snapshot.candidate.buildSurface}`);
  console.log(`  Commit: ${snapshot.candidate.shortCommit} (${snapshot.candidate.branch})`);
}

main();
