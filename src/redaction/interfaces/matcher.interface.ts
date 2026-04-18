import type { CompiledMatcher } from './compiled-matcher.interface';
import type { Match } from './match.interface';
import type { MatcherOptions } from './matcher-options.interface';
import type { Pattern } from '../parsers/pattern';

export interface Matcher {
  compile(
    patterns: readonly Pattern[],
    options?: MatcherOptions,
  ): CompiledMatcher;
  match(text: string, compiled: CompiledMatcher): readonly Match[];
}

export const MATCHER = Symbol('Matcher');
