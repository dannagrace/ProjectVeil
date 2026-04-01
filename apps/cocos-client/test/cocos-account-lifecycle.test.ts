import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCocosAccountLifecyclePanelView,
  buildCocosAccountLifecycleReadinessView
} from "../assets/scripts/cocos-account-lifecycle.ts";

test("buildCocosAccountLifecyclePanelView exposes registration dev-token guidance", () => {
  const view = buildCocosAccountLifecyclePanelView({
    kind: "registration",
    loginId: "veil-ranger",
    displayName: "暮潮守望",
    token: "dev-registration-token",
    password: "hunter2",
    deliveryMode: "dev-token",
    expiresAt: "2026-03-29T05:51:00.000Z"
  });

  assert.equal(view.title, "正式注册流程");
  assert.equal(view.fields[1]?.label, "注册昵称");
  assert.match(view.deliveryHint, /开发直返令牌模式/);
  assert.match(view.deliveryHint, /2026-03-29T05:51:00.000Z/);
  assert.equal(view.confirmLabel, "确认注册并进房");
  assert.equal(view.readiness.status, "ready");
  assert.equal(view.fields[2]?.readiness.status, "ready");
});

test("buildCocosAccountLifecyclePanelView exposes recovery external-delivery guidance", () => {
  const view = buildCocosAccountLifecyclePanelView({
    kind: "recovery",
    loginId: "veil-ranger",
    displayName: "",
    token: "",
    password: "",
    deliveryMode: "external",
    expiresAt: "2026-03-29T06:00:00.000Z"
  });

  assert.equal(view.title, "密码找回流程");
  assert.deepEqual(
    view.fields.map((field) => field.key),
    ["loginId", "token", "password"]
  );
  assert.match(view.deliveryHint, /外部投递模式/);
  assert.match(view.deliveryHint, /2026-03-29T06:00:00.000Z/);
  assert.equal(view.requestLabel, "申请找回令牌");
  assert.equal(view.readiness.status, "missing");
  assert.equal(view.fields[1]?.readiness.status, "blocked");
});

test("buildCocosAccountLifecycleReadinessView reports missing critical registration fields", () => {
  const readiness = buildCocosAccountLifecycleReadinessView({
    kind: "registration",
    loginId: "",
    displayName: "",
    token: "",
    password: "",
    deliveryMode: "idle"
  });

  assert.equal(readiness.status, "missing");
  assert.match(readiness.detail, /登录 ID/);
  assert.match(readiness.detail, /注册口令/);
});

test("buildCocosAccountLifecycleReadinessView reports blocked external token delivery once local fields are complete", () => {
  const readiness = buildCocosAccountLifecycleReadinessView({
    kind: "recovery",
    loginId: "veil-ranger",
    displayName: "",
    token: "",
    password: "hunter2",
    deliveryMode: "external",
    expiresAt: "2026-03-29T06:00:00.000Z"
  });

  assert.equal(readiness.status, "blocked");
  assert.match(readiness.detail, /等待外部渠道投递找回令牌/);
});
