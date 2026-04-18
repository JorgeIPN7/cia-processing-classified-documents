import * as fc from 'fast-check';

import { LIMITS } from '../common/limits';
import type { Ok, Result } from '../common/result';

import { KeySerializerService } from './keys/key-serializer.service';
import type { Mapping } from './keys/mapping.interface';
import { createRedactionKey } from './keys/redaction-key';
import { AhoCorasickMatcher } from './matchers/aho-corasick.service';
import { CensorListParserService } from './parsers/censor-list-parser.service';
import { RedactionService } from './redaction.service';

function assertOk<T, E>(r: Result<T, E>): asserts r is Ok<T> {
  if (!r.ok) {
    throw new Error(`expected ok, got err: ${JSON.stringify(r.error)}`);
  }
}

describe('RedactionService', () => {
  let parser: CensorListParserService;
  let matcher: AhoCorasickMatcher;
  let keySerializer: KeySerializerService;
  let service: RedactionService;

  beforeEach(() => {
    parser = new CensorListParserService();
    matcher = new AhoCorasickMatcher();
    keySerializer = new KeySerializerService();
    service = new RedactionService(parser, matcher, keySerializer);
  });

  describe('redact — happy paths', () => {
    it('redacts the canonical assignment example', () => {
      const text = 'I love Cheese Pizza and beer at Boston Red Sox games';
      const patterns =
        'Hello world "Boston Red Sox", \'Pepperoni Pizza\', \'Cheese Pizza\', beer';

      const r = service.redact(text, patterns);
      assertOk(r);

      expect(r.value.redactedText).toBe('I love XXXX and XXXX at XXXX games');
      expect(r.value.stats.matchCount).toBe(3);
      expect(r.value.stats.patternCount).toBe(6);
      expect(r.value.stats.documentBytes).toBe(text.length);
      expect(String(r.value.key).length).toBeGreaterThan(0);
    });

    it('returns input unchanged when no patterns match', () => {
      const text = 'the quick brown fox';
      const r = service.redact(text, 'absent,missing');
      assertOk(r);
      expect(r.value.redactedText).toBe(text);
      expect(r.value.stats.matchCount).toBe(0);
      expect(r.value.stats.patternCount).toBe(2);
    });

    it('honors leftmost-longest semantics for overlapping patterns', () => {
      const r = service.redact('foobar', 'foo,foobar');
      assertOk(r);
      expect(r.value.redactedText).toBe('XXXX');
      expect(r.value.stats.matchCount).toBe(1);
    });

    it('preserves spacing between adjacent redactions', () => {
      const r = service.redact('beer beer', 'beer');
      assertOk(r);
      expect(r.value.redactedText).toBe('XXXX XXXX');
      expect(r.value.stats.matchCount).toBe(2);
    });

    it('honors caseSensitive=true', () => {
      const r = service.redact('BEER and beer', 'beer', {
        caseSensitive: true,
      });
      assertOk(r);
      expect(r.value.redactedText).toBe('BEER and XXXX');
      expect(r.value.stats.matchCount).toBe(1);
    });

    it('honors wordBoundaries=true (excludes "beers")', () => {
      const r = service.redact('rootbeer and beer and beers', 'beer', {
        wordBoundaries: true,
      });
      assertOk(r);
      expect(r.value.stats.matchCount).toBe(1);
      expect(r.value.redactedText).toBe('rootbeer and XXXX and beers');
    });

    it('dedupes patterns case-insensitively by default', () => {
      const r = service.redact('beer Beer BEER', 'beer,Beer,BEER');
      assertOk(r);
      expect(r.value.stats.patternCount).toBe(1);
      expect(r.value.stats.matchCount).toBe(3);
      expect(r.value.redactedText).toBe('XXXX XXXX XXXX');
    });

    it('keeps case-distinct patterns when caseSensitive=true', () => {
      const r = service.redact('beer Beer BEER', 'beer,Beer,BEER', {
        caseSensitive: true,
      });
      assertOk(r);
      expect(r.value.stats.patternCount).toBe(3);
      expect(r.value.stats.matchCount).toBe(3);
      expect(r.value.redactedText).toBe('XXXX XXXX XXXX');
    });
  });

  describe('redact — errors', () => {
    it('rejects documents exceeding MAX_DOCUMENT_BYTES', () => {
      const oversized = 'a'.repeat(LIMITS.MAX_DOCUMENT_BYTES + 1);
      const r = service.redact(oversized, 'beer');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('LIMIT_EXCEEDED');
      if (r.error.kind !== 'LIMIT_EXCEEDED') return;
      expect(r.error.details.limit).toBe('MAX_DOCUMENT_BYTES');
      expect(r.error.details.actual).toBe(LIMITS.MAX_DOCUMENT_BYTES + 1);
      expect(r.error.details.max).toBe(LIMITS.MAX_DOCUMENT_BYTES);
    });

    it('propagates PARSE_ERROR on unbalanced quotes', () => {
      const r = service.redact('any text', '"unbalanced');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('PARSE_ERROR');
      if (r.error.kind !== 'PARSE_ERROR') return;
      expect(r.error.details.subKind).toBe('UNBALANCED_QUOTE');
    });

    it('propagates LIMIT_EXCEEDED (MAX_PATTERN_COUNT) from parser', () => {
      const tooMany = Array.from(
        { length: LIMITS.MAX_PATTERN_COUNT + 1 },
        (_, i) => `p${String(i)}`,
      ).join(',');
      const r = service.redact('text', tooMany);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('LIMIT_EXCEEDED');
      if (r.error.kind !== 'LIMIT_EXCEEDED') return;
      expect(r.error.details.limit).toBe('MAX_PATTERN_COUNT');
    });

    it('propagates LIMIT_EXCEEDED (MAX_PATTERNS_INPUT_BYTES) from parser', () => {
      const huge = 'a'.repeat(LIMITS.MAX_PATTERNS_INPUT_BYTES + 1);
      const r = service.redact('text', huge);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('LIMIT_EXCEEDED');
      if (r.error.kind !== 'LIMIT_EXCEEDED') return;
      expect(r.error.details.limit).toBe('MAX_PATTERNS_INPUT_BYTES');
    });
  });

  describe('redact — at-limit boundaries', () => {
    it(
      'accepts a document at exactly MAX_DOCUMENT_BYTES',
      () => {
        const atLimit = 'a'.repeat(LIMITS.MAX_DOCUMENT_BYTES);
        const r = service.redact(atLimit, 'beer');
        assertOk(r);
        expect(r.value.stats.documentBytes).toBe(LIMITS.MAX_DOCUMENT_BYTES);
        expect(r.value.stats.matchCount).toBe(0);
      },
      60_000,
    );

    it(
      'accepts patterns input at exactly MAX_PATTERNS_INPUT_BYTES',
      () => {
        const L = LIMITS.MAX_PATTERN_LENGTH;
        const target = LIMITS.MAX_PATTERNS_INPUT_BYTES;
        const fullCount = Math.floor((target + 1) / (L + 1));
        const idxWidth = String(fullCount).length;
        const parts: string[] = [];
        for (let i = 0; i < fullCount; i++) {
          const idx = String(i).padStart(idxWidth, '0');
          parts.push(`p${idx}${'a'.repeat(L - 1 - idxWidth)}`);
        }
        const baseLen = fullCount * L + (fullCount - 1);
        const tailLen = target - baseLen - 1;
        if (tailLen > 0) {
          parts.push(`z${'y'.repeat(tailLen - 1)}`);
        }
        const input = parts.join(',');
        expect(input.length).toBe(target);

        const r = service.redact('no matches in this short text', input);
        assertOk(r);
        expect(r.value.stats.matchCount).toBe(0);
      },
      60_000,
    );
  });

  describe('unredact — happy paths (round-trip)', () => {
    it('round-trips the canonical example', () => {
      const text = 'I love Cheese Pizza and beer at Boston Red Sox games';
      const patterns =
        'Hello world "Boston Red Sox", \'Pepperoni Pizza\', \'Cheese Pizza\', beer';
      const r = service.redact(text, patterns);
      assertOk(r);
      const u = service.unredact(r.value.redactedText, r.value.key);
      assertOk(u);
      expect(u.value.text).toBe(text);
      expect(u.value.stats.restoredCount).toBe(3);
    });

    it('round-trips text with emojis and Unicode patterns', () => {
      const text = 'visit a café ☕ or 🎯 target at 🚀 launch';
      const patternsInput = '"café ☕", "🎯 target"';
      const r = service.redact(text, patternsInput);
      assertOk(r);
      const u = service.unredact(r.value.redactedText, r.value.key);
      assertOk(u);
      expect(u.value.text).toBe(text);
    });

    it('round-trips text with inner quotes inside patterns', () => {
      const text = 'she said "hi" to us';
      const patternsInput = '\'said "hi"\'';
      const r = service.redact(text, patternsInput);
      assertOk(r);
      const u = service.unredact(r.value.redactedText, r.value.key);
      assertOk(u);
      expect(u.value.text).toBe(text);
    });

    it('round-trips when the document already contains XXXX literally', () => {
      const text = 'XXXX beer XXXX';
      const r = service.redact(text, 'beer');
      assertOk(r);
      expect(r.value.redactedText).toBe('XXXX XXXX XXXX');
      const u = service.unredact(r.value.redactedText, r.value.key);
      assertOk(u);
      expect(u.value.text).toBe(text);
    });

    it('round-trips with zero matches (empty mappings key)', () => {
      const text = 'hello world';
      const r = service.redact(text, 'absent');
      assertOk(r);
      const u = service.unredact(r.value.redactedText, r.value.key);
      assertOk(u);
      expect(u.value.text).toBe(text);
      expect(u.value.stats.restoredCount).toBe(0);
    });
  });

  describe('unredact — errors', () => {
    it('rejects malformed base64 with INVALID_KEY / INVALID_BASE64', () => {
      const badKey = createRedactionKey('!!!not base64!!!');
      const u = service.unredact('XXXX and XXXX', badKey);
      expect(u.ok).toBe(false);
      if (u.ok) return;
      expect(u.error.kind).toBe('INVALID_KEY');
      if (u.error.kind !== 'INVALID_KEY') return;
      expect(u.error.details.subKind).toBe('INVALID_BASE64');
    });

    it('rejects tampered redactedText with TOKEN_MISMATCH', () => {
      const r = service.redact('love beer', 'beer');
      assertOk(r);
      const tampered = r.value.redactedText.replace('XXXX', 'YYYY');
      const u = service.unredact(tampered, r.value.key);
      expect(u.ok).toBe(false);
      if (u.ok) return;
      expect(u.error.kind).toBe('KEY_INTEGRITY_FAILURE');
      if (u.error.kind !== 'KEY_INTEGRITY_FAILURE') return;
      expect(u.error.details.subKind).toBe('TOKEN_MISMATCH');
      if (u.error.details.subKind !== 'TOKEN_MISMATCH') return;
      expect(u.error.details.actual).toBe('YYYY');
    });

    it('rejects a key with pos out of bounds', () => {
      const bogus: readonly Mapping[] = [
        { pos: 9_999, len: 4, original: 'x' },
      ];
      const key = keySerializer.serialize(bogus);
      const u = service.unredact('short text', key);
      expect(u.ok).toBe(false);
      if (u.ok) return;
      expect(u.error.kind).toBe('KEY_INTEGRITY_FAILURE');
      if (u.error.kind !== 'KEY_INTEGRITY_FAILURE') return;
      expect(u.error.details.subKind).toBe('POSITION_OUT_OF_BOUNDS');
      if (u.error.details.subKind !== 'POSITION_OUT_OF_BOUNDS') return;
      expect(u.error.details.index).toBe(0);
      expect(u.error.details.pos).toBe(9_999);
      expect(u.error.details.redactedLength).toBe('short text'.length);
    });

    it('rejects a key with overlapping mappings', () => {
      const overlapping: readonly Mapping[] = [
        { pos: 0, len: 4, original: 'a' },
        { pos: 2, len: 4, original: 'b' },
      ];
      const key = keySerializer.serialize(overlapping);
      const u = service.unredact('XXXXXXXX', key);
      expect(u.ok).toBe(false);
      if (u.ok) return;
      expect(u.error.kind).toBe('KEY_INTEGRITY_FAILURE');
      if (u.error.kind !== 'KEY_INTEGRITY_FAILURE') return;
      expect(u.error.details.subKind).toBe('OVERLAPPING_MAPPINGS');
      if (u.error.details.subKind !== 'OVERLAPPING_MAPPINGS') return;
      expect(u.error.details.index).toBe(1);
      expect(u.error.details.pos).toBe(2);
      expect(u.error.details.previousEnd).toBe(4);
    });

    it('rejects mappings out of order (detected as overlap)', () => {
      const outOfOrder: readonly Mapping[] = [
        { pos: 10, len: 4, original: 'second' },
        { pos: 0, len: 4, original: 'first' },
      ];
      const key = keySerializer.serialize(outOfOrder);
      const u = service.unredact('XXXX 12345XXXX', key);
      expect(u.ok).toBe(false);
      if (u.ok) return;
      expect(u.error.kind).toBe('KEY_INTEGRITY_FAILURE');
      if (u.error.kind !== 'KEY_INTEGRITY_FAILURE') return;
      expect(u.error.details.subKind).toBe('OVERLAPPING_MAPPINGS');
    });

    it('rejects a key pointing at a non-XXXX slice', () => {
      const bogus: readonly Mapping[] = [
        { pos: 0, len: 4, original: 'x' },
      ];
      const key = keySerializer.serialize(bogus);
      const u = service.unredact('abcdEFGH', key);
      expect(u.ok).toBe(false);
      if (u.ok) return;
      expect(u.error.kind).toBe('KEY_INTEGRITY_FAILURE');
      if (u.error.kind !== 'KEY_INTEGRITY_FAILURE') return;
      expect(u.error.details.subKind).toBe('TOKEN_MISMATCH');
      if (u.error.details.subKind !== 'TOKEN_MISMATCH') return;
      expect(u.error.details.actual).toBe('abcd');
    });

    it('rejects redactedText exceeding MAX_DOCUMENT_BYTES', () => {
      const oversized = 'a'.repeat(LIMITS.MAX_DOCUMENT_BYTES + 1);
      const u = service.unredact(oversized, createRedactionKey('x'));
      expect(u.ok).toBe(false);
      if (u.ok) return;
      expect(u.error.kind).toBe('LIMIT_EXCEEDED');
      if (u.error.kind !== 'LIMIT_EXCEEDED') return;
      expect(u.error.details.limit).toBe('MAX_DOCUMENT_BYTES');
    });
  });

  describe('low-level API (compile + redactWithCompiled)', () => {
    it('reuses a compiled redactor across multiple texts', () => {
      const compiled = service.compile('beer,pizza');
      assertOk(compiled);
      expect(compiled.value.patternCount).toBe(2);

      const r1 = service.redactWithCompiled('I love beer', compiled.value);
      assertOk(r1);
      expect(r1.value.redactedText).toBe('I love XXXX');

      const r2 = service.redactWithCompiled('only pizza here', compiled.value);
      assertOk(r2);
      expect(r2.value.redactedText).toBe('only XXXX here');

      expect(r1.value.stats.patternCount).toBe(2);
      expect(r2.value.stats.patternCount).toBe(2);
    });

    it('matches redact() exactly when given the same inputs', () => {
      const patternsInput = 'beer,pizza,"red sox"';
      const text = 'beer and pizza at red sox';

      const oneShot = service.redact(text, patternsInput);
      assertOk(oneShot);

      const compiled = service.compile(patternsInput);
      assertOk(compiled);
      const reused = service.redactWithCompiled(text, compiled.value);
      assertOk(reused);

      expect(reused.value.redactedText).toBe(oneShot.value.redactedText);
      expect(reused.value.stats.matchCount).toBe(oneShot.value.stats.matchCount);
      expect(reused.value.stats.patternCount).toBe(
        oneShot.value.stats.patternCount,
      );
    });

    it('compile propagates parse errors', () => {
      const r = service.compile('"unbalanced');
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('PARSE_ERROR');
    });

    it('redactWithCompiled rejects oversized documents', () => {
      const compiled = service.compile('beer');
      assertOk(compiled);
      const oversized = 'a'.repeat(LIMITS.MAX_DOCUMENT_BYTES + 1);
      const r = service.redactWithCompiled(oversized, compiled.value);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.kind).toBe('LIMIT_EXCEEDED');
      expect(r.error.details.limit).toBe('MAX_DOCUMENT_BYTES');
    });
  });

  describe('stats', () => {
    it('reports documentBytes = text.length', () => {
      const text = 'hello world beer';
      const r = service.redact(text, 'beer');
      assertOk(r);
      expect(r.value.stats.documentBytes).toBe(text.length);
    });

    it('reports latencyMs as a non-negative integer', () => {
      const r = service.redact('hello', 'x');
      assertOk(r);
      expect(r.value.stats.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(r.value.stats.latencyMs)).toBe(true);
    });

    it('reports unredact latencyMs as a non-negative integer', () => {
      const r = service.redact('hello beer', 'beer');
      assertOk(r);
      const u = service.unredact(r.value.redactedText, r.value.key);
      assertOk(u);
      expect(u.value.stats.latencyMs).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(u.value.stats.latencyMs)).toBe(true);
    });
  });

  describe('property-based round-trip', () => {
    const PATTERN_ALPHABET = 'abcdefgh0123'.split('');
    const patternUnit = fc.constantFrom(...PATTERN_ALPHABET);
    const patternArb = fc.string({
      minLength: 1,
      maxLength: 8,
      unit: patternUnit,
    });
    const patternsArb = fc.array(patternArb, { minLength: 1, maxLength: 5 });

    const TEXT_ALPHABET = 'abcdefgh0123 .XY'.split('');
    const textUnit = fc.constantFrom(...TEXT_ALPHABET);
    const textArb = fc.string({
      minLength: 0,
      maxLength: 200,
      unit: textUnit,
    });

    it('redact ∘ unredact is identity for arbitrary ASCII inputs', () => {
      fc.assert(
        fc.property(patternsArb, textArb, (patterns, text) => {
          const input = patterns.join(',');
          const r = service.redact(text, input);
          if (!r.ok) return;
          const u = service.unredact(r.value.redactedText, r.value.key);
          if (!u.ok) {
            throw new Error(
              `unredact failed unexpectedly: ${JSON.stringify(u.error)}`,
            );
          }
          expect(u.value.text).toBe(text);
        }),
        { numRuns: 500 },
      );
    });
  });
});
