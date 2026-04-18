import type { Pattern } from '../parsers/pattern';

export interface Match {
  readonly start: number;
  readonly end: number;
  readonly pattern: Pattern;
}
