export interface Ok<T> { readonly ok: true; readonly value: T }
export interface Err<E> { readonly ok: false; readonly error: E }

export type Result<T, E> = Ok<T> | Err<E>;

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok;

export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok;

export const map = <T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => U,
): Result<U, E> => (r.ok ? ok(fn(r.value)) : r);

export const flatMap = <T, U, E>(
  r: Result<T, E>,
  fn: (value: T) => Result<U, E>,
): Result<U, E> => (r.ok ? fn(r.value) : r);
