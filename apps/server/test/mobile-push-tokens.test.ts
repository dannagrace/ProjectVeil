import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMobilePushTokenRegistration, normalizeMobilePushTokenRegistrations } from "../src/mobile-push-tokens";

test("normalizeMobilePushTokenRegistration normalizes ios platform and trims token values", () => {
  assert.deepEqual(
    normalizeMobilePushTokenRegistration({
      platform: "  iOS  ",
      token: "  apns-token  ",
      registeredAt: "2026-04-10T11:30:00-05:00",
      updatedAt: "2026-04-11T09:15:00-05:00"
    }),
    {
      platform: "ios",
      token: "apns-token",
      registeredAt: "2026-04-10T16:30:00.000Z",
      updatedAt: "2026-04-11T14:15:00.000Z"
    }
  );
});

test("normalizeMobilePushTokenRegistration normalizes android platform", () => {
  const now = "2026-04-13T02:15:30.000Z";
  assert.deepEqual(
    normalizeMobilePushTokenRegistration(
      {
        platform: " ANDROID ",
        token: " fcm-token "
      },
      now
    ),
    {
      platform: "android",
      token: "fcm-token",
      registeredAt: now,
      updatedAt: now
    }
  );
});

test("normalizeMobilePushTokenRegistration rejects unsupported platforms", () => {
  assert.throws(
    () => normalizeMobilePushTokenRegistration({ platform: "web", token: "device-token" }),
    /platform must be ios or android/
  );
});

test("normalizeMobilePushTokenRegistration rejects empty tokens after trimming", () => {
  assert.throws(
    () => normalizeMobilePushTokenRegistration({ platform: "ios", token: "   " }),
    /token must not be empty/
  );
});

test("normalizeMobilePushTokenRegistration accepts a token at the 4096 character cap", () => {
  const token = "a".repeat(4096);
  assert.equal(normalizeMobilePushTokenRegistration({ platform: "ios", token }).token, token);
});

test("normalizeMobilePushTokenRegistration rejects tokens over the 4096 character cap", () => {
  assert.throws(
    () => normalizeMobilePushTokenRegistration({ platform: "android", token: "a".repeat(4097) }),
    /4096 characters or fewer/
  );
});

test("normalizeMobilePushTokenRegistration falls back registeredAt and updatedAt to now when blank", () => {
  const now = "2026-04-13T02:15:30.000Z";
  assert.deepEqual(
    normalizeMobilePushTokenRegistration(
      {
        platform: "android",
        token: "fcm-token",
        registeredAt: "   ",
        updatedAt: ""
      },
      now
    ),
    {
      platform: "android",
      token: "fcm-token",
      registeredAt: now,
      updatedAt: now
    }
  );
});

test("normalizeMobilePushTokenRegistrations returns undefined for null input", () => {
  assert.equal(normalizeMobilePushTokenRegistrations(null), undefined);
});

test("normalizeMobilePushTokenRegistrations filters structurally invalid entries and normalizes valid ones", () => {
  assert.deepEqual(
    normalizeMobilePushTokenRegistrations([
      null,
      {} as never,
      { platform: "ios" } as never,
      { token: "missing-platform" } as never,
      {
        platform: " android ",
        token: " fcm-token ",
        registeredAt: "2026-04-13T03:00:00.000Z",
        updatedAt: "2026-04-13T03:05:00.000Z"
      },
      { platform: 42 as never, token: "wrong-type" }
    ]),
    [
      {
        platform: "android",
        token: "fcm-token",
        registeredAt: "2026-04-13T03:00:00.000Z",
        updatedAt: "2026-04-13T03:05:00.000Z"
      }
    ]
  );
});

test("normalizeMobilePushTokenRegistrations keeps the last registration per normalized platform", () => {
  assert.deepEqual(
    normalizeMobilePushTokenRegistrations([
      {
        platform: " iOS ",
        token: "first-token",
        registeredAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z"
      },
      {
        platform: "ios",
        token: "second-token",
        registeredAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z"
      }
    ]),
    [
      {
        platform: "ios",
        token: "second-token",
        registeredAt: "2026-04-11T00:00:00.000Z",
        updatedAt: "2026-04-11T00:00:00.000Z"
      }
    ]
  );
});
