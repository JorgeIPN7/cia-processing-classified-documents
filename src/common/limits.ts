export const LIMITS = {
  MAX_DOCUMENT_BYTES: 10 * 1024 * 1024,
  MAX_PATTERNS_INPUT_BYTES: 1 * 1024 * 1024,
  MAX_PATTERN_LENGTH: 1_000,
  MAX_PATTERN_COUNT: 10_000,
  MAX_KEY_BYTES: 15 * 1024 * 1024,
} as const satisfies Record<string, number>;

export type LimitKey = keyof typeof LIMITS;
