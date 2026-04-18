import { Inject, Injectable } from '@nestjs/common';

import { LIMITS } from '../common/limits';
import { err, ok, type Result } from '../common/result';

import type { CompiledMatcher } from './interfaces/compiled-matcher.interface';
import type { MatcherOptions } from './interfaces/matcher-options.interface';
import type { Matcher } from './interfaces/matcher.interface';
import { MATCHER } from './interfaces/matcher.interface';
import type { DeserializeError } from './keys/deserialize-error';
import { KeySerializerService } from './keys/key-serializer.service';
import type { Mapping } from './keys/mapping.interface';
import type { RedactionKey } from './keys/redaction-key';
import { CensorListParserService } from './parsers/censor-list-parser.service';
import {
  limitExceeded,
  type LimitExceededError,
  type ParseError,
} from './parsers/parse-error';
import {
  integrityErr,
  REDACTION_TOKEN_LITERAL,
  type IntegrityError,
} from './redaction-error';

export interface RedactionStats {
  readonly patternCount: number;
  readonly matchCount: number;
  readonly documentBytes: number;
  readonly latencyMs: number;
}

export interface RedactResult {
  readonly redactedText: string;
  readonly key: RedactionKey;
  readonly stats: RedactionStats;
}

export interface UnredactStats {
  readonly restoredCount: number;
  readonly latencyMs: number;
}

export interface UnredactResult {
  readonly text: string;
  readonly stats: UnredactStats;
}

export interface CompiledRedactor {
  readonly compiled: CompiledMatcher;
  readonly patternCount: number;
}

export type RedactError = ParseError | LimitExceededError;
export type UnredactError =
  | DeserializeError
  | LimitExceededError
  | IntegrityError;

const REDACTION_TOKEN: typeof REDACTION_TOKEN_LITERAL = REDACTION_TOKEN_LITERAL;
const REDACTION_TOKEN_LEN = REDACTION_TOKEN_LITERAL.length;

@Injectable()
export class RedactionService {
  constructor(
    private readonly parser: CensorListParserService,
    @Inject(MATCHER) private readonly matcher: Matcher,
    private readonly keySerializer: KeySerializerService,
  ) {}

  redact(
    text: string,
    patternsInput: string,
    options?: MatcherOptions,
  ): Result<RedactResult, RedactError> {
    const t0 = Date.now();

    const limitCheck = this.checkDocumentLimit(text);
    if (!limitCheck.ok) return limitCheck;

    const compiledResult = this.compileInternal(patternsInput, options);
    if (!compiledResult.ok) return compiledResult;

    return ok(this.runRedaction(text, compiledResult.value, t0));
  }

  unredact(
    redactedText: string,
    key: RedactionKey,
  ): Result<UnredactResult, UnredactError> {
    const t0 = Date.now();

    const limitCheck = this.checkDocumentLimit(redactedText);
    if (!limitCheck.ok) return limitCheck;

    const deserialized = this.keySerializer.deserialize(key);
    if (!deserialized.ok) return deserialized;

    const mappings = deserialized.value;
    const integrity = this.validateIntegrity(mappings, redactedText);
    if (!integrity.ok) return integrity;

    const chunks: string[] = [];
    let cursor = 0;
    for (const m of mappings) {
      chunks.push(redactedText.slice(cursor, m.pos));
      chunks.push(m.original);
      cursor = m.pos + m.len;
    }
    chunks.push(redactedText.slice(cursor));

    return ok({
      text: chunks.join(''),
      stats: {
        restoredCount: mappings.length,
        latencyMs: Date.now() - t0,
      },
    });
  }

  compile(
    patternsInput: string,
    options?: MatcherOptions,
  ): Result<CompiledRedactor, RedactError> {
    return this.compileInternal(patternsInput, options);
  }

  redactWithCompiled(
    text: string,
    compiled: CompiledRedactor,
  ): Result<RedactResult, LimitExceededError> {
    const t0 = Date.now();
    const limitCheck = this.checkDocumentLimit(text);
    if (!limitCheck.ok) return limitCheck;
    return ok(this.runRedaction(text, compiled, t0));
  }

  private checkDocumentLimit(
    text: string,
  ): Result<null, LimitExceededError> {
    if (text.length > LIMITS.MAX_DOCUMENT_BYTES) {
      return err(
        limitExceeded(
          'MAX_DOCUMENT_BYTES',
          text.length,
          LIMITS.MAX_DOCUMENT_BYTES,
        ),
      );
    }
    return ok(null);
  }

  private compileInternal(
    patternsInput: string,
    options: MatcherOptions | undefined,
  ): Result<CompiledRedactor, RedactError> {
    const parsed = this.parser.parse(patternsInput, options);
    if (!parsed.ok) return parsed;
    const compiled = this.matcher.compile(parsed.value, options);
    return ok({ compiled, patternCount: parsed.value.length });
  }

  private runRedaction(
    text: string,
    compiled: CompiledRedactor,
    t0: number,
  ): RedactResult {
    const matches = this.matcher.match(text, compiled.compiled);

    const chunks: string[] = [];
    const mappings: Mapping[] = [];
    let cursor = 0;
    let outputPos = 0;

    for (const m of matches) {
      const prefix = text.slice(cursor, m.start);
      chunks.push(prefix);
      outputPos += prefix.length;
      chunks.push(REDACTION_TOKEN);
      mappings.push({
        pos: outputPos,
        len: REDACTION_TOKEN_LEN,
        original: text.slice(m.start, m.end),
      });
      outputPos += REDACTION_TOKEN_LEN;
      cursor = m.end;
    }
    chunks.push(text.slice(cursor));

    const redactedText = chunks.join('');
    const key = this.keySerializer.serialize(mappings);

    return {
      redactedText,
      key,
      stats: {
        patternCount: compiled.patternCount,
        matchCount: matches.length,
        documentBytes: text.length,
        latencyMs: Date.now() - t0,
      },
    };
  }

  private validateIntegrity(
    mappings: readonly Mapping[],
    redactedText: string,
  ): Result<null, IntegrityError> {
    let previousEnd = 0;
    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      if (m === undefined) continue;
      if (m.pos < 0 || m.pos + m.len > redactedText.length) {
        return err(
          integrityErr.positionOutOfBounds(
            i,
            m.pos,
            m.len,
            redactedText.length,
          ),
        );
      }
      if (m.pos < previousEnd) {
        return err(integrityErr.overlappingMappings(i, m.pos, previousEnd));
      }
      const slice = redactedText.slice(m.pos, m.pos + m.len);
      if (slice !== REDACTION_TOKEN) {
        return err(integrityErr.tokenMismatch(i, m.pos, slice));
      }
      previousEnd = m.pos + m.len;
    }
    return ok(null);
  }
}
