import { err, flatMap, isErr, isOk, map, ok, type Result } from './result';

describe('Result', () => {
  describe('ok', () => {
    it('build an Ok variant with the value', () => {
      const r = ok(42);
      expect(r).toEqual({ ok: true, value: 42 });
    });

    it('preserves complex values ​​by reference', () => {
      const payload = { a: 1 } as const;
      const r = ok(payload);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.value).toBe(payload);
      }
    });
  });

  describe('err', () => {
    it('build an Err variant with the error', () => {
      const r = err('boom');
      expect(r).toEqual({ ok: false, error: 'boom' });
    });

    it('accepts discriminated typos', () => {
      interface MyErr {
        kind: 'X';
        reason: string;
      }
      const r = err<MyErr>({ kind: 'X', reason: 'nope' });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe('X');
      }
    });
  });

  describe('isOk / isErr', () => {
    it('isOk devuelve true solo para Ok', () => {
      expect(isOk(ok(1))).toBe(true);
      expect(isOk(err('e'))).toBe(false);
    });

    it('isErr devuelve true solo para Err', () => {
      expect(isErr(err('e'))).toBe(true);
      expect(isErr(ok(1))).toBe(false);
    });

    it('estrecha el tipo tras el guard', () => {
      const r: Result<number, string> = ok(7);
      if (isOk(r)) {
        const v: number = r.value;
        expect(v).toBe(7);
      } else {
        throw new Error('esperaba ok');
      }
    });
  });

  describe('map', () => {
    it('transforma el valor cuando es Ok', () => {
      const r = map(ok(2), (n) => n * 3);
      expect(r).toEqual({ ok: true, value: 6 });
    });

    it('no invoca la función cuando es Err', () => {
      const fn = jest.fn((n: number) => n + 1);
      const r = map<number, number, string>(err('fail'), fn);
      expect(r).toEqual({ ok: false, error: 'fail' });
      expect(fn).not.toHaveBeenCalled();
    });

    it('preserva el tipo de error intacto', () => {
      const input: Result<number, 'E1'> = err('E1');
      const output: Result<string, 'E1'> = map(input, (n) => String(n));
      expect(output).toEqual({ ok: false, error: 'E1' });
    });
  });

  describe('flatMap', () => {
    it('encadena otro Result cuando el primero es Ok', () => {
      const r = flatMap(ok(4), (n) => ok(n.toString()));
      expect(r).toEqual({ ok: true, value: '4' });
    });

    it('propaga el Err inicial sin invocar la función', () => {
      const fn = jest.fn((n: number) => ok(n));
      const r = flatMap<number, number, string>(err('first'), fn);
      expect(r).toEqual({ ok: false, error: 'first' });
      expect(fn).not.toHaveBeenCalled();
    });

    it('propaga el Err devuelto por la función', () => {
      const r = flatMap<number, number, string>(ok(1), () => err('second'));
      expect(r).toEqual({ ok: false, error: 'second' });
    });

    it('permite componer pipelines de múltiples pasos', () => {
      const parse = (s: string): Result<number, string> => {
        const n = Number(s);
        return Number.isFinite(n) ? ok(n) : err(`NaN:${s}`);
      };
      const positive = (n: number): Result<number, string> =>
        n > 0 ? ok(n) : err('non-positive');

      expect(flatMap(parse('5'), positive)).toEqual({ ok: true, value: 5 });
      expect(flatMap(parse('-1'), positive)).toEqual({
        ok: false,
        error: 'non-positive',
      });
      expect(flatMap(parse('abc'), positive)).toEqual({
        ok: false,
        error: 'NaN:abc',
      });
    });
  });
});
