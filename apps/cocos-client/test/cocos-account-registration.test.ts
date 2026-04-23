import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosAccountRegistrationPanelView } from "../assets/scripts/cocos-account-registration.ts";

function createDraft(overrides: Partial<Parameters<typeof buildCocosAccountRegistrationPanelView>[0]["draft"]> = {}) {
  return {
    kind: "registration" as const,
    loginId: "",
    displayName: "",
    token: "",
    password: "",
    deliveryMode: "idle" as const,
    ...overrides
  };
}

test("buildCocosAccountRegistrationPanelView reports the empty registration form", () => {
  const view = buildCocosAccountRegistrationPanelView({
    draft: createDraft(),
    privacyConsentAccepted: false,
    showValidationErrors: true,
    wechat: {
      supported: true,
      available: true,
      bound: false,
      minorProtectionSelection: "unknown"
    }
  });

  assert.equal(view.readiness.status, "missing");
  assert.equal(view.validationError?.field, "loginId");
  assert.equal(view.status?.tone, "negative");
  assert.match(view.status?.message ?? "", /登录 ID/);
  assert.equal(view.identities[0]?.status, "available");
  assert.equal(view.bindWechatAction.enabled, false);
});

test("buildCocosAccountRegistrationPanelView surfaces validation errors for malformed registration drafts", () => {
  const view = buildCocosAccountRegistrationPanelView({
    draft: createDraft({
      loginId: "BAD ID",
      token: "dev-registration-token",
      password: "hunter22"
    }),
    privacyConsentAccepted: true,
    showValidationErrors: true,
    wechat: {
      supported: true,
      available: true,
      bound: false,
      minorProtectionSelection: "adult"
    }
  });

  assert.equal(view.validationError?.field, "loginId");
  assert.match(view.validationError?.message ?? "", /3-40 位小写字母/);
  assert.equal(view.status?.tone, "negative");
});

test("buildCocosAccountRegistrationPanelView disables submission actions while work is in progress", () => {
  const view = buildCocosAccountRegistrationPanelView({
    draft: createDraft({
      loginId: "veil-ranger",
      displayName: "暮潮守望",
      token: "dev-registration-token",
      password: "hunter22",
      deliveryMode: "dev-token"
    }),
    privacyConsentAccepted: true,
    submitState: "binding-wechat",
    registeredAccount: {
      loginId: "veil-ranger",
      credentialBoundAt: "2026-04-10T07:00:00.000Z",
      provider: "account-password"
    },
    wechat: {
      supported: true,
      available: true,
      bound: false,
      minorProtectionSelection: "minor"
    }
  });

  assert.equal(view.status?.tone, "neutral");
  assert.match(view.status?.message ?? "", /绑定微信小游戏身份/);
  assert.equal(view.minorProtectionAction?.enabled, false);
  assert.equal(view.bindWechatAction.enabled, false);
  assert.equal(view.bindWechatAction.label, "绑定中...");
});

test("buildCocosAccountRegistrationPanelView exposes bound identities after registration succeeds", () => {
  const view = buildCocosAccountRegistrationPanelView({
    draft: createDraft({
      loginId: "veil-ranger",
      displayName: "暮潮守望",
      token: "dev-registration-token",
      password: "hunter22",
      deliveryMode: "dev-token"
    }),
    privacyConsentAccepted: true,
    submitState: "success",
    statusMessage: "正式账号注册成功，微信身份已绑定。",
    registeredAccount: {
      loginId: "veil-ranger",
      credentialBoundAt: "2026-04-10T07:00:00.000Z",
      provider: "wechat-mini-game"
    },
    wechat: {
      supported: true,
      available: true,
      bound: true,
      minorProtectionSelection: "adult"
    }
  });

  assert.equal(view.status?.tone, "positive");
  assert.equal(view.identities.map((identity) => identity.status).join(","), "bound,bound");
  assert.equal(view.bindWechatAction.label, "微信身份已绑定");
  assert.equal(view.minorProtection, null);
});
