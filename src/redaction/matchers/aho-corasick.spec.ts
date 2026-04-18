import { AhoCorasickMatcher } from './aho-corasick.service';
import type { CompiledMatcher } from '../interfaces/compiled-matcher.interface';
import { createPattern, type Pattern } from '../parsers/pattern';

function p(s: string): Pattern {
  const r = createPattern(s);
  if (!r.ok) {
    throw new Error(`invalid pattern in test fixture: "${s}"`);
  }
  return r.value;
}

function pl(...ss: readonly string[]): readonly Pattern[] {
  return ss.map(p);
}

describe('AhoCorasickMatcher', () => {
  let matcher: AhoCorasickMatcher;

  beforeEach(() => {
    matcher = new AhoCorasickMatcher();
  });

  describe('basic matching', () => {
    it('finds a single exact match', () => {
      const c = matcher.compile(pl('beer'));
      const out = matcher.match('I love beer', c);
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({ start: 7, end: 11, pattern: 'beer' });
    });

    it('finds multiple matches of the same pattern', () => {
      const c = matcher.compile(pl('beer'));
      const out = matcher.match('beer beer beer', c);
      expect(out).toHaveLength(3);
      expect(out.map((m) => m.start)).toEqual([0, 5, 10]);
      expect(out.map((m) => m.end)).toEqual([4, 9, 14]);
    });

    it('finds multiple distinct patterns without overlap', () => {
      const c = matcher.compile(pl('beer', 'pizza'));
      const out = matcher.match('beer and pizza', c);
      expect(out).toHaveLength(2);
      expect(out[0]?.pattern).toBe('beer');
      expect(out[1]?.pattern).toBe('pizza');
    });
  });

  describe('leftmost-longest semantics', () => {
    it('prefers longer alternative when both match at the same position', () => {
      const c = matcher.compile(pl('foo', 'foobar'));
      const out = matcher.match('xfoobar', c);
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({ start: 1, end: 7, pattern: 'foobar' });
    });

    it('picks leftmost match when two patterns overlap on different anchors', () => {
      const c = matcher.compile(pl('ab', 'bc'));
      const out = matcher.match('abc', c);
      expect(out).toHaveLength(1);
      expect(out[0]).toEqual({ start: 0, end: 2, pattern: 'ab' });
    });

    it('picks the longest among several overlapping at the same start', () => {
      const c = matcher.compile(pl('a', 'ab', 'abc'));
      const out = matcher.match('abcdef', c);
      expect(out).toHaveLength(1);
      expect(out[0]?.pattern).toBe('abc');
    });
  });

  describe('caseSensitive option', () => {
    it('matches case-insensitively by default', () => {
      const c = matcher.compile(pl('beer'));
      expect(matcher.match('BEER', c)).toHaveLength(1);
      expect(matcher.match('Beer', c)).toHaveLength(1);
      expect(matcher.match('bEeR', c)).toHaveLength(1);
    });

    it('matches case-sensitively when requested', () => {
      const c = matcher.compile(pl('beer'), { caseSensitive: true });
      expect(matcher.match('BEER', c)).toHaveLength(0);
      expect(matcher.match('Beer', c)).toHaveLength(0);
      expect(matcher.match('beer', c)).toHaveLength(1);
    });
  });

  describe('wordBoundaries option', () => {
    it('matches substrings when wordBoundaries is off (default)', () => {
      const c = matcher.compile(pl('beer'));
      expect(matcher.match('beers', c)).toHaveLength(1);
      expect(matcher.match('rootbeer', c)).toHaveLength(1);
    });

    it('matches only whole words when wordBoundaries is on', () => {
      const c = matcher.compile(pl('beer'), { wordBoundaries: true });
      expect(matcher.match('drink beer now', c)).toHaveLength(1);
      expect(matcher.match('beers', c)).toHaveLength(0);
      expect(matcher.match('rootbeer', c)).toHaveLength(0);
    });
  });

  describe('normalizeUnicode option', () => {
    it('matches accented text against unaccented pattern when enabled', () => {
      const c = matcher.compile(pl('cafe'), { normalizeUnicode: true });
      const out = matcher.match('I love café', c);
      expect(out).toHaveLength(1);
      expect(out[0]?.start).toBe(7);
      expect(out[0]?.end).toBe(11);
      const m = out[0];
      if (m) {
        expect('I love café'.slice(m.start, m.end)).toBe('café');
      }
    });

    it('does not match accented text when disabled (default)', () => {
      const c = matcher.compile(pl('cafe'));
      expect(matcher.match('I love café', c)).toHaveLength(0);
    });
  });

  describe('normalizeWhitespace option', () => {
    it('matches collapsed whitespace when enabled', () => {
      const c = matcher.compile(pl('hello world'), {
        normalizeWhitespace: true,
      });
      const text = 'hello  world';
      const out = matcher.match(text, c);
      expect(out).toHaveLength(1);
      const m = out[0];
      if (m) {
        expect(m.start).toBe(0);
        expect(m.end).toBe(text.length);
        expect(text.slice(m.start, m.end)).toBe('hello  world');
      }
    });

    it('does not match double-spaced text when disabled (default)', () => {
      const c = matcher.compile(pl('hello world'));
      expect(matcher.match('hello  world', c)).toHaveLength(0);
    });
  });

  describe('regex metacharacters', () => {
    it('treats metacharacters as literals', () => {
      const c = matcher.compile(pl('foo.bar'));
      expect(matcher.match('foo.bar', c)).toHaveLength(1);
      expect(matcher.match('fooXbar', c)).toHaveLength(0);
    });

    it('escapes a wide range of metacharacters', () => {
      const c = matcher.compile(pl('a+b', 'a(b)', '$10'));
      expect(matcher.match('a+b', c)).toHaveLength(1);
      expect(matcher.match('a(b)', c)).toHaveLength(1);
      expect(matcher.match('price $10 today', c)).toHaveLength(1);
    });

    it('escapes backslash', () => {
      const c = matcher.compile(pl('a\\b'));
      expect(matcher.match('a\\b here', c)).toHaveLength(1);
      expect(matcher.match('ab here', c)).toHaveLength(0);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty pattern list', () => {
      const c = matcher.compile(pl());
      expect(matcher.match('anything here', c)).toEqual([]);
    });

    it('returns empty array for empty text', () => {
      const c = matcher.compile(pl('beer'));
      expect(matcher.match('', c)).toEqual([]);
    });

    it('does not match when no patterns apply', () => {
      const c = matcher.compile(pl('beer'));
      expect(matcher.match('nothing to see here', c)).toEqual([]);
    });

    it('matches at the start of the text', () => {
      const c = matcher.compile(pl('beer'));
      const out = matcher.match('beer at the start', c);
      expect(out[0]?.start).toBe(0);
    });

    it('matches at the end of the text', () => {
      const c = matcher.compile(pl('beer'));
      const text = 'final beer';
      const out = matcher.match(text, c);
      expect(out[0]?.end).toBe(text.length);
    });

    it('returns matches sorted by start ascending', () => {
      const c = matcher.compile(pl('alpha', 'beta', 'gamma'));
      const out = matcher.match('gamma then beta then alpha', c);
      const starts = out.map((m) => m.start);
      expect(starts).toEqual([...starts].sort((a, b) => a - b));
    });
  });

  describe('CompiledMatcher immutability', () => {
    it('freezes the compiled matcher', () => {
      const c = matcher.compile(pl('beer'));
      expect(Object.isFrozen(c)).toBe(true);
    });

    it('freezes the patterns array', () => {
      const c = matcher.compile(pl('beer', 'pizza'));
      expect(Object.isFrozen(c.patterns)).toBe(true);
      expect(() => {
        (c.patterns as unknown as Pattern[]).push('x' as unknown as Pattern);
      }).toThrow();
    });

    it('freezes compiled matcher even with empty pattern list', () => {
      const c = matcher.compile(pl());
      expect(Object.isFrozen(c)).toBe(true);
      expect(Object.isFrozen(c.patterns)).toBe(true);
    });

    it('handles patterns that reduce to empty after transform', () => {
      const combiningOnly = '\u0301' as unknown as Pattern;
      const c = matcher.compile([combiningOnly], { normalizeUnicode: true });
      expect(matcher.match('anything here', c)).toEqual([]);
    });
  });

  describe('runtime guard', () => {
    it('throws when given a CompiledMatcher from another implementation', () => {
      const fake: CompiledMatcher = Object.freeze({
        patterns: Object.freeze(pl('beer')),
        options: {
          caseSensitive: false,
          wordBoundaries: false,
          normalizeUnicode: false,
          normalizeWhitespace: false,
        },
        __matcherId: 'regex',
      });
      expect(() => matcher.match('I love beer', fake)).toThrow(
        /AhoCorasick/i,
      );
    });
  });

  describe('pattern identity', () => {
    it('returns the ORIGINAL pattern (preserves casing) when caseSensitive is off', () => {
      const c = matcher.compile(pl('Beer'));
      const out = matcher.match('I love beer and BEER', c);
      expect(out).toHaveLength(2);
      for (const m of out) {
        expect(m.pattern).toBe('Beer');
      }
    });
  });
});
