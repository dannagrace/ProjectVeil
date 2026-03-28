export type CocosAccountLifecycleKind = "registration" | "recovery";
export type CocosAccountLifecycleDeliveryMode = "idle" | "dev-token" | "external";

export interface CocosAccountLifecycleDraft {
  kind: CocosAccountLifecycleKind;
  loginId: string;
  displayName: string;
  token: string;
  password: string;
  deliveryMode: CocosAccountLifecycleDeliveryMode;
  expiresAt?: string;
}

export interface CocosAccountLifecycleFieldView {
  key: "loginId" | "displayName" | "token" | "password";
  label: string;
  value: string;
  placeholder: string;
  hint: string;
}

export interface CocosAccountLifecyclePanelView {
  title: string;
  intro: string;
  fields: CocosAccountLifecycleFieldView[];
  deliveryHint: string;
  requestLabel: string;
  confirmLabel: string;
}

function formatExpiry(expiresAt?: string): string {
  return expiresAt ? `，过期时间：${expiresAt}` : "";
}

export function buildCocosAccountLifecyclePanelView(
  draft: CocosAccountLifecycleDraft
): CocosAccountLifecyclePanelView {
  if (draft.kind === "registration") {
    return {
      title: "正式注册流程",
      intro: "先申请注册令牌，再确认口令并升级为正式账号会话。",
      fields: [
        {
          key: "loginId",
          label: "登录 ID",
          value: draft.loginId,
          placeholder: "点击填写",
          hint: "会自动转成小写，用于后续正式账号登录。"
        },
        {
          key: "displayName",
          label: "注册昵称",
          value: draft.displayName,
          placeholder: "点击填写",
          hint: "留空时服务端会回退到登录 ID。"
        },
        {
          key: "token",
          label: "注册令牌",
          value: draft.token,
          placeholder: "申请后填写",
          hint: "开发环境会直返令牌；正式投递模式需从外部渠道填写。"
        },
        {
          key: "password",
          label: "注册口令",
          value: draft.password ? "********" : "",
          placeholder: "点击填写",
          hint: "至少 6 位，确认后会直接进入当前房间。"
        }
      ],
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
    fields: [
      {
        key: "loginId",
        label: "登录 ID",
        value: draft.loginId,
        placeholder: "点击填写",
        hint: "填写要找回的正式账号登录 ID。"
      },
      {
        key: "token",
        label: "找回令牌",
        value: draft.token,
        placeholder: "申请后填写",
        hint: "开发环境会直返令牌；正式投递模式需从外部渠道填写。"
      },
      {
        key: "password",
        label: "新口令",
        value: draft.password ? "********" : "",
        placeholder: "点击填写",
        hint: "确认后会立即用新口令重新登录。"
      }
    ],
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
