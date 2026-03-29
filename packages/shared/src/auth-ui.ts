export interface AccountAuthRequestFailure {
  status: number;
  code: string;
}

export type AccountLifecycleKind = "registration" | "recovery";
export type AccountLifecycleValidationField = "loginId" | "token" | "password";

export interface AccountLifecycleDraft {
  loginId: string;
  token: string;
  password: string;
}

export interface AccountLifecycleValidationError {
  field: AccountLifecycleValidationField;
  message: string;
}

const LOGIN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{2,39}$/;
const MIN_PASSWORD_LENGTH = 6;

export function normalizeAccountLoginIdDraft(loginId: string): string {
  return loginId.trim().toLowerCase();
}

export function validateAccountLoginId(loginId: string): AccountLifecycleValidationError | null {
  const normalized = normalizeAccountLoginIdDraft(loginId);
  if (!normalized) {
    return {
      field: "loginId",
      message: "请输入登录 ID。"
    };
  }

  if (!LOGIN_ID_PATTERN.test(normalized)) {
    return {
      field: "loginId",
      message: "登录 ID 需为 3-40 位小写字母、数字、下划线或连字符。"
    };
  }

  return null;
}

export function validateAccountPassword(
  password: string,
  field: Extract<AccountLifecycleValidationField, "password">,
  label: string
): AccountLifecycleValidationError | null {
  const normalized = password.trim();
  if (!normalized) {
    return {
      field,
      message: `请输入${label}。`
    };
  }

  if (normalized.length < MIN_PASSWORD_LENGTH) {
    return {
      field,
      message: `${label}至少 ${MIN_PASSWORD_LENGTH} 位。`
    };
  }

  return null;
}

export function validateAccountLifecycleRequest(
  _kind: AccountLifecycleKind,
  loginId: string
): AccountLifecycleValidationError | null {
  return validateAccountLoginId(loginId);
}

export function validateAccountLifecycleConfirm(
  kind: AccountLifecycleKind,
  draft: AccountLifecycleDraft
): AccountLifecycleValidationError | null {
  const loginIdError = validateAccountLoginId(draft.loginId);
  if (loginIdError) {
    return loginIdError;
  }

  if (!draft.token.trim()) {
    return {
      field: "token",
      message: kind === "registration" ? "请先申请并填写注册令牌。" : "请先申请并填写找回令牌。"
    };
  }

  return validateAccountPassword(
    draft.password,
    "password",
    kind === "registration" ? "注册口令" : "新口令"
  );
}

export function describeAccountAuthFailure(
  failure: AccountAuthRequestFailure,
  options: {
    invalidTokenCode?: string;
  } = {}
): string {
  if (failure.status === 409 && failure.code === "login_id_taken") {
    return "登录 ID 已被占用，请更换后重试。";
  }
  if (failure.status === 403 && failure.code === "account_locked") {
    return "该账号因连续失败已被临时锁定，请稍后再试。";
  }
  if (failure.status === 401 && options.invalidTokenCode && failure.code === options.invalidTokenCode) {
    return "令牌无效或已过期，请重新申请后再确认。";
  }
  if (failure.status === 401) {
    return "登录 ID 或口令不正确，请检查后重试。";
  }
  if (failure.status === 400) {
    return "输入格式不合法，请检查登录 ID、令牌和口令后重试。";
  }
  if (failure.status === 429) {
    return "请求过于频繁，请稍后再试。";
  }

  return "";
}
