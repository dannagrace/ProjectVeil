import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(golden-path-player-journey|lobby-smoke|reconnect-prediction-convergence)\.spec\.ts/,
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
