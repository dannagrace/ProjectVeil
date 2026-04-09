import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch:
    /(multiplayer-sync|multiplayer-stress|reconnect-recovery|pvp-hero-encounter|pvp-reconnect-recovery|pvp-postbattle-reconnect|pvp-postbattle-continue|pvp-matchmaking-lifecycle|battle-replay-smoke)\.spec\.ts/,
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
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
