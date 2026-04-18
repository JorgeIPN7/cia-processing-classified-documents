import { Injectable } from '@nestjs/common';

import type { CompiledMatcher } from '../interfaces/compiled-matcher.interface';
import type { Match } from '../interfaces/match.interface';
import type { Matcher } from '../interfaces/matcher.interface';
import {
  resolveMatcherOptions,
  type MatcherOptions,
} from '../interfaces/matcher-options.interface';
import type { Pattern } from '../parsers/pattern';
import {
  escapeRegex,
  transformPattern,
  transformText,
} from './text-transform';

const MATCHER_ID = 'regex' as const;

interface RegexCompiledMatcher extends CompiledMatcher {
  readonly __matcherId: typeof MATCHER_ID;
  readonly regex: RegExp | null;
  readonly transformedPatterns: readonly string[];
}

function freezeCompiled(c: RegexCompiledMatcher): RegexCompiledMatcher {
  return Object.freeze(c);
}

@Injectable()
export class RegexMatcher implements Matcher {
  compile(
    patterns: readonly Pattern[],
    options?: MatcherOptions,
  ): CompiledMatcher {
    const resolved = resolveMatcherOptions(options);
    const frozenPatterns: readonly Pattern[] = Object.freeze([...patterns]);
    const transformed = patterns.map((p) => transformPattern(p, resolved));
    const frozenTransformed: readonly string[] = Object.freeze([...transformed]);

    if (patterns.length === 0) {
      return freezeCompiled({
        patterns: frozenPatterns,
        transformedPatterns: frozenTransformed,
        options: resolved,
        regex: null,
        __matcherId: MATCHER_ID,
      });
    }

    const sortedIndices = patterns
      .map((_, idx) => idx)
      .sort((a, b) => {
        const aLen = (transformed[a] ?? '').length;
        const bLen = (transformed[b] ?? '').length;
        return bLen - aLen || a - b;
      });

    const alternatives: string[] = [];
    for (const idx of sortedIndices) {
      const tp = transformed[idx];
      if (tp === undefined || tp.length === 0) continue;
      alternatives.push(escapeRegex(tp));
    }

    if (alternatives.length === 0) {
      return freezeCompiled({
        patterns: frozenPatterns,
        transformedPatterns: frozenTransformed,
        options: resolved,
        regex: null,
        __matcherId: MATCHER_ID,
      });
    }

    let source = alternatives.join('|');
    if (resolved.wordBoundaries) source = `\\b(?:${source})\\b`;
    const flags = resolved.caseSensitive ? 'gu' : 'gui';
    const regex = new RegExp(source, flags);

    return freezeCompiled({
      patterns: frozenPatterns,
      transformedPatterns: frozenTransformed,
      options: resolved,
      regex,
      __matcherId: MATCHER_ID,
    });
  }

  match(text: string, compiled: CompiledMatcher): readonly Match[] {
    if (compiled.__matcherId !== MATCHER_ID) {
      throw new Error('CompiledMatcher was not produced by RegexMatcher');
    }
    const c = compiled as RegexCompiledMatcher;
    if (c.regex === null || text.length === 0) return [];

    const { normalized, offsetMap } = transformText(text, c.options);
    const raw: { start: number; end: number; pattern: Pattern }[] = [];

    for (const m of normalized.matchAll(c.regex)) {
      const matched = m[0];
      const nStart = m.index;
      const nEnd = nStart + matched.length;

      const idx = c.transformedPatterns.indexOf(matched);
      if (idx < 0) continue;

      const originalPattern = c.patterns[idx];
      if (originalPattern === undefined) continue;

      let start: number;
      let end: number;
      if (offsetMap === null) {
        start = nStart;
        end = nEnd;
      } else {
        const ms = offsetMap[nStart];
        const me = offsetMap[nEnd];
        if (ms === undefined || me === undefined) continue;
        start = ms;
        end = me;
      }

      raw.push({ start, end, pattern: originalPattern });
    }

    raw.sort(
      (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
    );

    const out: Match[] = [];
    let lastEnd = -1;
    for (const h of raw) {
      if (h.start >= lastEnd) {
        out.push(h);
        lastEnd = h.end;
      }
    }
    return Object.freeze(out);
  }
}
