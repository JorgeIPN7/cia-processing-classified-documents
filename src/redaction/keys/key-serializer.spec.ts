import { gzipSync } from 'node:zlib';
import * as fc from 'fast-check';

import { LIMITS } from '../../common/limits';

import type { DeserializeError } from './deserialize-error';
import { KeySerializerService } from './key-serializer.service';
import type { Mapping } from './mapping.interface';
import { createRedactionKey, type RedactionKey } from './redaction-key';

function keyFromObject(obj: unknown): RedactionKey {
  const json = JSON.stringify(obj);
  const gz = gzipSync(Buffer.from(json, 'utf8'));
  return createRedactionKey(gz.toString('base64url'));
}

function keyFromText(text: string): RedactionKey {
  const gz = gzipSync(Buffer.from(text, 'utf8'));
  return createRedactionKey(gz.toString('base64url'));
}

function keyFromRawBytes(bytes: readonly number[]): RedactionKey {
  return createRedactionKey(Buffer.from(bytes).toString('base64url'));
}

function assertInvalidKey(
  error: unknown,
): asserts error is DeserializeError {
  const e = error as { kind?: string };
  if (e.kind !== 'INVALID_KEY') {
    throw new Error(`expected INVALID_KEY, got ${String(e.kind)}`);
  }
}

describe('KeySerializerService', () => {
  let serializer: KeySerializerService;

  beforeEach(() => {
    serializer = new KeySerializerService();
  });

  describe('serialize + deserialize round-trip', () => {
    it('handles empty mappings', () => {
      const key = serializer.serialize([]);
      expect(typeof key).toBe('string');
      expect(key.length).toBeGreaterThan(0);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual([]);
    });

    it('round-trips the canonical single mapping from the spec', () => {
      const mappings: readonly Mapping[] = [
        { pos: 7, len: 4, original: 'Cheese Pizza' },
      ];
      const key = serializer.serialize(mappings);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(mappings);
    });

    it('round-trips multiple heterogeneous mappings', () => {
      const mappings: readonly Mapping[] = [
        { pos: 7, len: 4, original: 'Cheese Pizza' },
        { pos: 16, len: 4, original: 'beer' },
        { pos: 24, len: 4, original: 'Boston Red Sox' },
      ];
      const key = serializer.serialize(mappings);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(mappings);
    });

    it('preserves Unicode, emojis, quotes, and backslashes in `original`', () => {
      const mappings: readonly Mapping[] = [
        { pos: 0, len: 4, original: 'café ☕' },
        { pos: 5, len: 4, original: '🎯 target 🚀' },
        { pos: 10, len: 4, original: 'she said "hi"' },
        { pos: 15, len: 4, original: "it's fine" },
        { pos: 20, len: 4, original: 'path\\to\\file' },
        { pos: 25, len: 4, original: 'line\nbreak\ttab' },
      ];
      const key = serializer.serialize(mappings);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(mappings);
    });

    it('accepts empty `original`', () => {
      const mappings: readonly Mapping[] = [{ pos: 0, len: 4, original: '' }];
      const key = serializer.serialize(mappings);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(mappings);
    });

    it('handles large `pos` values', () => {
      const mappings: readonly Mapping[] = [
        { pos: 1_000_000, len: 4, original: 'far away' },
      ];
      const key = serializer.serialize(mappings);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual(mappings);
    });
  });

  describe('deserialize errors', () => {
    it('rejects non-base64url input with INVALID_BASE64', () => {
      const key = createRedactionKey('!!!not base64!!!');
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      assertInvalidKey(result.error);
      expect(result.error.details.subKind).toBe('INVALID_BASE64');
    });

    it('rejects valid base64url that is not gzip with INVALID_GZIP', () => {
      const key = keyFromRawBytes([0x00, 0x01, 0x02]);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      assertInvalidKey(result.error);
      expect(result.error.details.subKind).toBe('INVALID_GZIP');
    });

    it('rejects an empty key string with INVALID_GZIP (empty gzip payload)', () => {
      const key = createRedactionKey('');
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      assertInvalidKey(result.error);
      expect(result.error.details.subKind).toBe('INVALID_GZIP');
    });

    it('rejects gzipped non-JSON with INVALID_JSON', () => {
      const key = keyFromText('not json {');
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      assertInvalidKey(result.error);
      expect(result.error.details.subKind).toBe('INVALID_JSON');
    });

    it.each([
      ['missing v', { m: [] }],
      ['v === 2', { v: 2, m: [] }],
      ['v as string', { v: '1', m: [] }],
      ['v as null', { v: null, m: [] }],
    ])('rejects unsupported version: %s', (_label, payload) => {
      const key = keyFromObject(payload);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      assertInvalidKey(result.error);
      expect(result.error.details.subKind).toBe('UNSUPPORTED_VERSION');
    });

    it.each([
      ['root is null', null],
      ['root is array', [1, 2, 3]],
      ['root is string', '"just a string"'],
    ])('rejects malformed root: %s', (_label, payload) => {
      const key = keyFromText(JSON.stringify(payload));
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      assertInvalidKey(result.error);
      expect(result.error.details.subKind).toBe('INVALID_SHAPE');
    });

    it('rejects when m is not an array', () => {
      const key = keyFromObject({ v: 1, m: 'not an array' });
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      assertInvalidKey(result.error);
      expect(result.error.details.subKind).toBe('INVALID_SHAPE');
      if (result.error.details.subKind !== 'INVALID_SHAPE') return;
      expect(result.error.details.path).toBe('$.m');
    });

    it.each([
      ['item is null', { v: 1, m: [null] }, '$.m[0]'],
      ['item is string', { v: 1, m: ['oops'] }, '$.m[0]'],
      [
        'missing pos',
        { v: 1, m: [{ len: 4, original: 'x' }] },
        '$.m[0].pos',
      ],
      [
        'pos is string',
        { v: 1, m: [{ pos: '7', len: 4, original: 'x' }] },
        '$.m[0].pos',
      ],
      [
        'pos is negative',
        { v: 1, m: [{ pos: -1, len: 4, original: 'x' }] },
        '$.m[0].pos',
      ],
      [
        'pos is NaN',
        { v: 1, m: [{ pos: Number.NaN, len: 4, original: 'x' }] },
        '$.m[0].pos',
      ],
      [
        'pos is float',
        { v: 1, m: [{ pos: 1.5, len: 4, original: 'x' }] },
        '$.m[0].pos',
      ],
      [
        'missing len',
        { v: 1, m: [{ pos: 0, original: 'x' }] },
        '$.m[0].len',
      ],
      [
        'len is negative',
        { v: 1, m: [{ pos: 0, len: -4, original: 'x' }] },
        '$.m[0].len',
      ],
      [
        'missing original',
        { v: 1, m: [{ pos: 0, len: 4 }] },
        '$.m[0].original',
      ],
      [
        'original is number',
        { v: 1, m: [{ pos: 0, len: 4, original: 42 }] },
        '$.m[0].original',
      ],
    ])('rejects mapping shape violation: %s', (_label, payload, expectedPath) => {
      const key = keyFromObject(payload);
      const result = serializer.deserialize(key);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      assertInvalidKey(result.error);
      expect(result.error.details.subKind).toBe('INVALID_SHAPE');
      if (result.error.details.subKind !== 'INVALID_SHAPE') return;
      expect(result.error.details.path).toBe(expectedPath);
    });
  });

  describe('size limit', () => {
    it('rejects keys exceeding MAX_KEY_BYTES with LimitExceededError', () => {
      const oversized = createRedactionKey(
        'A'.repeat(LIMITS.MAX_KEY_BYTES + 1),
      );
      const result = serializer.deserialize(oversized);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('LIMIT_EXCEEDED');
      if (result.error.kind !== 'LIMIT_EXCEEDED') return;
      expect(result.error.details.limit).toBe('MAX_KEY_BYTES');
      expect(result.error.details.actual).toBe(LIMITS.MAX_KEY_BYTES + 1);
      expect(result.error.details.max).toBe(LIMITS.MAX_KEY_BYTES);
    });

    it('accepts keys exactly at MAX_KEY_BYTES for size check (fails later on gzip)', () => {
      const atLimit = createRedactionKey('A'.repeat(LIMITS.MAX_KEY_BYTES));
      const result = serializer.deserialize(atLimit);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.kind).toBe('INVALID_KEY');
    });
  });

  describe('property-based round-trip', () => {
    const mappingArb: fc.Arbitrary<Mapping> = fc.record({
      pos: fc.nat(),
      len: fc.constant(4),
      original: fc.string({ minLength: 0, maxLength: 100 }),
    });

    it('serialize ∘ deserialize is identity for arbitrary mappings', () => {
      fc.assert(
        fc.property(
          fc.array(mappingArb, { minLength: 0, maxLength: 50 }),
          (mappings) => {
            const key = serializer.serialize(mappings);
            const result = serializer.deserialize(key);
            if (!result.ok) {
              throw new Error(
                `deserialize failed: ${JSON.stringify(result.error)}`,
              );
            }
            expect(result.value).toEqual(mappings);
          },
        ),
        { numRuns: 500 },
      );
    });
  });
});
