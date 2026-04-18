import { Injectable } from '@nestjs/common';

import { LIMITS } from '../../common/limits';
import { err, ok, type Result } from '../../common/result';
import {
  resolveMatcherOptions,
  type MatcherOptions,
  type ResolvedMatcherOptions,
} from '../interfaces/matcher-options.interface';
import {
  limitExceeded,
  parseErr,
  type LimitExceededError,
  type ParseError,
} from './parse-error';
import {
  resolveParserOptions,
  type ParserOptions,
} from './parser-options.interface';
import { createPattern, type Pattern } from './pattern';

type ParserState = 'OUTSIDE' | 'IN_DOUBLE' | 'IN_SINGLE';
type QuoteChar = '"' | "'";

@Injectable()
export class CensorListParserService {
  parse(
    input: string,
    matcherOptions?: MatcherOptions,
    parserOptions?: ParserOptions,
  ): Result<readonly Pattern[], ParseError | LimitExceededError> {
    if (input.length > LIMITS.MAX_PATTERNS_INPUT_BYTES) {
      return err(
        limitExceeded(
          'MAX_PATTERNS_INPUT_BYTES',
          input.length,
          LIMITS.MAX_PATTERNS_INPUT_BYTES,
        ),
      );
    }

    const matcher = resolveMatcherOptions(matcherOptions);
    const parser = resolveParserOptions(parserOptions);

    const tokenized = this.tokenize(input, parser.trim);
    if (!tokenized.ok) return tokenized;

    const deduped = this.dedupe(tokenized.value, matcher);
    if (deduped.length > LIMITS.MAX_PATTERN_COUNT) {
      return err(
        limitExceeded(
          'MAX_PATTERN_COUNT',
          deduped.length,
          LIMITS.MAX_PATTERN_COUNT,
        ),
      );
    }
    return ok(Object.freeze(deduped));
  }

  private tokenize(
    input: string,
    trim: boolean,
  ): Result<readonly Pattern[], ParseError | LimitExceededError> {
    const patterns: Pattern[] = [];
    let state: ParserState = 'OUTSIDE';
    let buffer = '';
    let justClosedQuote: QuoteChar | null = null;
    let tokenOpenQuotePos = 0;

    const pushQuoted = (
      openPos: number,
    ): Result<null, ParseError | LimitExceededError> => {
      if (buffer.trim().length === 0) {
        return err(parseErr.emptyQuotedPattern(openPos));
      }
      const created = createPattern(buffer);
      if (!created.ok) return created;
      patterns.push(created.value);
      return ok(null);
    };

    const pushUnquoted = (): Result<null, ParseError | LimitExceededError> => {
      const raw = trim ? buffer.trim() : buffer;
      if (raw.length === 0) return ok(null);
      const created = createPattern(raw);
      if (!created.ok) return created;
      patterns.push(created.value);
      return ok(null);
    };

    for (let i = 0; i < input.length; i++) {
      const c = input.charAt(i);
      const code = input.charCodeAt(i);

      if (state === 'OUTSIDE') {
        if (c === ' ' || c === ',') {
          if (buffer.length > 0) {
            const r = pushUnquoted();
            if (!r.ok) return r;
            buffer = '';
          }
          justClosedQuote = null;
          continue;
        }
        if (c === '"' || c === "'") {
          if (justClosedQuote === c) {
            return err(parseErr.nestedSameQuote(i));
          }
          if (buffer.length > 0) {
            const r = pushUnquoted();
            if (!r.ok) return r;
            buffer = '';
          }
          state = c === '"' ? 'IN_DOUBLE' : 'IN_SINGLE';
          tokenOpenQuotePos = i;
          justClosedQuote = null;
          continue;
        }
        if (code < 0x20) {
          return err(parseErr.controlChar(i, c));
        }
        buffer += c;
        continue;
      }

      if (state === 'IN_DOUBLE') {
        if (c === '"') {
          const r = pushQuoted(tokenOpenQuotePos);
          if (!r.ok) return r;
          buffer = '';
          state = 'OUTSIDE';
          justClosedQuote = '"';
          continue;
        }
        if (c === '\t' || c === '\n' || c === '\r') {
          buffer += c;
          continue;
        }
        if (code < 0x20) {
          return err(parseErr.controlChar(i, c));
        }
        buffer += c;
        continue;
      }

      // state === 'IN_SINGLE'
      if (c === "'") {
        const r = pushQuoted(tokenOpenQuotePos);
        if (!r.ok) return r;
        buffer = '';
        state = 'OUTSIDE';
        justClosedQuote = "'";
        continue;
      }
      if (c === '\t' || c === '\n' || c === '\r') {
        buffer += c;
        continue;
      }
      if (code < 0x20) {
        return err(parseErr.controlChar(i, c));
      }
      buffer += c;
    }

    if (state !== 'OUTSIDE') {
      return err(parseErr.unbalancedQuote(input.length));
    }
    if (buffer.length > 0) {
      const r = pushUnquoted();
      if (!r.ok) return r;
    }

    return ok(patterns);
  }

  private dedupe(
    patterns: readonly Pattern[],
    opts: ResolvedMatcherOptions,
  ): Pattern[] {
    const seen = new Set<string>();
    const out: Pattern[] = [];
    for (const p of patterns) {
      const key = this.normalize(p, opts);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p);
      }
    }
    return out;
  }

  private normalize(p: string, opts: ResolvedMatcherOptions): string {
    let s = p;
    if (!opts.caseSensitive) {
      s = s.toLowerCase();
    }
    if (opts.normalizeUnicode) {
      s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    }
    if (opts.normalizeWhitespace) {
      s = s.replace(/\s+/gu, ' ').trim();
    }
    return s;
  }
}
