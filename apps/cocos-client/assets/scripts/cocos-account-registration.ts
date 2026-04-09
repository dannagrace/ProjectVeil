import {
  validateAccountLifecycleConfirm,
  validateAccountLifecycleRequest,
  type AccountLifecycleValidationError
} from "../../../../packages/shared/src/index.ts";
import {
  buildCocosAccountLifecyclePanelView,
  type CocosAccountLifecycleDraft,
  type CocosAccountLifecyclePanelView
} from "./cocos-account-lifecycle.ts";

export type CocosAccountRegistrationSubmitState =
  | "idle"
  | "requesting-token"
  | "confirming-registration"
  | "binding-wechat"
  | "success";

export type CocosWechatMinorProtectionSelection = "unknown" | "adult" | "minor";

export interface CocosAccountRegistrationIdentityView {
  id: "account-password" | "wechat-mini-game";
  label: string;
  status: "bound" | "available" | "blocked";
  detail: string;
}

export interface CocosAccountRegistrationMinorProtectionView {
  label: string;
  value: string;
  detail: string;
}

export interface CocosAccountRegistrationStatusView {
  tone: "neutral" | "positive" | "negative";
  message: string;
}

export interface CocosAccountRegistrationActionView {
  label: string;
  enabled: boolean;
  detail: string;
}

export interface CocosAccountRegistrationPanelView extends CocosAccountLifecyclePanelView {
  identities: CocosAccountRegistrationIdentityView[];
  validationError: AccountLifecycleValidationError | null;
  status: CocosAccountRegistrationStatusView | null;
  minorProtection: CocosAccountRegistrationMinorProtectionView | null;
  minorProtectionAction: CocosAccountRegistrationActionView | null;
  bindWechatAction: CocosAccountRegistrationActionView;
}

export interface CocosAccountRegistrationPanelInput {
  draft: CocosAccountLifecycleDraft & { kind: "registration" };
  privacyConsentAccepted: boolean;
  submitState?: CocosAccountRegistrationSubmitState;
  statusMessage?: string | null;
  showValidationErrors?: boolean;
  registeredAccount?: {
    loginId?: string;
    credentialBoundAt?: string;
    provider?: "guest" | "account-password" | "wechat-mini-game";
  };
  wechat?: {
    supported: boolean;
    available: boolean;
    bound: boolean;
    minorProtectionSelection?: CocosWechatMinorProtectionSelection;
  };
}

function resolveValidationError(input: CocosAccountRegistrationPanelInput): AccountLifecycleValidationError | null {
  if (!input.showValidationErrors) {
    return null;
  }

  return (
    validateAccountLifecycleConfirm("registration", {
      loginId: input.draft.loginId,
      token: input.draft.token,
      password: input.draft.password,
      privacyConsentAccepted: input.privacyConsentAccepted
    }) ?? validateAccountLifecycleRequest("registration", input.draft.loginId)
  );
}

function resolveStatus(input: CocosAccountRegistrationPanelInput): CocosAccountRegistrationStatusView | null {
  const submitState = input.submitState ?? "idle";
  const trimmedStatus = input.statusMessage?.trim();
  const validationError = resolveValidationError(input);

  if (submitState === "requesting-token") {
    return {
      tone: "neutral",
      message: "正在申请注册令牌..."
    };
  }

  if (submitState === "confirming-registration") {
    return {
      tone: "neutral",
      message: "正在确认正式注册并创建账号会话..."
    };
  }

  if (submitState === "binding-wechat") {
    return {
      tone: "neutral",
      message: "正在绑定微信小游戏身份..."
    };
  }

  if (submitState === "success") {
    return {
      tone: "positive",
      message: trimmedStatus || "正式账号流程已完成，可继续进入房间或查看已绑定身份。"
    };
  }

  if (validationError) {
    return {
      tone: "negative",
      message: validationError.message
    };
  }

  if (trimmedStatus) {
    return {
      tone: "neutral",
      message: trimmedStatus
    };
  }

  return null;
}

function buildIdentityViews(input: CocosAccountRegistrationPanelInput): CocosAccountRegistrationIdentityView[] {
  const registeredLoginId = input.registeredAccount?.loginId?.trim().toLowerCase();
  const draftLoginId = input.draft.loginId.trim().toLowerCase();
  const credentialBoundAt = input.registeredAccount?.credentialBoundAt?.trim();
  const wechatBound = input.wechat?.bound === true;

  return [
    {
      id: "account-password",
      label: "口令账号",
      status: registeredLoginId ? "bound" : "available",
      detail: registeredLoginId
        ? `当前正式账号为 ${registeredLoginId}${credentialBoundAt ? ` · 绑定于 ${credentialBoundAt}` : ""}。`
        : draftLoginId
          ? `已草拟登录 ID ${draftLoginId}，填写注册令牌和口令后即可创建正式账号。`
          : "填写登录 ID、注册令牌和口令后即可创建正式账号。"
    },
    {
      id: "wechat-mini-game",
      label: "微信小游戏身份",
      status: wechatBound
        ? "bound"
        : input.wechat?.available
          ? "available"
          : "blocked",
      detail: wechatBound
        ? "当前会话已识别到微信小游戏身份接入。"
        : !input.wechat?.supported
          ? "仅微信小游戏运行时支持绑定微信身份。"
          : !input.wechat?.available
            ? "当前运行壳未暴露 wx.login()，暂时无法完成微信绑定。"
            : !registeredLoginId
              ? "需先完成正式注册，之后即可把当前微信小游戏身份绑定到该账号。"
              : "可把当前微信小游戏身份绑定到这份正式账号，后续可直接使用微信进入。"
    }
  ];
}

function buildMinorProtectionView(
  input: CocosAccountRegistrationPanelInput
): Pick<CocosAccountRegistrationPanelView, "minorProtection" | "minorProtectionAction"> {
  if (!input.wechat?.available || input.wechat.bound) {
    return {
      minorProtection: null,
      minorProtectionAction: null
    };
  }

  const selection = input.wechat.minorProtectionSelection ?? "unknown";
  return {
    minorProtection: {
      label: "未成年人保护声明",
      value:
        selection === "adult"
          ? "已声明为成年人"
          : selection === "minor"
            ? "已声明为未成年人"
            : "尚未声明",
      detail:
        selection === "unknown"
          ? "绑定微信身份前，需要声明是否为成年人；该信息会一并提交给服务端的防沉迷策略。"
          : "再次点击可切换成年人 / 未成年人声明。"
    },
    minorProtectionAction: {
      label:
        selection === "adult"
          ? "切换为未成年人"
          : selection === "minor"
            ? "切换为成年人"
            : "设置年龄声明",
      enabled: input.submitState !== "binding-wechat",
      detail: "用于微信小游戏身份绑定时的未成年人保护信息。"
    }
  };
}

function buildBindWechatAction(input: CocosAccountRegistrationPanelInput): CocosAccountRegistrationActionView {
  if (input.wechat?.bound) {
    return {
      label: "微信身份已绑定",
      enabled: false,
      detail: "当前小游戏身份已经接入这份账号。"
    };
  }

  if (!input.wechat?.supported) {
    return {
      label: "仅小游戏环境可绑定微信",
      enabled: false,
      detail: "浏览器调试壳不支持 wx.login()。"
    };
  }

  if (!input.wechat.available) {
    return {
      label: "当前壳未暴露微信登录",
      enabled: false,
      detail: "需要微信小游戏壳提供 wx.login()。"
    };
  }

  const registeredLoginId = input.registeredAccount?.loginId?.trim().toLowerCase();
  if (!registeredLoginId) {
    return {
      label: "注册后再绑定微信",
      enabled: false,
      detail: "需先创建正式账号。"
    };
  }

  if ((input.wechat.minorProtectionSelection ?? "unknown") === "unknown") {
    return {
      label: "先设置年龄声明",
      enabled: false,
      detail: "绑定微信身份前需完成未成年人保护声明。"
    };
  }

  return {
    label: input.submitState === "binding-wechat" ? "绑定中..." : "绑定当前微信身份",
    enabled: input.submitState !== "binding-wechat",
    detail: "完成后可直接用微信小游戏身份进入当前账号。"
  };
}

export function buildCocosAccountRegistrationPanelView(
  input: CocosAccountRegistrationPanelInput
): CocosAccountRegistrationPanelView {
  const base = buildCocosAccountLifecyclePanelView(input.draft);
  const status = resolveStatus(input);
  const validationError = resolveValidationError(input);
  const identities = buildIdentityViews(input);
  const { minorProtection, minorProtectionAction } = buildMinorProtectionView(input);
  const bindWechatAction = buildBindWechatAction(input);

  return {
    ...base,
    intro: "先创建正式账号，再按需绑定当前微信小游戏身份；已绑定身份会在这里汇总展示。",
    identities,
    validationError,
    status,
    minorProtection,
    minorProtectionAction,
    bindWechatAction
  };
}
