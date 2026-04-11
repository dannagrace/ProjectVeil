export interface DisplayNameModerationViolation {
  term: string;
  reason: "reserved" | "profanity";
}

const BLOCKED_DISPLAY_NAME_TERMS: Array<DisplayNameModerationViolation> = [
  { term: "admin", reason: "reserved" },
  { term: "gm", reason: "reserved" },
  { term: "mod", reason: "reserved" },
  { term: "fuck", reason: "profanity" },
  { term: "shit", reason: "profanity" },
  { term: "傻逼", reason: "profanity" },
  { term: "操你妈", reason: "profanity" }
];

export function normalizeTextForModeration(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

export function findDisplayNameModerationViolation(value: string): DisplayNameModerationViolation | null {
  const normalized = normalizeTextForModeration(value);
  if (!normalized) {
    return null;
  }

  for (const term of BLOCKED_DISPLAY_NAME_TERMS) {
    if (normalized.includes(normalizeTextForModeration(term.term))) {
      return term;
    }
  }

  return null;
}

export function isDisplayNameAllowed(value: string): boolean {
  return findDisplayNameModerationViolation(value) === null;
}
