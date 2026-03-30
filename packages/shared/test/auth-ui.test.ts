import assert from "node:assert/strict";
import test from "node:test";
import {
  describeAccountAuthFailure,
  normalizeAccountLoginIdDraft,
  validateAccountLifecycleConfirm,
  validateAccountLifecycleRequest,
  validateAccountPassword
} from "../src/auth-ui.ts";

test("auth ui helper normalizes login IDs and rejects malformed drafts", () => {
  assert.equal(normalizeAccountLoginIdDraft(" Veil-Ranger "), "veil-ranger");
  assert.deepEqual(validateAccountLifecycleRequest("registration", " A "), {
    field: "loginId",
    message: "登录 ID 需为 3-40 位小写字母、数字、下划线或连字符。"
  });
  assert.equal(validateAccountLifecycleRequest("recovery", "veil_ranger-1"), null);
});

test("auth ui helper validates confirm drafts for registration and recovery", () => {
  assert.deepEqual(
    validateAccountLifecycleConfirm("registration", {
      loginId: "veil-ranger",
      token: "",
      password: "hunter2"
    }),
    {
      field: "token",
      message: "请先申请并填写注册令牌。"
    }
  );

  assert.deepEqual(
    validateAccountLifecycleConfirm("recovery", {
      loginId: "veil-ranger",
      token: "dev-recovery-token",
      password: "123"
    }),
    {
      field: "password",
      message: "新口令至少 6 位。"
    }
  );

  assert.equal(
    validateAccountLifecycleConfirm("registration", {
      loginId: "veil-ranger",
      token: "dev-registration-token",
      password: "hunter2"
    }),
    null
  );
});

test("auth ui helper validates password labels and maps server failures", () => {
  assert.deepEqual(validateAccountPassword(" ", "password", "账号口令"), {
    field: "password",
    message: "请输入账号口令。"
  });

  assert.equal(
    describeAccountAuthFailure({ status: 403, code: "account_locked" }),
    "该账号因连续失败已被临时锁定，请稍后再试。"
  );
  assert.equal(
    describeAccountAuthFailure({ status: 429, code: "too_many_requests" }),
    "请求过于频繁，请稍后再试。"
  );
  assert.equal(
    describeAccountAuthFailure(
      { status: 401, code: "invalid_registration_token" },
      { invalidTokenCode: "invalid_registration_token" }
    ),
    "令牌无效或已过期，请重新申请后再确认。"
  );
});
