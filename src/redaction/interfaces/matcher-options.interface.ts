export interface MatcherOptions {
  readonly caseSensitive?: boolean;
  readonly wordBoundaries?: boolean;
  readonly normalizeUnicode?: boolean;
  readonly normalizeWhitespace?: boolean;
}

export interface ResolvedMatcherOptions {
  readonly caseSensitive: boolean;
  readonly wordBoundaries: boolean;
  readonly normalizeUnicode: boolean;
  readonly normalizeWhitespace: boolean;
}

export const DEFAULT_MATCHER_OPTIONS: ResolvedMatcherOptions = {
  caseSensitive: false,
  wordBoundaries: false,
  normalizeUnicode: false,
  normalizeWhitespace: false,
} as const;

export function resolveMatcherOptions(
  opts?: MatcherOptions,
): ResolvedMatcherOptions {
  return {
    caseSensitive: opts?.caseSensitive ?? DEFAULT_MATCHER_OPTIONS.caseSensitive,
    wordBoundaries:
      opts?.wordBoundaries ?? DEFAULT_MATCHER_OPTIONS.wordBoundaries,
    normalizeUnicode:
      opts?.normalizeUnicode ?? DEFAULT_MATCHER_OPTIONS.normalizeUnicode,
    normalizeWhitespace:
      opts?.normalizeWhitespace ?? DEFAULT_MATCHER_OPTIONS.normalizeWhitespace,
  };
}
