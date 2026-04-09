import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveCampaignConfig } from "../apps/server/src/pve-content.ts";
import { resolveContentPackMapPack } from "./content-pack-map-packs.ts";
import { buildContentPackCliReport, type ContentPackCliReport } from "./validate-content-pack.ts";

interface CampaignConfigDocument {
  missions?: unknown[];
}

interface ContentSmokeGateReport {
  schemaVersion: 1;
  generatedAt: string;
  rootDir: string;
  valid: boolean;
  campaign: {
    valid: boolean;
    missionCount: number;
    chapterCount: number;
    bossMissionCount: number;
    representativeBossMission: {
      id: string;
      chapterId: string;
      mapId: string;
      bossTemplateId: string;
    };
  };
  contentPack: {
    valid: boolean;
    bundleCount: number;
    validatedBundleIds: string[];
    issueCount: number;
    representativeBossMapPackId: string;
  };
}

const CAMPAIGN_CHAPTER_FILES = [
  "campaign-chapter1.json",
  "campaign-chapter2.json",
  "campaign-chapter3.json",
  "campaign-chapter4.json",
  "campaign-chapter5.json",
  "campaign-chapter6.json"
] as const;

function parseArgs(argv: string[]): { rootDir: string; reportPath: string | null } {
  let rootDir = resolve(process.cwd(), "configs");
  let reportPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root-dir") {
      rootDir = resolve(argv[index + 1] ?? rootDir);
      index += 1;
    } else if (arg === "--report-path") {
      reportPath = resolve(argv[index + 1] ?? "");
      index += 1;
    }
  }

  return { rootDir, reportPath };
}

async function readJsonConfig<T>(rootDir: string, fileName: string): Promise<T> {
  return JSON.parse(await readFile(resolve(rootDir, fileName), "utf8")) as T;
}

async function loadCampaignDocuments(rootDir: string): Promise<CampaignConfigDocument[]> {
  return Promise.all(CAMPAIGN_CHAPTER_FILES.map((fileName) => readJsonConfig<CampaignConfigDocument>(rootDir, fileName)));
}

async function buildContentSmokeGateReport(rootDir: string): Promise<ContentSmokeGateReport> {
  const campaignDocuments = await loadCampaignDocuments(rootDir);
  const missions = resolveCampaignConfig(campaignDocuments);
  const bossMissions = missions.filter((mission) => mission.bossTemplateId);
  const representativeBossMission = bossMissions[0];

  if (!representativeBossMission?.bossTemplateId) {
    throw new Error("campaign config must define at least one boss-enabled mission");
  }

  const representativeBossMapPack = resolveContentPackMapPack(representativeBossMission.mapId);
  if (!representativeBossMapPack) {
    throw new Error(
      `campaign mission ${representativeBossMission.id} references unsupported map pack ${representativeBossMission.mapId}`
    );
  }

  const contentPackReport: ContentPackCliReport = await buildContentPackCliReport({
    rootDir,
    extraMapPacks: representativeBossMapPack.id === "default" ? [] : [representativeBossMapPack]
  });

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootDir,
    valid: contentPackReport.valid,
    campaign: {
      valid: true,
      missionCount: missions.length,
      chapterCount: new Set(missions.map((mission) => mission.chapterId)).size,
      bossMissionCount: bossMissions.length,
      representativeBossMission: {
        id: representativeBossMission.id,
        chapterId: representativeBossMission.chapterId,
        mapId: representativeBossMission.mapId,
        bossTemplateId: representativeBossMission.bossTemplateId
      }
    },
    contentPack: {
      valid: contentPackReport.valid,
      bundleCount: contentPackReport.bundleCount,
      validatedBundleIds: contentPackReport.bundles.map((bundle) => bundle.id),
      issueCount: contentPackReport.authoringValidation.issueCount + contentPackReport.contentPack.issueCount,
      representativeBossMapPackId: representativeBossMapPack.id
    }
  };
}

function printReport(report: ContentSmokeGateReport): void {
  console.log("Project Veil content smoke gate");
  console.log(`Root: ${report.rootDir}`);
  console.log(`Result: ${report.valid ? "PASS" : "FAIL"}`);
  console.log(
    `Campaign smoke: PASS (${report.campaign.missionCount} missions across ${report.campaign.chapterCount} chapters; ${report.campaign.bossMissionCount} boss mission(s))`
  );
  console.log(
    `Representative boss scenario: ${report.campaign.representativeBossMission.id} (${report.campaign.representativeBossMission.mapId}, ${report.campaign.representativeBossMission.bossTemplateId})`
  );
  console.log(
    `Content-pack smoke: ${report.contentPack.valid ? "PASS" : "FAIL"} (${report.contentPack.bundleCount} bundle(s): ${report.contentPack.validatedBundleIds.join(", ")})`
  );
}

async function main(): Promise<void> {
  const { rootDir, reportPath } = parseArgs(process.argv.slice(2));
  const report = await buildContentSmokeGateReport(rootDir);
  printReport(report);

  if (reportPath) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Report written to ${reportPath}`);
  }

  if (!report.valid) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(`Content smoke gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { buildContentSmokeGateReport };
