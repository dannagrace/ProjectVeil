import { chromium } from "@playwright/test";

async function globalSetup() {
  // This setup runs once before all tests
  // We could do global initialization here if needed
  console.log("E2E tests global setup running");
}

export default globalSetup;
