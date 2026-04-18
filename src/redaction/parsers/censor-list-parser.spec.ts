import { LIMITS } from '../../common/limits';
import { isErr, isOk } from '../../common/result';
import { CensorListParserService } from './censor-list-parser.service';
import { createPattern, type Pattern } from './pattern';

describe('CensorListParserService', () => {
  let service: CensorListParserService;

  beforeEach(() => {
    service = new CensorListParserService();
  });

  describe('happy paths', () => {
    it('parses the canonical example from the spec into 6 patterns', () => {
      const input =
        "Hello world \"Boston Red Sox\", 'Pepperoni Pizza', 'Cheese Pizza', beer";
      const result = service.parse(input);

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual([
          'Hello',
          'world',
          'Boston Red Sox',
          'Pepperoni Pizza',
          'Cheese Pizza',
          'beer',
        ]);
      }
    });

    it('accepts opposite-type quotes nested in a quoted token', () => {
      const result = service.parse('"it\'s fine"');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(["it's fine"]);
      }
    });

    it('accepts double quotes inside single-quoted tokens', () => {
      const result = service.parse('\'say "hi"\'');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['say "hi"']);
      }
    });

    it('filters silently empty tokens from multiple separators', () => {
      const result = service.parse('a,,  b , c');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['a', 'b', 'c']);
      }
    });

    it('returns an empty list for an empty input', () => {
      const result = service.parse('');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(0);
      }
    });

    it('returns an empty list for a separator-only input', () => {
      const result = service.parse('  , , ,  ');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(0);
      }
    });

    it('allows \\t \\n \\r inside quoted tokens', () => {
      const result = service.parse('"line1\nline2\tpart\rend"');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['line1\nline2\tpart\rend']);
      }
    });

    it('freezes the result array', () => {
      const result = service.parse('a, b, c');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    });
  });

  describe('quote errors', () => {
    it('fails with UNBALANCED_QUOTE for an unclosed double quote', () => {
      const input = 'hello "world';
      const result = service.parse(input);

      expect(isErr(result)).toBe(true);
      if (!result.ok) {
        expect(result.error.kind).toBe('PARSE_ERROR');
        if (result.error.kind === 'PARSE_ERROR') {
          expect(result.error.details.subKind).toBe('UNBALANCED_QUOTE');
          if (result.error.details.subKind === 'UNBALANCED_QUOTE') {
            expect(result.error.details.position).toBe(input.length);
          }
        }
      }
    });

    it('fails with UNBALANCED_QUOTE for an unclosed single quote', () => {
      const input = "hello 'world";
      const result = service.parse(input);

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('UNBALANCED_QUOTE');
      }
    });

    it('fails with NESTED_SAME_QUOTE when a double quote reappears after closing without separator', () => {
      const input = '"she said "hi""';
      const result = service.parse(input);

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('NESTED_SAME_QUOTE');
        if (result.error.details.subKind === 'NESTED_SAME_QUOTE') {
          expect(result.error.details.position).toBe(13);
        }
      }
    });

    it('fails with NESTED_SAME_QUOTE for adjacent same-type quotes', () => {
      const input = '"foo""bar"';
      const result = service.parse(input);

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('NESTED_SAME_QUOTE');
        if (result.error.details.subKind === 'NESTED_SAME_QUOTE') {
          expect(result.error.details.position).toBe(5);
        }
      }
    });

    it('allows same-type quotes separated by separators', () => {
      const result = service.parse('"foo"  , "bar"');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['foo', 'bar']);
      }
    });

    it('allows opposite-type quotes adjacent without separator', () => {
      const result = service.parse('"foo"\'bar\'');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['foo', 'bar']);
      }
    });

    it('fails with EMPTY_QUOTED_PATTERN for a whitespace-only quoted token', () => {
      const input = 'hello "   "';
      const result = service.parse(input);

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('EMPTY_QUOTED_PATTERN');
        if (result.error.details.subKind === 'EMPTY_QUOTED_PATTERN') {
          expect(result.error.details.position).toBe(6);
        }
      }
    });

    it('fails with EMPTY_QUOTED_PATTERN for an empty quoted token', () => {
      const result = service.parse('""');

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('EMPTY_QUOTED_PATTERN');
      }
    });
  });

  describe('control character errors', () => {
    it('fails with CONTROL_CHAR_IN_PATTERN for \\x00 outside quotes', () => {
      const input = 'hello \x00 world';
      const result = service.parse(input);

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('CONTROL_CHAR_IN_PATTERN');
        if (result.error.details.subKind === 'CONTROL_CHAR_IN_PATTERN') {
          expect(result.error.details.position).toBe(6);
          expect(result.error.details.char).toBe('\x00');
        }
      }
    });

    it('fails for \\t outside quotes', () => {
      const result = service.parse('a\tb');

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('CONTROL_CHAR_IN_PATTERN');
        if (result.error.details.subKind === 'CONTROL_CHAR_IN_PATTERN') {
          expect(result.error.details.position).toBe(1);
          expect(result.error.details.char).toBe('\t');
        }
      }
    });

    it('fails for \\n outside quotes', () => {
      const result = service.parse('a\nb');

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('CONTROL_CHAR_IN_PATTERN');
      }
    });

    it('fails for \\x01 inside double quotes (not a whitelisted control char)', () => {
      const result = service.parse('"abc\x01def"');

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('CONTROL_CHAR_IN_PATTERN');
        if (result.error.details.subKind === 'CONTROL_CHAR_IN_PATTERN') {
          expect(result.error.details.char).toBe('\x01');
        }
      }
    });

    it('fails for \\x1F inside single quotes', () => {
      const result = service.parse("'abc\x1Fdef'");

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('CONTROL_CHAR_IN_PATTERN');
      }
    });
  });

  describe('deduplication', () => {
    it('deduplicates case-insensitively by default', () => {
      const result = service.parse('beer, Beer, BEER');

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]).toBe('beer');
      }
    });

    it('preserves all case variants when caseSensitive is true', () => {
      const result = service.parse('beer, Beer, BEER', { caseSensitive: true });

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['beer', 'Beer', 'BEER']);
      }
    });

    it('deduplicates via NFD + diacritic stripping when normalizeUnicode is true', () => {
      const result = service.parse('café, cafe', { normalizeUnicode: true });

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
      }
    });

    it('keeps diacritic variants separate when normalizeUnicode is false', () => {
      const result = service.parse('café, cafe');

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
      }
    });

    it('collapses whitespace for dedup when normalizeWhitespace is true', () => {
      const result = service.parse('"hello  world", "hello world"', {
        normalizeWhitespace: true,
      });

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
      }
    });

    it('preserves the first occurrence on dedup', () => {
      const result = service.parse('BEER, beer, Beer');

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value[0]).toBe('BEER');
      }
    });
  });

  describe('trim option', () => {
    it('trims non-quoted tokens by default', () => {
      const result = service.parse('   foo   ,bar');

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['foo', 'bar']);
      }
    });

    it('respects quoted tokens literally regardless of trim setting', () => {
      const result = service.parse('"  foo  "');

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['  foo  ']);
      }
    });
  });

  describe('limits', () => {
    it('fails with LIMIT_EXCEEDED when input exceeds MAX_PATTERNS_INPUT_BYTES', () => {
      const oversized = 'a'.repeat(LIMITS.MAX_PATTERNS_INPUT_BYTES + 1);
      const result = service.parse(oversized);

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'LIMIT_EXCEEDED') {
        expect(result.error.details.limit).toBe('MAX_PATTERNS_INPUT_BYTES');
        expect(result.error.details.actual).toBe(oversized.length);
        expect(result.error.details.max).toBe(LIMITS.MAX_PATTERNS_INPUT_BYTES);
      }
    });

    it('fails with LIMIT_EXCEEDED when a pattern exceeds MAX_PATTERN_LENGTH', () => {
      const longPattern = 'x'.repeat(LIMITS.MAX_PATTERN_LENGTH + 1);
      const result = service.parse(longPattern);

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'LIMIT_EXCEEDED') {
        expect(result.error.details.limit).toBe('MAX_PATTERN_LENGTH');
        expect(result.error.details.actual).toBe(LIMITS.MAX_PATTERN_LENGTH + 1);
        expect(result.error.details.max).toBe(LIMITS.MAX_PATTERN_LENGTH);
      }
    });

    it('accepts a pattern at exactly MAX_PATTERN_LENGTH', () => {
      const atLimit = 'y'.repeat(LIMITS.MAX_PATTERN_LENGTH);
      const result = service.parse(atLimit);

      expect(isOk(result)).toBe(true);
    });

    it('fails with LIMIT_EXCEEDED when unique pattern count exceeds MAX_PATTERN_COUNT', () => {
      const parts: string[] = [];
      for (let i = 0; i < LIMITS.MAX_PATTERN_COUNT + 1; i++) {
        parts.push(`p${String(i)}`);
      }
      const result = service.parse(parts.join(','));

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'LIMIT_EXCEEDED') {
        expect(result.error.details.limit).toBe('MAX_PATTERN_COUNT');
        expect(result.error.details.actual).toBe(LIMITS.MAX_PATTERN_COUNT + 1);
        expect(result.error.details.max).toBe(LIMITS.MAX_PATTERN_COUNT);
      }
    });

    it('counts MAX_PATTERN_COUNT after deduplication', () => {
      const parts: string[] = [];
      for (let i = 0; i < LIMITS.MAX_PATTERN_COUNT; i++) {
        parts.push(`p${String(i)}`);
      }
      parts.push('p0', 'p1', 'p2');
      const result = service.parse(parts.join(','));

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(LIMITS.MAX_PATTERN_COUNT);
      }
    });
  });

  describe('coverage of edge paths', () => {
    it('emits a pending non-quoted token when a quote opens without a separator', () => {
      const result = service.parse('foo"bar"');

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['foo', 'bar']);
      }
    });

    it('allows \\t \\n \\r inside single-quoted tokens', () => {
      const result = service.parse("'line1\nline2\tpart\rend'");

      expect(isOk(result)).toBe(true);
      if (result.ok) {
        expect([...result.value]).toEqual(['line1\nline2\tpart\rend']);
      }
    });

    it('fails with LIMIT_EXCEEDED when a quoted pattern exceeds MAX_PATTERN_LENGTH', () => {
      const inside = 'z'.repeat(LIMITS.MAX_PATTERN_LENGTH + 1);
      const result = service.parse(`"${inside}"`);

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'LIMIT_EXCEEDED') {
        expect(result.error.details.limit).toBe('MAX_PATTERN_LENGTH');
      }
    });
  });

  describe('createPattern factory (direct)', () => {
    it('fails on whitespace-only input with EMPTY_QUOTED_PATTERN', () => {
      const result = createPattern('   ');

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('EMPTY_QUOTED_PATTERN');
      }
    });

    it('fails on empty string with EMPTY_QUOTED_PATTERN', () => {
      const result = createPattern('');

      expect(isErr(result)).toBe(true);
      if (!result.ok && result.error.kind === 'PARSE_ERROR') {
        expect(result.error.details.subKind).toBe('EMPTY_QUOTED_PATTERN');
      }
    });
  });

  describe('Pattern branded type', () => {
    it('rejects raw string assignment to Pattern (compile-time)', () => {
      const result = service.parse('hello');
      expect(isOk(result)).toBe(true);
      if (result.ok) {
        const first: Pattern | undefined = result.value[0];
        expect(typeof first).toBe('string');

        // @ts-expect-error — a raw string cannot be assigned to Pattern without the factory
        const _bad: Pattern = 'plain string';
        expect(_bad).toBe('plain string');
      }
    });
  });
});
