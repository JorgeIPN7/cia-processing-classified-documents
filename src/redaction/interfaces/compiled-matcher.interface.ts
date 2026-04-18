import type { Pattern } from '../parsers/pattern';
import type { ResolvedMatcherOptions } from './matcher-options.interface';

export interface CompiledMatcher {
  readonly patterns: readonly Pattern[];
  readonly options: ResolvedMatcherOptions;
  readonly __matcherId: string;
}
