import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

function readHeaderValue(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0]?.trim() || null : value?.trim() || null;
}

function readHeaderCsvValue(value: string | string[] | undefined): string | null {
  const headerValue = readHeaderValue(value);
  return headerValue?.split(",")[0]?.trim() || null;
}

function normalizeIpAddress(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  return normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
}

function parseIpv4ToBigInt(value: string): bigint | null {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let result = 0n;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const octet = Number(part);
    if (octet < 0 || octet > 255) {
      return null;
    }
    result = (result << 8n) + BigInt(octet);
  }
  return result;
}

function parseExpandedIpv6Parts(parts: string[]): bigint | null {
  if (parts.length !== 8) {
    return null;
  }
  let result = 0n;
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) {
      return null;
    }
    result = (result << 16n) + BigInt(parseInt(part, 16));
  }
  return result;
}

function parseIpv6ToBigInt(value: string): bigint | null {
  const normalized = value.toLowerCase();
  if (!/^[0-9a-f:]+$/.test(normalized)) {
    return null;
  }
  const hasCompression = normalized.includes("::");
  const [head, tail = ""] = normalized.split("::");
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  if (hasCompression) {
    const missingCount = 8 - (headParts.length + tailParts.length);
    if (missingCount < 0) {
      return null;
    }
    return parseExpandedIpv6Parts([
      ...headParts,
      ...Array.from({ length: missingCount }, () => "0"),
      ...tailParts
    ]);
  }
  return parseExpandedIpv6Parts(normalized.split(":"));
}

function parseIpToBigInt(value: string): { version: 4 | 6; value: bigint } | null {
  const normalized = normalizeIpAddress(value);
  if (!normalized) {
    return null;
  }
  const version = isIP(normalized);
  if (version === 4) {
    const parsed = parseIpv4ToBigInt(normalized);
    return parsed == null ? null : { version: 4, value: parsed };
  }
  if (version === 6) {
    const parsed = parseIpv6ToBigInt(normalized);
    return parsed == null ? null : { version: 6, value: parsed };
  }
  return null;
}

function isIpInCidr(address: string, cidr: string): boolean {
  const [range, prefixText] = cidr.split("/");
  if (!range || prefixText == null) {
    return false;
  }
  const parsedAddress = parseIpToBigInt(address);
  const parsedRange = parseIpToBigInt(range);
  if (!parsedAddress || !parsedRange || parsedAddress.version !== parsedRange.version) {
    return false;
  }
  const maxBits = parsedAddress.version === 4 ? 32 : 128;
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) {
    return false;
  }
  if (prefix === 0) {
    return true;
  }
  const shift = BigInt(maxBits - prefix);
  return (parsedAddress.value >> shift) === (parsedRange.value >> shift);
}

function parseTrustedProxyRules(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.VEIL_TRUSTED_PROXIES ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isTrustedProxy(address: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!address) {
    return false;
  }
  const normalizedAddress = normalizeIpAddress(address);
  if (!normalizedAddress) {
    return false;
  }
  return parseTrustedProxyRules(env).some((rule) => {
    if (rule.includes("/")) {
      return isIpInCidr(normalizedAddress, rule);
    }
    return normalizeIpAddress(rule) === normalizedAddress;
  });
}

export function resolveTrustedRequestIp(
  request: Pick<IncomingMessage, "headers" | "socket">,
  env: NodeJS.ProcessEnv = process.env
): string {
  const socketIp = normalizeIpAddress(request.socket.remoteAddress?.trim()) ?? "unknown";
  if (!isTrustedProxy(socketIp, env)) {
    return socketIp;
  }
  const forwardedIp =
    normalizeIpAddress(readHeaderValue(request.headers["x-real-ip"])) ??
    normalizeIpAddress(readHeaderCsvValue(request.headers["x-forwarded-for"]));
  return forwardedIp ?? socketIp;
}
