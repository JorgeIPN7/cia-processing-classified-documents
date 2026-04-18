export type ErrorKind =
  | 'PARSE_ERROR'
  | 'LIMIT_EXCEEDED'
  | 'INVALID_KEY'
  | 'KEY_INTEGRITY_FAILURE'
  | 'INTERNAL_ERROR';

export type DomainError<
  K extends ErrorKind,
  D extends Readonly<Record<string, unknown>> | undefined = undefined,
> = D extends undefined
  ? { readonly kind: K; readonly message: string }
  : { readonly kind: K; readonly message: string; readonly details: D };

export const ERROR_KIND_TO_HTTP = {
  PARSE_ERROR: 400,
  LIMIT_EXCEEDED: 413,
  INVALID_KEY: 400,
  KEY_INTEGRITY_FAILURE: 422,
  INTERNAL_ERROR: 500,
} as const satisfies Record<ErrorKind, number>;

export const ERROR_KIND_TO_CODE = {
  PARSE_ERROR: 'PARSE_ERROR',
  LIMIT_EXCEEDED: 'PAYLOAD_TOO_LARGE',
  INVALID_KEY: 'INVALID_KEY',
  KEY_INTEGRITY_FAILURE: 'KEY_INTEGRITY_FAILURE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const satisfies Record<ErrorKind, string>;

export type ErrorCode = (typeof ERROR_KIND_TO_CODE)[ErrorKind];
