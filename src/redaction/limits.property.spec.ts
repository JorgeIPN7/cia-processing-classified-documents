import * as fc from 'fast-check';

import { LIMITS } from '../common/limits';

import { CensorListParserService } from './parsers/censor-list-parser.service';
import { createPattern } from './parsers/pattern';

describe('LIMITS — property-based boundaries', () => {
  describe('MAX_PATTERN_LENGTH', () => {
    it('createPattern accepts any length in [1, MAX_PATTERN_LENGTH]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: LIMITS.MAX_PATTERN_LENGTH }),
          (len) => {
            const raw = 'x'.repeat(len);
            const r = createPattern(raw);
            expect(r.ok).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('createPattern rejects any length in (MAX_PATTERN_LENGTH, MAX+100]', () => {
      fc.assert(
        fc.property(
          fc.integer({
            min: LIMITS.MAX_PATTERN_LENGTH + 1,
            max: LIMITS.MAX_PATTERN_LENGTH + 100,
          }),
          (len) => {
            const raw = 'x'.repeat(len);
            const r = createPattern(raw);
            expect(r.ok).toBe(false);
            if (r.ok) return;
            expect(r.error.kind).toBe('LIMIT_EXCEEDED');
            if (r.error.kind !== 'LIMIT_EXCEEDED') return;
            expect(r.error.details.limit).toBe('MAX_PATTERN_LENGTH');
            expect(r.error.details.actual).toBe(len);
            expect(r.error.details.max).toBe(LIMITS.MAX_PATTERN_LENGTH);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('MAX_PATTERN_COUNT', () => {
    const parser = new CensorListParserService();

    it('parser.parse accepts any unique count in [1, MAX_PATTERN_COUNT]', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: LIMITS.MAX_PATTERN_COUNT }),
          (count) => {
            const input = Array.from(
              { length: count },
              (_, i) => `p${String(i)}`,
            ).join(',');
            const r = parser.parse(input);
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            expect(r.value.length).toBe(count);
          },
        ),
        { numRuns: 50 },
      );
    });

    it('parser.parse rejects any unique count in (MAX_PATTERN_COUNT, MAX+50]', () => {
      fc.assert(
        fc.property(
          fc.integer({
            min: LIMITS.MAX_PATTERN_COUNT + 1,
            max: LIMITS.MAX_PATTERN_COUNT + 50,
          }),
          (count) => {
            const input = Array.from(
              { length: count },
              (_, i) => `p${String(i)}`,
            ).join(',');
            const r = parser.parse(input);
            expect(r.ok).toBe(false);
            if (r.ok) return;
            expect(r.error.kind).toBe('LIMIT_EXCEEDED');
            if (r.error.kind !== 'LIMIT_EXCEEDED') return;
            expect(r.error.details.limit).toBe('MAX_PATTERN_COUNT');
            expect(r.error.details.actual).toBe(count);
            expect(r.error.details.max).toBe(LIMITS.MAX_PATTERN_COUNT);
          },
        ),
        { numRuns: 30 },
      );
    });
  });
});
