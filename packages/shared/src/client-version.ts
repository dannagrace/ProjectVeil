const CLIENT_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

export const DEFAULT_MIN_SUPPORTED_CLIENT_VERSION = "0.0.0";

export interface ParsedClientVersion {
  major: number;
  minor: number;
  patch: number;
}

export function normalizeClientVersion(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

export function parseClientVersion(value: string | null | undefined): ParsedClientVersion | null {
  const normalized = normalizeClientVersion(value);
  if (!normalized) {
    return null;
  }

  const match = CLIENT_VERSION_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

export function compareClientVersions(left: string | null | undefined, right: string | null | undefined): number | null {
  const parsedLeft = parseClientVersion(left);
  const parsedRight = parseClientVersion(right);
  if (!parsedLeft || !parsedRight) {
    return null;
  }

  if (parsedLeft.major !== parsedRight.major) {
    return parsedLeft.major - parsedRight.major;
  }
  if (parsedLeft.minor !== parsedRight.minor) {
    return parsedLeft.minor - parsedRight.minor;
  }
  if (parsedLeft.patch !== parsedRight.patch) {
    return parsedLeft.patch - parsedRight.patch;
  }

  return 0;
}

export function isClientVersionSupported(
  clientVersion: string | null | undefined,
  minimumSupportedVersion: string | null | undefined
): boolean {
  const minimum = normalizeClientVersion(minimumSupportedVersion) ?? DEFAULT_MIN_SUPPORTED_CLIENT_VERSION;
  const compared = compareClientVersions(clientVersion, minimum);
  if (compared == null) {
    return minimum === DEFAULT_MIN_SUPPORTED_CLIENT_VERSION;
  }

  return compared >= 0;
}
