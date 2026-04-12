import type { MobilePushPlatform, MobilePushTokenRegistration } from "../../../packages/shared/src/index";

const MAX_PUSH_TOKEN_LENGTH = 4096;

function normalizeMobilePushPlatform(platform: string): MobilePushPlatform {
  const normalized = platform.trim().toLowerCase();
  if (normalized !== "ios" && normalized !== "android") {
    throw new Error("platform must be ios or android");
  }

  return normalized;
}

function normalizeMobilePushTokenValue(token: string): string {
  const normalized = token.trim();
  if (!normalized) {
    throw new Error("token must not be empty");
  }
  if (normalized.length > MAX_PUSH_TOKEN_LENGTH) {
    throw new Error("token must be 4096 characters or fewer");
  }

  return normalized;
}

export function normalizeMobilePushTokenRegistration(
  registration: { platform: string; token: string; registeredAt?: string; updatedAt?: string },
  now = new Date().toISOString()
): MobilePushTokenRegistration {
  const registeredAt = registration.registeredAt?.trim() ? new Date(registration.registeredAt).toISOString() : now;
  return {
    platform: normalizeMobilePushPlatform(registration.platform),
    token: normalizeMobilePushTokenValue(registration.token),
    registeredAt,
    updatedAt: registration.updatedAt?.trim() ? new Date(registration.updatedAt).toISOString() : now
  };
}

export function normalizeMobilePushTokenRegistrations(
  registrations?: Partial<MobilePushTokenRegistration>[] | null
): MobilePushTokenRegistration[] | undefined {
  if (!Array.isArray(registrations) || registrations.length === 0) {
    return undefined;
  }

  const byPlatform = new Map<MobilePushPlatform, MobilePushTokenRegistration>();
  for (const entry of registrations) {
    if (!entry || typeof entry.platform !== "string" || typeof entry.token !== "string") {
      continue;
    }

    const normalized = normalizeMobilePushTokenRegistration({
      platform: entry.platform,
      token: entry.token,
      ...(entry.registeredAt ? { registeredAt: entry.registeredAt } : {}),
      ...(entry.updatedAt ? { updatedAt: entry.updatedAt } : {})
    });
    byPlatform.set(normalized.platform, normalized);
  }

  const normalized = Array.from(byPlatform.values());
  return normalized.length > 0 ? normalized : undefined;
}

export function upsertMobilePushToken(
  registrations: MobilePushTokenRegistration[] | undefined,
  registration: { platform: string; token: string },
  now = new Date().toISOString()
): MobilePushTokenRegistration[] {
  const normalized = normalizeMobilePushTokenRegistration(registration, now);
  const existing = registrations?.find((entry) => entry.platform === normalized.platform) ?? null;

  return [
    ...(registrations ?? []).filter((entry) => entry.platform !== normalized.platform),
    {
      ...normalized,
      registeredAt: existing?.registeredAt ?? normalized.registeredAt
    }
  ].sort((left, right) => left.platform.localeCompare(right.platform));
}

export function removeMobilePushToken(
  registrations: MobilePushTokenRegistration[] | undefined,
  criteria: { platform?: string | null; token?: string | null }
): MobilePushTokenRegistration[] | undefined {
  const normalizedPlatform = criteria.platform?.trim() ? normalizeMobilePushPlatform(criteria.platform) : null;
  const normalizedToken = criteria.token?.trim() ? normalizeMobilePushTokenValue(criteria.token) : null;
  const filtered = (registrations ?? []).filter((entry) => {
    if (normalizedPlatform && entry.platform !== normalizedPlatform) {
      return true;
    }
    if (normalizedToken && entry.token !== normalizedToken) {
      return true;
    }
    return false;
  });

  return filtered.length > 0 ? filtered : undefined;
}
