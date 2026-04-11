export type DisplayNameModerationReason = "reserved" | "profanity" | "game_rule";

export interface DisplayNameModerationViolation {
  term: string;
  reason: DisplayNameModerationReason;
}

export interface DisplayNameValidationRules {
  schemaVersion: number;
  minLength: number;
  maxLength: number;
  reservedTerms: string[];
  profanityTerms: string[];
  reservedPatterns: string[];
}

const DEFAULT_BLOCKED_DISPLAY_NAME_TERMS: Array<DisplayNameModerationViolation> = [
  { term: "admin", reason: "reserved" },
  { term: "gm", reason: "reserved" },
  { term: "mod", reason: "reserved" },
  { term: "fuck", reason: "profanity" },
  { term: "shit", reason: "profanity" },
  { term: "傻逼", reason: "profanity" },
  { term: "操你妈", reason: "profanity" }
];

export const DEFAULT_DISPLAY_NAME_VALIDATION_RULES: DisplayNameValidationRules = {
  schemaVersion: 1,
  minLength: 2,
  maxLength: 24,
  reservedTerms: DEFAULT_BLOCKED_DISPLAY_NAME_TERMS.filter((entry) => entry.reason === "reserved").map((entry) => entry.term),
  profanityTerms: DEFAULT_BLOCKED_DISPLAY_NAME_TERMS.filter((entry) => entry.reason === "profanity").map((entry) => entry.term),
  reservedPatterns: ["^gm\\d*$", "^admin\\d*$", "^客服\\d*$", "^系统\\d*$"]
};

function normalizeTermList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
}

function normalizePositiveInteger(value: unknown, fallback: number, minimum: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(parsed));
}

export function normalizeDisplayNameValidationRules(
  input?: Partial<DisplayNameValidationRules> | null
): DisplayNameValidationRules {
  const minLength = normalizePositiveInteger(input?.minLength, DEFAULT_DISPLAY_NAME_VALIDATION_RULES.minLength, 1);
  const maxLength = Math.max(
    minLength,
    normalizePositiveInteger(input?.maxLength, DEFAULT_DISPLAY_NAME_VALIDATION_RULES.maxLength, minLength)
  );

  return {
    schemaVersion: normalizePositiveInteger(input?.schemaVersion, DEFAULT_DISPLAY_NAME_VALIDATION_RULES.schemaVersion, 1),
    minLength,
    maxLength,
    reservedTerms: normalizeTermList(input?.reservedTerms).length
      ? normalizeTermList(input?.reservedTerms)
      : [...DEFAULT_DISPLAY_NAME_VALIDATION_RULES.reservedTerms],
    profanityTerms: normalizeTermList(input?.profanityTerms).length
      ? normalizeTermList(input?.profanityTerms)
      : [...DEFAULT_DISPLAY_NAME_VALIDATION_RULES.profanityTerms],
    reservedPatterns: normalizeTermList(input?.reservedPatterns).length
      ? normalizeTermList(input?.reservedPatterns)
      : [...DEFAULT_DISPLAY_NAME_VALIDATION_RULES.reservedPatterns]
  };
}

export function normalizeTextForModeration(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function matchesNormalizedTerm(normalizedValue: string, term: string): boolean {
  const normalizedTerm = normalizeTextForModeration(term);
  return Boolean(normalizedTerm) && normalizedValue.includes(normalizedTerm);
}

export function findDisplayNameModerationViolation(
  value: string,
  rules: DisplayNameValidationRules = DEFAULT_DISPLAY_NAME_VALIDATION_RULES
): DisplayNameModerationViolation | null {
  const normalizedRules = normalizeDisplayNameValidationRules(rules);
  const trimmed = value.trim();
  const normalized = normalizeTextForModeration(value);
  if (!trimmed || !normalized) {
    return {
      term: "empty_name",
      reason: "game_rule"
    };
  }

  if (Array.from(trimmed).length < normalizedRules.minLength) {
    return {
      term: "min_length",
      reason: "game_rule"
    };
  }

  if (Array.from(trimmed).length > normalizedRules.maxLength) {
    return {
      term: "max_length",
      reason: "game_rule"
    };
  }

  for (const term of normalizedRules.reservedTerms) {
    if (matchesNormalizedTerm(normalized, term)) {
      return {
        term,
        reason: "reserved"
      };
    }
  }

  for (const pattern of normalizedRules.reservedPatterns) {
    const matcher = new RegExp(pattern, "iu");
    if (matcher.test(trimmed.normalize("NFKC"))) {
      return {
        term: pattern,
        reason: "reserved"
      };
    }
  }

  for (const term of normalizedRules.profanityTerms) {
    if (matchesNormalizedTerm(normalized, term)) {
      return {
        term,
        reason: "profanity"
      };
    }
  }

  return null;
}

export function isDisplayNameAllowed(
  value: string,
  rules: DisplayNameValidationRules = DEFAULT_DISPLAY_NAME_VALIDATION_RULES
): boolean {
  return findDisplayNameModerationViolation(value, rules) === null;
}
