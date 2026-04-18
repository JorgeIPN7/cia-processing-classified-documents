import type { Brand } from '../../common/brand';
import { err, ok, type Result } from '../../common/result';
import { LIMITS } from '../../common/limits';
import {
  limitExceeded,
  parseErr,
  type LimitExceededError,
  type ParseError,
} from './parse-error';

export type Pattern = Brand<string, 'Pattern'>;

export function createPattern(
  raw: string,
): Result<Pattern, LimitExceededError | ParseError> {
  if (raw.length > LIMITS.MAX_PATTERN_LENGTH) {
    return err(
      limitExceeded('MAX_PATTERN_LENGTH', raw.length, LIMITS.MAX_PATTERN_LENGTH),
    );
  }
  if (raw.trim().length === 0) {
    return err(parseErr.emptyQuotedPattern(0));
  }
  return ok(raw as Pattern);
}
