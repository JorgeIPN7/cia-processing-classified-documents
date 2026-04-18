import type { DomainError } from '../../common/errors';
import type { LimitKey } from '../../common/limits';

export type ParseErrorDetails =
  | { readonly subKind: 'UNBALANCED_QUOTE'; readonly position: number }
  | { readonly subKind: 'NESTED_SAME_QUOTE'; readonly position: number }
  | {
      readonly subKind: 'CONTROL_CHAR_IN_PATTERN';
      readonly position: number;
      readonly char: string;
    }
  | { readonly subKind: 'EMPTY_QUOTED_PATTERN'; readonly position: number };

export type ParseError = DomainError<'PARSE_ERROR', ParseErrorDetails>;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- DomainError's D constraint rejects `interface` (TS treats them as augmentable)
export type LimitExceededDetails = {
  readonly limit: LimitKey;
  readonly actual: number;
  readonly max: number;
};

export type LimitExceededError = DomainError<
  'LIMIT_EXCEEDED',
  LimitExceededDetails
>;

export const parseErr = {
  unbalancedQuote(position: number): ParseError {
    return {
      kind: 'PARSE_ERROR',
      message: `Unbalanced quote at position ${String(position)}`,
      details: { subKind: 'UNBALANCED_QUOTE', position },
    };
  },
  nestedSameQuote(position: number): ParseError {
    return {
      kind: 'PARSE_ERROR',
      message: `Nested same-type quote at position ${String(position)}`,
      details: { subKind: 'NESTED_SAME_QUOTE', position },
    };
  },
  controlChar(position: number, char: string): ParseError {
    const code = char.codePointAt(0) ?? 0;
    return {
      kind: 'PARSE_ERROR',
      message: `Control character 0x${code.toString(16).padStart(2, '0')} at position ${String(position)}`,
      details: { subKind: 'CONTROL_CHAR_IN_PATTERN', position, char },
    };
  },
  emptyQuotedPattern(position: number): ParseError {
    return {
      kind: 'PARSE_ERROR',
      message: `Empty or whitespace-only quoted pattern opened at position ${String(position)}`,
      details: { subKind: 'EMPTY_QUOTED_PATTERN', position },
    };
  },
} as const;

export function limitExceeded(
  limit: LimitKey,
  actual: number,
  max: number,
): LimitExceededError {
  return {
    kind: 'LIMIT_EXCEEDED',
    message: `Limit ${limit} exceeded: actual=${String(actual)} max=${String(max)}`,
    details: { limit, actual, max },
  };
}
