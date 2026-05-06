import { createHash } from "node:crypto";
import path from "node:path";
import { defineConfig, type Project, type ReporterDescription, type WebServerPlugin } from "@playwright/test";

const DAILY_QUEST_SMOKE_ROTATIONS = JSON.stringify({
  schemaVersion: 1,
  rotations: [
    {
      id: "smoke-daily-quest-claim",
      label: "Smoke Daily Quest Claim",
      schedule: {
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        weekdays: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
      },
      quests: [
        {
          id: "smoke_resource_pickup",
          title: "补给起步",
          description: "完成 1 次资源收集。",
          metric: "resource_collections",
          target: 1,
          reward: {
            gems: 2,
            gold: 35
          }
        },
        {
          id: "smoke_pathfinder",
          title: "先遣步伐",
          description: "完成 3 次探索移动。",
          metric: "hero_moves",
          target: 3,
          reward: {
            gems: 3,
            gold: 40
          }
        },
        {
          id: "smoke_first_battle",
          title: "试锋一战",
          description: "取得 1 场战斗胜利。",
          metric: "battle_wins",
          target: 1,
          reward: {
            gems: 5,
            gold: 60
          }
        }
      ]
    }
  ]
});

type ProjectDefinition = Project & { name: string };

const DEFAULT_SERVER_PORT = 2567;
const DEFAULT_CLIENT_PORT = 4173;
const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_CLIENT_HOST = "127.0.0.1";

function readPort(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function derivePort(base: number, span = 300): number {
  const seed = process.env.VEIL_PLAYWRIGHT_WORKSPACE_SEED?.trim() || `${process.cwd()}:${process.pid}`;
  const hash = createHash("sha1").update(seed).digest();
  const offset = ((hash[0] << 8) | hash[1]) % span;
  return base + offset;
}

function normalizeOrigin(value: string | undefined, fallbackHost: string, fallbackPort: number, protocol: "http" | "ws"): string {
  return value?.trim() || `${protocol}://${fallbackHost}:${fallbackPort}`;
}

const serverPort = readPort(
  "VEIL_PLAYWRIGHT_SERVER_PORT",
  process.env.VEIL_PLAYWRIGHT_REUSE_SERVER === "1" ? DEFAULT_SERVER_PORT : derivePort(DEFAULT_SERVER_PORT)
);
const clientPort = readPort(
  "VEIL_PLAYWRIGHT_CLIENT_PORT",
  process.env.VEIL_PLAYWRIGHT_REUSE_SERVER === "1" ? DEFAULT_CLIENT_PORT : derivePort(DEFAULT_CLIENT_PORT)
);
const serverOrigin = normalizeOrigin(process.env.VEIL_PLAYWRIGHT_SERVER_ORIGIN, DEFAULT_SERVER_HOST, serverPort, "http");
const serverWsOrigin = normalizeOrigin(process.env.VEIL_PLAYWRIGHT_SERVER_WS_URL, DEFAULT_SERVER_HOST, serverPort, "ws");
const clientOrigin = normalizeOrigin(process.env.VEIL_PLAYWRIGHT_CLIENT_ORIGIN, DEFAULT_CLIENT_HOST, clientPort, "http");
const runId = process.env.VEIL_PLAYWRIGHT_RUN_ID?.trim() || `${path.basename(process.cwd())}-${process.pid}`;
const playwrightOutputDir = process.env.PLAYWRIGHT_OUTPUT_DIR?.trim() || path.join("test-results", runId);
const playwrightReportDir = process.env.PLAYWRIGHT_HTML_REPORT?.trim() || path.join("playwright-report", runId);
const adminToken = process.env.VEIL_ADMIN_TOKEN?.trim() || "dev-admin-token";
const adminSecret = process.env.ADMIN_SECRET?.trim() || adminToken;

process.env.VEIL_PLAYWRIGHT_SERVER_PORT = String(serverPort);
process.env.VEIL_PLAYWRIGHT_CLIENT_PORT = String(clientPort);
process.env.VEIL_PLAYWRIGHT_SERVER_ORIGIN = serverOrigin;
process.env.VEIL_PLAYWRIGHT_SERVER_WS_URL = serverWsOrigin;
process.env.VEIL_PLAYWRIGHT_CLIENT_ORIGIN = clientOrigin;
process.env.VEIL_ADMIN_TOKEN = adminToken;
process.env.VEIL_ENABLE_TEST_ENDPOINTS = process.env.VEIL_ENABLE_TEST_ENDPOINTS?.trim() || "1";

const SMOKE_PROJECT_NAME = "smoke";
const H5_CONNECTIVITY_PROJECT_NAME = "h5-connectivity";
const MULTIPLAYER_PROJECT_NAME = "multiplayer";
const MULTIPLAYER_SMOKE_PROJECT_NAME = "multiplayer-smoke";
const RELEASE_CANDIDATE_ARTIFACT_PROJECT_NAME = "release-candidate-artifact-smoke";
const FULL_PROJECT_NAME = "full";

const SHARED_REPORTER: ReporterDescription[] = [
  ["list"],
  ["html", { open: "never", outputFolder: playwrightReportDir }]
];

const SMOKE_TEST_MATCH =
  /(campaign-mission-flow|daily-quest-claim|golden-path-player-journey|lobby-smoke|onboarding-funnel|reconnect-prediction-convergence|seasonal-event-lifecycle)\.spec\.ts/;
const H5_CONNECTIVITY_TEST_MATCH = /h5-connectivity-smoke\.spec\.ts/;
const MULTIPLAYER_TEST_MATCH =
  /(multiplayer-sync|multiplayer-stress|reconnect-recovery|pvp-hero-encounter|pvp-reconnect-recovery|pvp-postbattle-reconnect|pvp-postbattle-continue|pvp-matchmaking-lifecycle|leaderboard-ranked-season|battle-replay-smoke)\.spec\.ts/;
const MULTIPLAYER_SMOKE_TEST_MATCH = /(multiplayer-sync|pvp-hero-encounter|battle-replay-smoke)\.spec\.ts/;
const RELEASE_CANDIDATE_ARTIFACT_TEST_MATCH = /release-candidate-artifact-smoke\.spec\.ts/;
const FULL_TEST_IGNORE =
  /(multiplayer-sync|multiplayer-stress|reconnect-recovery|pvp-hero-encounter|pvp-reconnect-recovery|pvp-postbattle-reconnect|pvp-postbattle-continue|pvp-matchmaking-lifecycle|leaderboard-ranked-season|battle-replay-smoke|release-candidate-artifact-smoke)\.spec\.ts/;

const ALL_PROJECTS: ProjectDefinition[] = [
  {
    name: FULL_PROJECT_NAME,
    testIgnore: FULL_TEST_IGNORE,
    workers: 1
  },
  {
    name: SMOKE_PROJECT_NAME,
    testMatch: SMOKE_TEST_MATCH,
    retries: process.env.CI ? 2 : 0,
    workers: 1
  },
  {
    name: H5_CONNECTIVITY_PROJECT_NAME,
    testMatch: H5_CONNECTIVITY_TEST_MATCH,
    retries: process.env.CI ? 2 : 0,
    workers: 1
  },
  {
    name: MULTIPLAYER_PROJECT_NAME,
    testMatch: MULTIPLAYER_TEST_MATCH,
    workers: 1
  },
  {
    name: MULTIPLAYER_SMOKE_PROJECT_NAME,
    testMatch: MULTIPLAYER_SMOKE_TEST_MATCH,
    retries: process.env.CI ? 1 : 0,
    workers: 1
  },
  {
    name: RELEASE_CANDIDATE_ARTIFACT_PROJECT_NAME,
    testMatch: RELEASE_CANDIDATE_ARTIFACT_TEST_MATCH,
    workers: 1
  }
];

function shouldReuseServers(): boolean {
  return process.env.VEIL_PLAYWRIGHT_REUSE_SERVER === "1" && !process.env.CI;
}

function resolveClientCommand(): string {
  if (process.env.VEIL_PLAYWRIGHT_CLIENT_MODE === "preview") {
    return `npx vite preview --config apps/client/vite.config.ts --host ${DEFAULT_CLIENT_HOST} --port ${clientPort} --strictPort`;
  }
  return "npm run dev -- client:h5";
}

function createSharedWebServers(): WebServerPlugin[] {
  const reuseExistingServer = shouldReuseServers();

  return [
    {
      command: "npm run dev -- server",
      env: {
        ...process.env,
        PORT: String(serverPort),
        ANALYTICS_ENDPOINT: `${serverOrigin}/api/test/analytics/events`,
        ANALYTICS_SINK: "http",
        ADMIN_SECRET: adminSecret,
        VEIL_ADMIN_TOKEN: adminToken,
        VEIL_ENABLE_TEST_ENDPOINTS: "1",
        VEIL_DAILY_QUESTS_ENABLED: "1",
        VEIL_DAILY_QUEST_ROTATIONS_JSON: DAILY_QUEST_SMOKE_ROTATIONS,
        VEIL_RATE_LIMIT_AUTH_MAX: process.env.VEIL_RATE_LIMIT_AUTH_MAX ?? "120",
        VEIL_RATE_LIMIT_HTTP_GLOBAL_MAX: process.env.VEIL_RATE_LIMIT_HTTP_GLOBAL_MAX ?? "2000",
        VEIL_RATE_LIMIT_HTTP_ADMIN_MAX: process.env.VEIL_RATE_LIMIT_HTTP_ADMIN_MAX ?? "200",
        VEIL_RATE_LIMIT_WS_ACTION_MAX: process.env.VEIL_RATE_LIMIT_WS_ACTION_MAX ?? "40"
      },
      port: serverPort,
      reuseExistingServer,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      gracefulShutdown: {
        signal: "SIGTERM",
        timeout: 5_000
      }
    },
    {
      command: resolveClientCommand(),
      env: {
        ...process.env,
        VEIL_PLAYWRIGHT_CLIENT_PORT: String(clientPort),
        VEIL_DEV_SERVER_HTTP_URL: serverOrigin,
        VITE_VEIL_SERVER_HTTP_URL: serverOrigin,
        VITE_VEIL_SERVER_WS_URL: serverWsOrigin
      },
      port: clientPort,
      reuseExistingServer,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      gracefulShutdown: {
        signal: "SIGTERM",
        timeout: 5_000
      }
    }
  ];
}

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: playwrightOutputDir,
  timeout: 30_000,
  fullyParallel: false,
  reporter: SHARED_REPORTER,
  use: {
    baseURL: clientOrigin,
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: createSharedWebServers(),
  projects: ALL_PROJECTS
});
