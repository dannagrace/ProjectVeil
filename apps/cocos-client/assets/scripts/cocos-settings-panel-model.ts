const SETTINGS_STORAGE_KEY = "veil_settings";

export interface CocosStoredSettings {
  bgmVolume: number;
  sfxVolume: number;
  frameRateCap: 30 | 60;
}

export interface CocosSettingsPanelView extends CocosStoredSettings {
  open: boolean;
  displayName: string;
  loginId: string;
  authMode: "guest" | "account";
  privacyConsentAccepted: boolean;
  statusMessage: string | null;
  deleteAccountPending: boolean;
  withdrawConsentPending: boolean;
  supportSubmittingCategory: "bug" | "payment" | "account" | null;
  privacyPolicyUrl: string;
}

export interface CocosSettingsPanelUpdate {
  open?: boolean;
  bgmVolume?: number;
  sfxVolume?: number;
  frameRateCap?: 30 | 60 | number;
  displayName?: string;
  loginId?: string;
  authMode?: "guest" | "account";
  privacyConsentAccepted?: boolean;
  statusMessage?: string | null;
  deleteAccountPending?: boolean;
  withdrawConsentPending?: boolean;
  supportSubmittingCategory?: "bug" | "payment" | "account" | null;
  privacyPolicyUrl?: string;
}

interface CocosSettingsLocalStorageLike {
  getItem?(key: string): string | null;
  setItem?(key: string, value: string): void;
  removeItem?(key: string): void;
}

interface CocosSettingsWechatRuntimeLike {
  getStorageSync?(key: string): unknown;
  setStorageSync?(key: string, value: string): void;
  removeStorageSync?(key: string): void;
  openPrivacyContract?(
    options?: {
      success?: () => void;
      fail?: (error?: unknown) => void;
    }
  ): void;
}

export interface CocosSettingsPersistenceRuntime {
  localStorage?: CocosSettingsLocalStorageLike | null;
  wx?: CocosSettingsWechatRuntimeLike | null;
}

export interface CocosSettingsPanelOptions {
  onClose?: () => void;
  onUpdate?: (update: CocosSettingsPanelUpdate) => void;
  onLogout?: () => void;
  onDeleteAccount?: () => void;
  onWithdrawConsent?: () => void;
  onOpenPrivacyPolicy?: () => void;
  onSubmitSupportTicket?: (category: "bug" | "payment" | "account") => void;
}

export function createDefaultCocosSettingsView(
  update: Partial<CocosSettingsPanelView> = {}
): CocosSettingsPanelView {
  return applySettingsUpdate(
    {
      open: false,
      bgmVolume: 54,
      sfxVolume: 76,
      frameRateCap: 60,
      displayName: "",
      loginId: "",
      authMode: "guest",
      privacyConsentAccepted: false,
      statusMessage: null,
      deleteAccountPending: false,
      withdrawConsentPending: false,
      supportSubmittingCategory: null,
      privacyPolicyUrl: resolveCocosPrivacyPolicyUrl()
    },
    update
  );
}

export function getCocosSettingsStorageKey(): string {
  return SETTINGS_STORAGE_KEY;
}

export function clampSettingsVolume(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(100, Math.max(0, Math.round(value)));
}

function normalizeFrameRateCap(value: unknown, fallback: 30 | 60): 30 | 60 {
  return value === 30 ? 30 : value === 60 ? 60 : fallback;
}

export function applySettingsUpdate(
  state: CocosSettingsPanelView,
  update: CocosSettingsPanelUpdate
): CocosSettingsPanelView {
  return {
    ...state,
    ...update,
    bgmVolume: clampSettingsVolume(update.bgmVolume ?? state.bgmVolume, state.bgmVolume),
    sfxVolume: clampSettingsVolume(update.sfxVolume ?? state.sfxVolume, state.sfxVolume),
    frameRateCap: normalizeFrameRateCap(update.frameRateCap ?? state.frameRateCap, state.frameRateCap)
  };
}

export function serializeCocosSettings(settings: CocosStoredSettings): string {
  return JSON.stringify({
    bgmVolume: clampSettingsVolume(settings.bgmVolume, 54),
    sfxVolume: clampSettingsVolume(settings.sfxVolume, 76),
    frameRateCap: normalizeFrameRateCap(settings.frameRateCap, 60)
  });
}

export function deserializeCocosSettings(raw: unknown): CocosStoredSettings {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const candidate = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return {
    bgmVolume: clampSettingsVolume(
      typeof candidate.bgmVolume === "number" ? candidate.bgmVolume : Number(candidate.bgmVolume),
      54
    ),
    sfxVolume: clampSettingsVolume(
      typeof candidate.sfxVolume === "number" ? candidate.sfxVolume : Number(candidate.sfxVolume),
      76
    ),
    frameRateCap: normalizeFrameRateCap(candidate.frameRateCap, 60)
  };
}

export function readPersistedCocosSettings(
  runtime: CocosSettingsPersistenceRuntime = globalThis as CocosSettingsPersistenceRuntime
): CocosStoredSettings {
  const wxRuntime = runtime.wx ?? null;
  if (wxRuntime?.getStorageSync) {
    return deserializeCocosSettings(wxRuntime.getStorageSync(SETTINGS_STORAGE_KEY));
  }

  const localStorage = runtime.localStorage ?? null;
  return deserializeCocosSettings(localStorage?.getItem?.(SETTINGS_STORAGE_KEY) ?? null);
}

export function writePersistedCocosSettings(
  settings: CocosStoredSettings,
  runtime: CocosSettingsPersistenceRuntime = globalThis as CocosSettingsPersistenceRuntime
): void {
  const serialized = serializeCocosSettings(settings);
  const wxRuntime = runtime.wx ?? null;
  if (wxRuntime?.setStorageSync) {
    wxRuntime.setStorageSync(SETTINGS_STORAGE_KEY, serialized);
    return;
  }

  runtime.localStorage?.setItem?.(SETTINGS_STORAGE_KEY, serialized);
}

export function resolveCocosPrivacyPolicyUrl(
  locationLike: Pick<Location, "href"> | null | undefined = globalThis.location
): string {
  try {
    return new URL("/config-center.html", locationLike?.href ?? "https://project-veil.invalid/").toString();
  } catch {
    return "/config-center.html";
  }
}
