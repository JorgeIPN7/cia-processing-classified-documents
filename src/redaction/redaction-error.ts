import type { DomainError } from '../common/errors';

export const REDACTION_TOKEN_LITERAL = 'XXXX' as const;

export type IntegrityErrorDetails =
  | {
      readonly subKind: 'POSITION_OUT_OF_BOUNDS';
      readonly index: number;
      readonly pos: number;
      readonly len: number;
      readonly redactedLength: number;
    }
  | {
      readonly subKind: 'TOKEN_MISMATCH';
      readonly index: number;
      readonly pos: number;
      readonly expected: typeof REDACTION_TOKEN_LITERAL;
      readonly actual: string;
    }
  | {
      readonly subKind: 'OVERLAPPING_MAPPINGS';
      readonly index: number;
      readonly pos: number;
      readonly previousEnd: number;
    };

export type IntegrityError = DomainError<
  'KEY_INTEGRITY_FAILURE',
  IntegrityErrorDetails
>;

export const integrityErr = {
  positionOutOfBounds(
    index: number,
    pos: number,
    len: number,
    redactedLength: number,
  ): IntegrityError {
    return {
      kind: 'KEY_INTEGRITY_FAILURE',
      message: `Mapping[${String(index)}] out of bounds: pos=${String(pos)} len=${String(len)} redactedLength=${String(redactedLength)}`,
      details: {
        subKind: 'POSITION_OUT_OF_BOUNDS',
        index,
        pos,
        len,
        redactedLength,
      },
    };
  },
  tokenMismatch(index: number, pos: number, actual: string): IntegrityError {
    return {
      kind: 'KEY_INTEGRITY_FAILURE',
      message: `Mapping[${String(index)}] token mismatch at pos=${String(pos)}: expected ${REDACTION_TOKEN_LITERAL}, got ${JSON.stringify(actual)}`,
      details: {
        subKind: 'TOKEN_MISMATCH',
        index,
        pos,
        expected: REDACTION_TOKEN_LITERAL,
        actual,
      },
    };
  },
  overlappingMappings(
    index: number,
    pos: number,
    previousEnd: number,
  ): IntegrityError {
    return {
      kind: 'KEY_INTEGRITY_FAILURE',
      message: `Mapping[${String(index)}] overlaps previous: pos=${String(pos)} previousEnd=${String(previousEnd)}`,
      details: {
        subKind: 'OVERLAPPING_MAPPINGS',
        index,
        pos,
        previousEnd,
      },
    };
  },
} as const;
