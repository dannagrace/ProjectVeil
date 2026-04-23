import { timingSafeEqual } from "node:crypto";

function readHeaderToken(value: string | string[] | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  return Array.isArray(value) ? value[0]?.trim() || null : value?.trim() || null;
}

export function timingSafeCompareAdminToken(
  actual: string | string[] | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!expected) {
    return false;
  }
  const actualToken = readHeaderToken(actual);
  if (!actualToken) {
    return false;
  }
  const actualBuffer = Buffer.from(actualToken);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    timingSafeEqual(Buffer.alloc(expectedBuffer.length), expectedBuffer);
    return false;
  }
  return timingSafeEqual(actualBuffer, expectedBuffer);
}
