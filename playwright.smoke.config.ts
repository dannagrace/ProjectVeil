import { defineConfig } from "@playwright/test";

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

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(daily-quest-claim|lobby-smoke|onboarding-funnel|reconnect-prediction-convergence|seasonal-event-lifecycle)\.spec\.ts/,
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: [
    {
      command: "npm run dev:server",
      env: {
        ...process.env,
        ANALYTICS_ENDPOINT: "http://127.0.0.1:2567/api/analytics/events",
        VEIL_ADMIN_TOKEN: process.env.VEIL_ADMIN_TOKEN ?? "dev-admin-token",
        VEIL_DAILY_QUESTS_ENABLED: "1",
        VEIL_DAILY_QUEST_ROTATIONS_JSON: DAILY_QUEST_SMOKE_ROTATIONS
      },
      port: 2567,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      gracefulShutdown: {
        signal: "SIGTERM",
        timeout: 5_000
      }
    },
    {
      command: "npm run dev:client",
      port: 4173,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      gracefulShutdown: {
        signal: "SIGTERM",
        timeout: 5_000
      }
    }
  ]
});
