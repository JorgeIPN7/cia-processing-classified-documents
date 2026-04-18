import * as fc from 'fast-check';

import { AhoCorasickMatcher } from './aho-corasick.service';
import { RegexMatcher } from './regex.service';
import type { Match } from '../interfaces/match.interface';
import type { MatcherOptions } from '../interfaces/matcher-options.interface';
import { createPattern, type Pattern } from '../parsers/pattern';

interface PlainMatch {
  readonly start: number;
  readonly end: number;
  readonly pattern: string;
}

function toPlain(matches: readonly Match[]): readonly PlainMatch[] {
  return matches.map((m) => ({
    start: m.start,
    end: m.end,
    pattern: String(m.pattern),
  }));
}

const ALPHABET = 'abcABC012 .-_xyz!@#'.split('');

const asciiUnit = fc.constantFrom(...ALPHABET);

const patternArb = fc
  .string({ minLength: 1, maxLength: 20, unit: asciiUnit })
  .filter((s) => s.trim().length > 0)
  .map((s) => {
    const r = createPattern(s);
    if (!r.ok) {
      throw new Error(`fixture generated an invalid pattern: "${s}"`);
    }
    return r.value;
  });

const patternsArb = fc.array(patternArb, { minLength: 1, maxLength: 10 });

const textArb = fc.string({ minLength: 0, maxLength: 200, unit: asciiUnit });

const optionsArb: fc.Arbitrary<MatcherOptions> = fc.record({
  caseSensitive: fc.boolean(),
  wordBoundaries: fc.boolean(),
  normalizeUnicode: fc.boolean(),
  normalizeWhitespace: fc.boolean(),
});

describe('matchers equivalence (AhoCorasick == Regex)', () => {
  const regex = new RegexMatcher();
  const ac = new AhoCorasickMatcher();

  it('produces identical Match[] for arbitrary patterns, text, and options', () => {
    fc.assert(
      fc.property(
        patternsArb,
        textArb,
        optionsArb,
        (patterns: readonly Pattern[], text: string, options: MatcherOptions) => {
          const cR = regex.compile(patterns, options);
          const cA = ac.compile(patterns, options);
          const mR = toPlain(regex.match(text, cR));
          const mA = toPlain(ac.match(text, cA));
          expect(mA).toEqual(mR);
        },
      ),
      { numRuns: 1000, verbose: true },
    );
  });

  describe('known tricky cases', () => {
    it('shared-suffix patterns: a, ab, bc, abc on text "xabcyabz"', () => {
      const patterns = [
        createPattern('a'),
        createPattern('ab'),
        createPattern('bc'),
        createPattern('abc'),
      ].map((r) => {
        if (!r.ok) throw new Error('fixture');
        return r.value;
      });
      const text = 'xabcyabz';
      const cR = regex.compile(patterns);
      const cA = ac.compile(patterns);
      expect(toPlain(ac.match(text, cA))).toEqual(toPlain(regex.match(text, cR)));
    });

    it('duplicate patterns after case-insensitive transform', () => {
      const patterns = [
        createPattern('Beer'),
        createPattern('BEER'),
        createPattern('beer'),
      ].map((r) => {
        if (!r.ok) throw new Error('fixture');
        return r.value;
      });
      const text = 'I love beer and BEER and Beer';
      const cR = regex.compile(patterns);
      const cA = ac.compile(patterns);
      expect(toPlain(ac.match(text, cA))).toEqual(toPlain(regex.match(text, cR)));
    });

    it('normalizeWhitespace collapses inner whitespace with offset mapping', () => {
      const patterns = [createPattern('hello world')].map((r) => {
        if (!r.ok) throw new Error('fixture');
        return r.value;
      });
      const text = '  hello   world  and hello\t\tworld';
      const options: MatcherOptions = { normalizeWhitespace: true };
      const cR = regex.compile(patterns, options);
      const cA = ac.compile(patterns, options);
      expect(toPlain(ac.match(text, cA))).toEqual(toPlain(regex.match(text, cR)));
    });

    it('normalizeUnicode with combining marks in text and patterns', () => {
      const patterns = [createPattern('cafe'), createPattern('naive')].map((r) => {
        if (!r.ok) throw new Error('fixture');
        return r.value;
      });
      const text = 'visit a café or be naïve, or both café';
      const options: MatcherOptions = { normalizeUnicode: true };
      const cR = regex.compile(patterns, options);
      const cA = ac.compile(patterns, options);
      expect(toPlain(ac.match(text, cA))).toEqual(toPlain(regex.match(text, cR)));
    });

    it('wordBoundaries excludes substring-only matches', () => {
      const patterns = [createPattern('beer'), createPattern('root')].map((r) => {
        if (!r.ok) throw new Error('fixture');
        return r.value;
      });
      const text = 'rootbeer and root beer and beers';
      const options: MatcherOptions = { wordBoundaries: true };
      const cR = regex.compile(patterns, options);
      const cA = ac.compile(patterns, options);
      expect(toPlain(ac.match(text, cA))).toEqual(toPlain(regex.match(text, cR)));
    });
  });
});
