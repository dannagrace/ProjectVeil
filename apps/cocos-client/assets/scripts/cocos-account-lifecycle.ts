export type CocosAccountLifecycleKind = "registration" | "recovery";
export type CocosAccountLifecycleDeliveryMode = "idle" | "dev-token" | "external";
export type CocosAccountReadinessStatus = "ready" | "missing" | "blocked";

export interface CocosAccountLifecycleDraft {
  kind: CocosAccountLifecycleKind;
  loginId: string;
  displayName: string;
  token: string;
  password: string;
  deliveryMode: CocosAccountLifecycleDeliveryMode;
  expiresAt?: string;
}

export interface CocosAccountLifecycleFieldReadiness {
  status: CocosAccountReadinessStatus;
  summary: string;
}

export interface CocosAccountLifecycleFieldView {
  key: "loginId" | "displayName" | "token" | "password";
  label: string;
  value: string;
  placeholder: string;
  hint: string;
  readiness: CocosAccountLifecycleFieldReadiness;
}

export interface CocosAccountLifecycleReadinessView {
  status: CocosAccountReadinessStatus;
  summary: string;
  detail: string;
}

export interface CocosAccountLifecyclePanelView {
  title: string;
  intro: string;
  readiness: CocosAccountLifecycleReadinessView;
  fields: CocosAccountLifecycleFieldView[];
  deliveryHint: string;
  requestLabel: string;
  confirmLabel: string;
}

function normalizeValue(value: string): string {
  return value.trim();
}

function formatExpiry(expiresAt?: string): string {
  return expiresAt ? `，过期时间：${expiresAt}` : "";
}

function resolvePasswordReadiness(password: string): CocosAccountLifecycleFieldReadiness {
  const normalizedPassword = normalizeValue(password);
  if (!normalizedPassword) {
    return {
      status: "missing",
      summary: "缺少口令"
    };
  }

  if (normalizedPassword.length < 6) {
    return {
      status: "missing",
      summary: "口令至少 6 位"
    };
  }

  return {
    status: "ready",
    summary: "口令已填写"
  };
}

function resolveTokenReadiness(
  draft: CocosAccountLifecycleDraft
): CocosAccountLifecycleFieldReadiness {
  if (normalizeValue(draft.token)) {
    return {
      status: "ready",
      summary: "令牌已填写"
    };
  }

  if (draft.deliveryMode === "external") {
    return {
      status: "blocked",
      summary: "等待外部投递令牌"
    };
  }

  return {
    status: "missing",
    summary: draft.kind === "registration" ? "尚未申请注册令牌" : "尚未申请找回令牌"
  };
}

function buildLifecycleFieldViews(
  draft: CocosAccountLifecycleDraft
): CocosAccountLifecycleFieldView[] {
  const loginIdReady = normalizeValue(draft.loginId).length > 0;

  if (draft.kind === "registration") {
    return [
      {
        key: "loginId",
        label: "登录 ID",
        value: draft.loginId,
        placeholder: "点击填写",
        hint: "会自动转成小写，用于后续正式账号登录。",
        readiness: loginIdReady
          ? { status: "ready", summary: "登录 ID 已填写" }
          : { status: "missing", summary: "缺少登录 ID" }
      },
      {
        key: "displayName",
        label: "注册昵称",
        value: draft.displayName,
        placeholder: "点击填写",
        hint: "留空时服务端会回退到登录 ID。",
        readiness: normalizeValue(draft.displayName)
          ? { status: "ready", summary: "注册昵称已填写" }
          : { status: "ready", summary: "留空时回退到登录 ID" }
      },
      {
        key: "token",
        label: "注册令牌",
        value: draft.token,
        placeholder: "申请后填写",
        hint: "开发环境会直返令牌；正式投递模式需从外部渠道填写。",
        readiness: resolveTokenReadiness(draft)
      },
      {
        key: "password",
        label: "注册口令",
        value: draft.password ? "********" : "",
        placeholder: "点击填写",
        hint: "至少 6 位，确认后会直接进入当前房间。",
        readiness: resolvePasswordReadiness(draft.password)
      }
    ];
  }

  return [
    {
      key: "loginId",
      label: "登录 ID",
      value: draft.loginId,
      placeholder: "点击填写",
      hint: "填写要找回的正式账号登录 ID。",
      readiness: loginIdReady
        ? { status: "ready", summary: "登录 ID 已填写" }
        : { status: "missing", summary: "缺少登录 ID" }
    },
    {
      key: "token",
      label: "找回令牌",
      value: draft.token,
      placeholder: "申请后填写",
      hint: "开发环境会直返令牌；正式投递模式需从外部渠道填写。",
      readiness: resolveTokenReadiness(draft)
    },
    {
      key: "password",
      label: "新口令",
      value: draft.password ? "********" : "",
      placeholder: "点击填写",
      hint: "确认后会立即用新口令重新登录。",
      readiness: resolvePasswordReadiness(draft.password)
    }
  ];
}

export function buildCocosAccountLifecycleReadinessView(
  draft: CocosAccountLifecycleDraft
): CocosAccountLifecycleReadinessView {
  const fields = buildLifecycleFieldViews(draft);
  const missingFields = fields.filter((field) => field.readiness.status === "missing");
  const blockedFields = fields.filter((field) => field.readiness.status === "blocked");
  const status: CocosAccountReadinessStatus =
    missingFields.length > 0 ? "missing" : blockedFields.length > 0 ? "blocked" : "ready";

  if (status === "ready") {
    return {
      status,
      summary: "账号链路已就绪",
      detail:
        draft.kind === "registration"
          ? "注册确认所需字段已齐备，可直接确认注册并进入房间。"
          : "口令重置所需字段已齐备，可直接确认重置并重新登录。"
    };
  }

  if (status === "blocked") {
    return {
      status,
      summary: "账号链路被外部令牌阻塞",
      detail:
        draft.kind === "registration"
          ? "注册草稿已齐备，但仍需等待外部渠道投递注册令牌。"
          : "找回草稿已齐备，但仍需等待外部渠道投递找回令牌。"
    };
  }

  return {
    status,
    summary: "账号链路仍缺少关键字段",
    detail: `待补字段：${missingFields.map((field) => field.label).join("、")}。`
  };
}

export function buildCocosAccountLifecyclePanelView(
  draft: CocosAccountLifecycleDraft
): CocosAccountLifecyclePanelView {
  const fields = buildLifecycleFieldViews(draft);
  const readiness = buildCocosAccountLifecycleReadinessView(draft);

  if (draft.kind === "registration") {
    return {
      title: "正式注册流程",
      intro: "先申请注册令牌，再确认口令并升级为正式账号会话。",
      readiness,
      fields,
      deliveryHint:
        draft.deliveryMode === "dev-token"
          ? `当前为开发直返令牌模式，可直接确认注册${formatExpiry(draft.expiresAt)}。`
          : draft.deliveryMode === "external"
            ? `当前为外部投递模式，请从邮件或其他渠道取得注册令牌${formatExpiry(draft.expiresAt)}。`
            : "尚未申请注册令牌。",
      requestLabel: "申请注册令牌",
      confirmLabel: "确认注册并进房"
    };
  }

  return {
    title: "密码找回流程",
    intro: "先申请找回令牌，再确认新口令并重新登录当前房间。",
    readiness,
    fields,
    deliveryHint:
      draft.deliveryMode === "dev-token"
        ? `当前为开发直返令牌模式，可直接确认重置${formatExpiry(draft.expiresAt)}。`
        : draft.deliveryMode === "external"
          ? `当前为外部投递模式，请从邮件或其他渠道取得找回令牌${formatExpiry(draft.expiresAt)}。`
          : "尚未申请找回令牌。",
    requestLabel: "申请找回令牌",
    confirmLabel: "确认重置并进房"
  };
}
