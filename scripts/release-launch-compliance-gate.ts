import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

export type LaunchComplianceGateStatus = "pass" | "warn" | "fail";

export interface LaunchComplianceDocumentRecord {
  label: string;
  value?: string;
  version?: string;
  reviewedAt?: string;
  expiresAt?: string;
}

export interface LaunchComplianceDossier {
  gameTitle?: string;
  ownerEntity?: string;
  reviewedAt?: string;
  license?: LaunchComplianceDocumentRecord & {
    batchNumber?: string;
    issuedAt?: string;
  };
  icp?: LaunchComplianceDocumentRecord & {
    subject?: string;
  };
  policies?: {
    privacyPolicy?: LaunchComplianceDocumentRecord;
    termsOfService?: LaunchComplianceDocumentRecord;
    minorProtection?: LaunchComplianceDocumentRecord;
    dataExportNotice?: LaunchComplianceDocumentRecord;
  };
  identityVerification?: {
    vendorName?: string;
    sandboxCredential?: string;
    productionCredential?: string;
    reviewedAt?: string;
    expiresAt?: string;
  };
  paymentChannels?: {
    wechatPayMerchantId?: string;
    appleAppStoreAccount?: string;
    googlePlayDeveloperId?: string;
    reviewedAt?: string;
    expiresAt?: string;
  };
}

export interface LaunchComplianceGateCheck {
  id: string;
  label: string;
  status: LaunchComplianceGateStatus;
  summary: string;
  ownerHint?: string;
  evidence?: string[];
}

export interface LaunchComplianceGateReport {
  schemaVersion: 1;
  generatedAt: string;
  revision: {
    commit: string;
    shortCommit: string;
    branch: string;
  };
  status: LaunchComplianceGateStatus;
  dossierPath: string;
  summary: string;
  checks: LaunchComplianceGateCheck[];
}

interface Args {
  configPath?: string;
  outputPath?: string;
  markdownOutputPath?: string;
}

const DEFAULT_CONFIG_RELATIVE_PATH = path.join("configs", "launch-compliance.json");
const DEFAULT_OUTPUT_DIR = path.resolve("artifacts", "release-readiness");

function fail(message: string): never {
  throw new Error(message);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {};

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--config" && next) {
      args.configPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--output" && next) {
      args.outputPath = path.resolve(next);
      index += 1;
      continue;
    }
    if (arg === "--markdown-output" && next) {
      args.markdownOutputPath = path.resolve(next);
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${arg}`);
  }

  return args;
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function tryParseJson(value: string): LaunchComplianceDossier | null {
  try {
    const parsed = JSON.parse(value) as LaunchComplianceDossier;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function resolveLaunchComplianceConfigPath(args: Args = {}, env: NodeJS.ProcessEnv = process.env): string {
  if (args.configPath) {
    return args.configPath;
  }
  const envPath = normalizeString(env.VEIL_LAUNCH_COMPLIANCE_PATH);
  return envPath ? path.resolve(envPath) : path.resolve(DEFAULT_CONFIG_RELATIVE_PATH);
}

export function loadLaunchComplianceDossier(args: Args = {}, env: NodeJS.ProcessEnv = process.env): {
  dossier: LaunchComplianceDossier;
  configPath: string;
} {
  const inlineJson = normalizeString(env.VEIL_LAUNCH_COMPLIANCE_JSON);
  if (inlineJson) {
    const parsed = tryParseJson(inlineJson);
    if (!parsed) {
      fail("VEIL_LAUNCH_COMPLIANCE_JSON is not valid JSON.");
    }
    return {
      dossier: parsed,
      configPath: "<env:VEIL_LAUNCH_COMPLIANCE_JSON>"
    };
  }

  const configPath = resolveLaunchComplianceConfigPath(args, env);
  if (!fs.existsSync(configPath)) {
    fail(`Launch compliance config not found: ${configPath}`);
  }
  const parsed = tryParseJson(fs.readFileSync(configPath, "utf8"));
  if (!parsed) {
    fail(`Launch compliance config is not valid JSON: ${configPath}`);
  }
  return { dossier: parsed, configPath };
}

function dateState(value: string | undefined): "missing" | "invalid" | "ok" | "expired" {
  if (!value) {
    return "missing";
  }
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return "invalid";
  }
  return timestamp < Date.now() ? "expired" : "ok";
}

function resolveDocumentCheck(
  id: string,
  label: string,
  input: LaunchComplianceDocumentRecord | undefined,
  ownerHint: string,
  requiredFields: Array<{ key: keyof LaunchComplianceDocumentRecord; label: string }>
): LaunchComplianceGateCheck {
  const missing: string[] = [];
  for (const field of requiredFields) {
    if (!normalizeString(input?.[field.key])) {
      missing.push(field.label);
    }
  }

  const reviewedAtState = dateState(input?.reviewedAt);
  const expiresAtState = dateState(input?.expiresAt);
  const evidence = [
    input?.value ? `值：${input.value}` : null,
    input?.version ? `版本：${input.version}` : null,
    input?.reviewedAt ? `最近复核：${input.reviewedAt}` : null,
    input?.expiresAt ? `有效期至：${input.expiresAt}` : null
  ].filter((entry): entry is string => Boolean(entry));

  if (expiresAtState === "expired") {
    return {
      id,
      label,
      status: "fail",
      summary: `${label} 已过期，需要在上线前更新。`,
      ownerHint,
      evidence
    };
  }
  if (reviewedAtState === "invalid" || expiresAtState === "invalid") {
    return {
      id,
      label,
      status: "fail",
      summary: `${label} 的日期字段不是合法 ISO 时间。`,
      ownerHint,
      evidence
    };
  }
  if (missing.length > 0 || reviewedAtState === "missing") {
    return {
      id,
      label,
      status: "warn",
      summary: missing.length > 0
        ? `${label} 尚缺：${missing.join("、")}${reviewedAtState === "missing" ? "；缺少最近复核时间。" : "。"}`
        : `${label} 缺少最近复核时间。`,
      ownerHint,
      evidence
    };
  }

  return {
    id,
    label,
    status: "pass",
    summary: `${label} 已登记且在有效期内。`,
    ownerHint,
    evidence
  };
}

function resolveIdentityVerificationCheck(dossier: LaunchComplianceDossier): LaunchComplianceGateCheck {
  const record = dossier.identityVerification;
  const missing: string[] = [];
  if (!normalizeString(record?.vendorName)) missing.push("供应方名称");
  if (!normalizeString(record?.sandboxCredential)) missing.push("测试环境凭证");
  if (!normalizeString(record?.productionCredential)) missing.push("生产环境凭证");

  const reviewedAtState = dateState(record?.reviewedAt);
  const expiresAtState = dateState(record?.expiresAt);
  const evidence = [
    record?.vendorName ? `供应方：${record.vendorName}` : null,
    record?.sandboxCredential ? `测试凭证：${record.sandboxCredential}` : null,
    record?.productionCredential ? `生产凭证：${record.productionCredential}` : null,
    record?.reviewedAt ? `最近复核：${record.reviewedAt}` : null,
    record?.expiresAt ? `有效期至：${record.expiresAt}` : null
  ].filter((entry): entry is string => Boolean(entry));

  if (expiresAtState === "expired") {
    return {
      id: "identity-verification",
      label: "实名认证接入凭证",
      status: "fail",
      summary: "实名认证接入凭证已过期。",
      ownerHint: "法务 / 平台接入",
      evidence
    };
  }
  if (reviewedAtState === "invalid" || expiresAtState === "invalid") {
    return {
      id: "identity-verification",
      label: "实名认证接入凭证",
      status: "fail",
      summary: "实名认证接入凭证的日期字段格式无效。",
      ownerHint: "法务 / 平台接入",
      evidence
    };
  }
  if (missing.length > 0 || reviewedAtState === "missing") {
    return {
      id: "identity-verification",
      label: "实名认证接入凭证",
      status: "warn",
      summary: missing.length > 0
        ? `实名认证接入凭证尚缺：${missing.join("、")}${reviewedAtState === "missing" ? "；缺少最近复核时间。" : "。"}`
        : "实名认证接入凭证缺少最近复核时间。",
      ownerHint: "法务 / 平台接入",
      evidence
    };
  }
  return {
    id: "identity-verification",
    label: "实名认证接入凭证",
    status: "pass",
    summary: "实名认证接入凭证已登记。",
    ownerHint: "法务 / 平台接入",
    evidence
  };
}

function resolvePaymentChannelCheck(dossier: LaunchComplianceDossier): LaunchComplianceGateCheck {
  const record = dossier.paymentChannels;
  const missing: string[] = [];
  if (!normalizeString(record?.wechatPayMerchantId)) missing.push("微信支付商户号");
  if (!normalizeString(record?.appleAppStoreAccount)) missing.push("Apple App Store 账号");
  if (!normalizeString(record?.googlePlayDeveloperId)) missing.push("Google Play 开发者账号");

  const reviewedAtState = dateState(record?.reviewedAt);
  const expiresAtState = dateState(record?.expiresAt);
  const evidence = [
    record?.wechatPayMerchantId ? `微信支付：${record.wechatPayMerchantId}` : null,
    record?.appleAppStoreAccount ? `Apple：${record.appleAppStoreAccount}` : null,
    record?.googlePlayDeveloperId ? `Google Play：${record.googlePlayDeveloperId}` : null,
    record?.reviewedAt ? `最近复核：${record.reviewedAt}` : null,
    record?.expiresAt ? `有效期至：${record.expiresAt}` : null
  ].filter((entry): entry is string => Boolean(entry));

  if (expiresAtState === "expired") {
    return {
      id: "payment-channels",
      label: "支付渠道准入凭证",
      status: "fail",
      summary: "支付渠道准入凭证已过期。",
      ownerHint: "商务 / 财务",
      evidence
    };
  }
  if (reviewedAtState === "invalid" || expiresAtState === "invalid") {
    return {
      id: "payment-channels",
      label: "支付渠道准入凭证",
      status: "fail",
      summary: "支付渠道准入凭证的日期字段格式无效。",
      ownerHint: "商务 / 财务",
      evidence
    };
  }
  if (missing.length > 0 || reviewedAtState === "missing") {
    return {
      id: "payment-channels",
      label: "支付渠道准入凭证",
      status: "warn",
      summary: missing.length > 0
        ? `支付渠道准入凭证尚缺：${missing.join("、")}${reviewedAtState === "missing" ? "；缺少最近复核时间。" : "。"}`
        : "支付渠道准入凭证缺少最近复核时间。",
      ownerHint: "商务 / 财务",
      evidence
    };
  }
  return {
    id: "payment-channels",
    label: "支付渠道准入凭证",
    status: "pass",
    summary: "支付渠道准入凭证已登记。",
    ownerHint: "商务 / 财务",
    evidence
  };
}

function resolveOverallStatus(checks: LaunchComplianceGateCheck[]): LaunchComplianceGateStatus {
  if (checks.some((check) => check.status === "fail")) {
    return "fail";
  }
  if (checks.some((check) => check.status === "warn")) {
    return "warn";
  }
  return "pass";
}

function summarizeChecks(checks: LaunchComplianceGateCheck[]): string {
  const passCount = checks.filter((check) => check.status === "pass").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;
  const failCount = checks.filter((check) => check.status === "fail").length;
  return `通过 ${passCount} 项，警告 ${warnCount} 项，失败 ${failCount} 项。`;
}

function readGitRevision(): { commit: string; shortCommit: string; branch: string } {
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).stdout.trim() || "unknown";
  const shortCommit = spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).stdout.trim() || "unknown";
  const branch = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).stdout.trim() || "unknown";
  return { commit, shortCommit, branch };
}

export function buildLaunchComplianceGateReport(
  dossier: LaunchComplianceDossier,
  configPath: string,
  revision = readGitRevision()
): LaunchComplianceGateReport {
  const checks: LaunchComplianceGateCheck[] = [
    resolveDocumentCheck(
      "license",
      "版号材料",
      {
        ...dossier.license,
        value: normalizeString(dossier.license?.value) ?? normalizeString(dossier.license?.batchNumber)
      },
      "法务 / 出版运营",
      [
        { key: "value", label: "版号编号" },
        { key: "version", label: "批次号" }
      ]
    ),
    resolveDocumentCheck(
      "icp",
      "ICP 备案",
      {
        ...dossier.icp,
        value: normalizeString(dossier.icp?.value) ?? normalizeString(dossier.icp?.subject)
      },
      "法务 / 网站备案",
      [
        { key: "value", label: "ICP备案号" },
        { key: "version", label: "备案主体" }
      ]
    ),
    resolveDocumentCheck(
      "privacy-policy",
      "隐私政策",
      dossier.policies?.privacyPolicy,
      "法务 / 隐私合规",
      [
        { key: "value", label: "URL" },
        { key: "version", label: "版本号" }
      ]
    ),
    resolveDocumentCheck(
      "terms-of-service",
      "用户协议",
      dossier.policies?.termsOfService,
      "法务 / 用户协议",
      [
        { key: "value", label: "URL" },
        { key: "version", label: "版本号" }
      ]
    ),
    resolveDocumentCheck(
      "minor-protection",
      "未成年人保护说明",
      dossier.policies?.minorProtection,
      "法务 / 未成年保护",
      [
        { key: "value", label: "URL" },
        { key: "version", label: "版本号" }
      ]
    ),
    resolveDocumentCheck(
      "data-export-notice",
      "数据出境公示",
      dossier.policies?.dataExportNotice,
      "法务 / 数据合规",
      [
        { key: "value", label: "URL" },
        { key: "version", label: "版本号" }
      ]
    ),
    resolveIdentityVerificationCheck(dossier),
    resolvePaymentChannelCheck(dossier)
  ];

  const status = resolveOverallStatus(checks);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision,
    status,
    dossierPath: configPath,
    summary:
      status === "pass"
        ? `上线合规材料齐备。${summarizeChecks(checks)}`
        : status === "warn"
          ? `上线合规材料仍有待补全项。${summarizeChecks(checks)}`
          : `上线合规材料存在阻塞问题。${summarizeChecks(checks)}`,
    checks
  };
}

export function renderLaunchComplianceGateMarkdown(report: LaunchComplianceGateReport): string {
  const lines = [
    "# Launch Compliance Gate",
    "",
    `- Revision: \`${report.revision.shortCommit}\``,
    `- Generated at: \`${report.generatedAt}\``,
    `- Config: \`${report.dossierPath}\``,
    `- Status: \`${report.status.toUpperCase()}\``,
    `- Summary: ${report.summary}`,
    "",
    "## Checks",
    ""
  ];

  for (const check of report.checks) {
    lines.push(`### ${check.label}`);
    lines.push(`- Status: \`${check.status.toUpperCase()}\``);
    lines.push(`- Summary: ${check.summary}`);
    if (check.ownerHint) {
      lines.push(`- Owner hint: ${check.ownerHint}`);
    }
    if ((check.evidence?.length ?? 0) > 0) {
      lines.push("- Evidence:");
      for (const item of check.evidence ?? []) {
        lines.push(`  - ${item}`);
      }
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function resolveOutputPaths(args: Args, revision: { shortCommit: string }): { json: string; markdown: string } {
  return {
    json: args.outputPath ?? path.join(DEFAULT_OUTPUT_DIR, `launch-compliance-gate-${revision.shortCommit}.json`),
    markdown: args.markdownOutputPath ?? path.join(DEFAULT_OUTPUT_DIR, `launch-compliance-gate-${revision.shortCommit}.md`)
  };
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}

export async function runLaunchComplianceGateCli(argv = process.argv, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const args = parseArgs(argv);
  const { dossier, configPath } = loadLaunchComplianceDossier(args, env);
  const report = buildLaunchComplianceGateReport(dossier, configPath);
  const outputs = resolveOutputPaths(args, report.revision);

  writeFile(outputs.json, `${JSON.stringify(report, null, 2)}\n`);
  writeFile(outputs.markdown, renderLaunchComplianceGateMarkdown(report));

  console.log(`Wrote launch compliance gate JSON: ${path.relative(process.cwd(), outputs.json).replace(/\\/g, "/")}`);
  console.log(`Wrote launch compliance gate Markdown: ${path.relative(process.cwd(), outputs.markdown).replace(/\\/g, "/")}`);
  console.log(`Launch compliance status: ${report.status.toUpperCase()} - ${report.summary}`);

  return report.status === "fail" ? 1 : 0;
}

const executedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (executedDirectly) {
  runLaunchComplianceGateCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
