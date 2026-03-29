import assert from "node:assert/strict";
import test from "node:test";
import { startH5ClientApp } from "../src/main-entry";

test("startH5ClientApp kicks off H5 boot and registers automation hooks without waiting for boot completion", async () => {
  const events: string[] = [];
  let resolveBootstrap!: () => void;

  startH5ClientApp({
    bootstrapApp: () =>
      new Promise<void>((resolve) => {
        events.push("bootstrap:start");
        resolveBootstrap = () => {
          events.push("bootstrap:resolved");
          resolve();
        };
      }),
    registerAutomationHooks: () => {
      events.push("registerAutomationHooks");
    }
  });

  assert.deepEqual(events, ["bootstrap:start", "registerAutomationHooks"]);
  resolveBootstrap();
  await Promise.resolve();
  assert.deepEqual(events, ["bootstrap:start", "registerAutomationHooks", "bootstrap:resolved"]);
});

test("startH5ClientApp reports boot failures while still wiring automation hooks", async () => {
  const events: string[] = [];
  const boom = new Error("boot_failed");

  startH5ClientApp({
    bootstrapApp: async () => {
      events.push("bootstrap:start");
      throw boom;
    },
    registerAutomationHooks: () => {
      events.push("registerAutomationHooks");
    },
    reportBootstrapError: (error) => {
      events.push(`reportBootstrapError:${error === boom}`);
    }
  });

  await Promise.resolve();
  assert.deepEqual(events, ["bootstrap:start", "registerAutomationHooks", "reportBootstrapError:true"]);
});
