import fs from "node:fs";
import path from "node:path";

interface Args {
  artifactsDir?: string;
  metadataPath?: string;
  reportPath?: string;
  expectedRevision?: string;
  check: boolean;
  force: boolean;
}

interface WechatMinigameReleasePackageMetadata {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  appId: string;
  archiveFileName: string;
  archiveBytes: number;
  archiveSha256: string;
  releaseManifestFile: string;
  exportedBuildDir: string;
  packagedBuildDir: string;
  fileCount: number;
  sourceRevision?: string;
  runtimeRemoteUrl?: string;
  remoteAssetRoot?: string;
}

type SmokeStatus = "pending" | "passed" | "failed" | "not_applicable";

interface WechatMinigameSmokeCase {
  id: "login-lobby" | "room-entry" | "reconnect-recovery" | "share-roundtrip" | "key-assets";
  title: string;
  status: SmokeStatus;
  required: boolean;
  notes: string;
  evidence: string[];
  steps: string[];
}

interface WechatMinigameSmokeReport {
  schemaVersion: 1;
  buildTemplatePlatform: "wechatgame";
  projectName: string;
  appId: string;
  artifact: {
    archiveFileName: string;
    archiveSha256: string;
    artifactsDir?: string;
    metadataPath: string;
    sourceRevision?: string;
    runtimeRemoteUrl?: string;
    remoteAssetRoot?: string;
  };
  execution: {
    tester: string;
    device: string;
    clientVersion: string;
    executedAt: string;
    result: "pending" | "passed" | "failed";
    summary: string;
  };
  cases: WechatMinigameSmokeCase[];
}

const REQUIRED_CASE_IDS: WechatMinigameSmokeCase["id"][] = [
  "login-lobby",
  "room-entry",
  "reconnect-recovery",
  "share-roundtrip",
  "key-assets"
];

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  let artifactsDir: string | undefined;
  let metadataPath: string | undefined;
  let reportPath: string | undefined;
  let expectedRevision: string | undefined;
  let check = false;
  let force = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--artifacts-dir" && next) {
      artifactsDir = next;
      index += 1;
      continue;
    }
    if (arg === "--metadata" && next) {
      metadataPath = next;
      index += 1;
      continue;
    }
    if (arg === "--report" && next) {
      reportPath = next;
      index += 1;
      continue;
    }
    if (arg === "--expected-revision" && next) {
      expectedRevision = next.trim() || undefined;
      index += 1;
      continue;
    }
    if (arg === "--check") {
      check = true;
      continue;
    }
    if (arg === "--force") {
      force = true;
    }
  }

  return {
    ...(artifactsDir ? { artifactsDir } : {}),
    ...(metadataPath ? { metadataPath } : {}),
    ...(reportPath ? { reportPath } : {}),
    ...(expectedRevision ? { expectedRevision } : {}),
    check,
    force
  };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function writeJsonFile(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveMetadataPath(args: Args): string {
  if (args.metadataPath) {
    return path.resolve(args.metadataPath);
  }
  if (!args.artifactsDir) {
    fail("Pass either --artifacts-dir <dir> or --metadata <package.json>.");
  }

  const resolvedArtifactsDir = path.resolve(args.artifactsDir);
  if (!fs.existsSync(resolvedArtifactsDir)) {
    fail(`Artifacts directory does not exist: ${resolvedArtifactsDir}`);
  }

  const sidecars = fs
    .readdirSync(resolvedArtifactsDir)
    .filter((entry) => entry.endsWith(".package.json"))
    .sort();
  if (sidecars.length !== 1) {
    fail(`Expected exactly one release sidecar in ${resolvedArtifactsDir}, found ${sidecars.length}.`);
  }

  const sidecar = sidecars[0];
  if (!sidecar) {
    fail(`Unable to resolve release sidecar in ${resolvedArtifactsDir}.`);
  }

  return path.join(resolvedArtifactsDir, sidecar);
}

function resolveReportPath(args: Args, metadataPath: string): string {
  if (args.reportPath) {
    return path.resolve(args.reportPath);
  }
  if (args.artifactsDir) {
    return path.join(path.resolve(args.artifactsDir), "codex.wechat.smoke-report.json");
  }
  return path.join(path.dirname(metadataPath), "codex.wechat.smoke-report.json");
}

function buildSmokeCases(): WechatMinigameSmokeCase[] {
  return [
    {
      id: "login-lobby",
      title: "登录进入 Lobby",
      status: "pending",
      required: true,
      notes: "",
      evidence: [],
      steps: [
        "冷启动小游戏，优先验证微信小游戏登录；若当前包仅支持游客降级，记录降级原因。",
        "确认能进入 Lobby，且大厅昵称、账号态或游客态提示符合预期。",
        "记录首帧加载、首屏提示或异常弹窗。"
      ]
    },
    {
      id: "room-entry",
      title: "进入房间",
      status: "pending",
      required: true,
      notes: "",
      evidence: [],
      steps: [
        "从 Lobby 创建或加入房间。",
        "确认房间内基础 UI、成员列表或匹配状态正常刷新。",
        "若进入房间依赖远程配置，记录对应 revision 或资源版本。"
      ]
    },
    {
      id: "reconnect-recovery",
      title: "断线重连或恢复",
      status: "pending",
      required: true,
      notes: "",
      evidence: [],
      steps: [
        "在房间内主动切到飞行模式、关闭 Wi-Fi 或切后台后恢复网络。",
        "确认客户端能自动重连、恢复到原房间，或给出可接受的恢复提示。",
        "记录重连耗时、是否丢失房间上下文，以及失败时的错误文案。"
      ]
    },
    {
      id: "share-roundtrip",
      title: "分享与回流",
      status: "pending",
      required: true,
      notes: "",
      evidence: [],
      steps: [
        "从 Lobby、世界或战斗入口触发分享。",
        "完成一次真实分享或准真机回流，确认小游戏回到前台后状态正常。",
        "若分享 query 带房间号或 inviterId，记录回流后是否成功识别。"
      ]
    },
    {
      id: "key-assets",
      title: "关键资源加载",
      status: "pending",
      required: true,
      notes: "",
      evidence: [],
      steps: [
        "确认首屏、Lobby、房间或首场战斗关键资源均能加载。",
        "检查远程资源、配置拉取、图片或音频是否有 404、白名单报错或缺图。",
        "记录验证时使用的资源域名、CDN 版本或开发者工具告警。"
      ]
    }
  ];
}

function buildReportTemplate(metadata: WechatMinigameReleasePackageMetadata, metadataPath: string, reportPath: string): WechatMinigameSmokeReport {
  const artifactsDir = path.dirname(metadataPath);
  return {
    schemaVersion: 1,
    buildTemplatePlatform: "wechatgame",
    projectName: metadata.projectName,
    appId: metadata.appId,
    artifact: {
      archiveFileName: metadata.archiveFileName,
      archiveSha256: metadata.archiveSha256,
      artifactsDir,
      metadataPath,
      ...(metadata.sourceRevision ? { sourceRevision: metadata.sourceRevision } : {}),
      ...(metadata.runtimeRemoteUrl ? { runtimeRemoteUrl: metadata.runtimeRemoteUrl } : {}),
      ...(metadata.remoteAssetRoot ? { remoteAssetRoot: metadata.remoteAssetRoot } : {})
    },
    execution: {
      tester: "",
      device: "",
      clientVersion: "",
      executedAt: "",
      result: "pending",
      summary: `Fill this report after running the real-device or quasi-device smoke pass for ${path.basename(reportPath)}.`
    },
    cases: buildSmokeCases()
  };
}

function validateReportShape(report: WechatMinigameSmokeReport): void {
  if (report.schemaVersion !== 1) {
    fail(`Smoke report schemaVersion must be 1, received ${JSON.stringify(report.schemaVersion)}.`);
  }
  if (report.buildTemplatePlatform !== "wechatgame") {
    fail(
      `Smoke report buildTemplatePlatform must be "wechatgame", received ${JSON.stringify(report.buildTemplatePlatform)}.`
    );
  }
  if (!Array.isArray(report.cases)) {
    fail("Smoke report cases must be an array.");
  }
}

function validateReportAgainstMetadata(
  report: WechatMinigameSmokeReport,
  metadata: WechatMinigameReleasePackageMetadata,
  expectedRevision: string | undefined
): void {
  validateReportShape(report);

  if (report.projectName !== metadata.projectName) {
    fail(`Smoke report projectName mismatch: expected ${metadata.projectName}, received ${report.projectName}.`);
  }
  if (report.appId !== metadata.appId) {
    fail(`Smoke report appId mismatch: expected ${metadata.appId}, received ${report.appId}.`);
  }
  if (report.artifact.archiveFileName !== metadata.archiveFileName) {
    fail(
      `Smoke report archiveFileName mismatch: expected ${metadata.archiveFileName}, received ${report.artifact.archiveFileName}.`
    );
  }
  if (report.artifact.archiveSha256 !== metadata.archiveSha256) {
    fail("Smoke report archiveSha256 does not match the release sidecar.");
  }

  const metadataRevision = metadata.sourceRevision;
  const reportRevision = report.artifact.sourceRevision;
  if (metadataRevision !== reportRevision) {
    fail(`Smoke report sourceRevision mismatch: expected ${metadataRevision ?? "<empty>"}, received ${reportRevision ?? "<empty>"}.`);
  }
  if (expectedRevision && metadataRevision !== expectedRevision) {
    fail(`Smoke report expected revision mismatch: expected ${expectedRevision}, sidecar=${metadataRevision ?? "<empty>"}.`);
  }

  const casesById = new Map(report.cases.map((entry) => [entry.id, entry]));
  for (const caseId of REQUIRED_CASE_IDS) {
    const entry = casesById.get(caseId);
    if (!entry) {
      fail(`Smoke report is missing required case ${caseId}.`);
    }
    if (!entry.required) {
      fail(`Smoke report case ${caseId} must remain required.`);
    }
    if (entry.status === "pending") {
      fail(`Smoke report case ${caseId} is still pending.`);
    }
  }

  if (!report.execution.tester.trim()) {
    fail("Smoke report tester must be filled before validation.");
  }
  if (!report.execution.device.trim()) {
    fail("Smoke report device must be filled before validation.");
  }
  if (!report.execution.executedAt.trim()) {
    fail("Smoke report executedAt must be filled before validation.");
  }
  if (report.execution.result === "pending") {
    fail("Smoke report execution.result must be passed or failed before validation.");
  }

  const hasFailedCase = report.cases.some((entry) => entry.status === "failed");
  if (report.execution.result === "passed" && hasFailedCase) {
    fail("Smoke report execution.result cannot be passed when at least one case failed.");
  }
}

function main(): void {
  const args = parseArgs(process.argv);
  const metadataPath = resolveMetadataPath(args);
  const metadata = readJsonFile<WechatMinigameReleasePackageMetadata>(metadataPath);
  const reportPath = resolveReportPath(args, metadataPath);

  if (args.check) {
    if (!fs.existsSync(reportPath)) {
      fail(`Smoke report does not exist: ${reportPath}`);
    }
    const report = readJsonFile<WechatMinigameSmokeReport>(reportPath);
    validateReportAgainstMetadata(report, metadata, args.expectedRevision);
    console.log(`Validated WeChat smoke report: ${reportPath}`);
    console.log(`Revision: ${metadata.sourceRevision ?? "<none>"}`);
    console.log(`Result: ${report.execution.result}`);
    console.log(`Tester: ${report.execution.tester}`);
    return;
  }

  if (fs.existsSync(reportPath) && !args.force) {
    fail(`Smoke report already exists: ${reportPath}. Pass --force to overwrite it.`);
  }

  const report = buildReportTemplate(metadata, metadataPath, reportPath);
  writeJsonFile(reportPath, report);
  console.log(`Wrote WeChat smoke report template: ${reportPath}`);
  console.log(`Artifact: ${metadata.archiveFileName}`);
  console.log(`Revision: ${metadata.sourceRevision ?? "<none>"}`);
}

main();
