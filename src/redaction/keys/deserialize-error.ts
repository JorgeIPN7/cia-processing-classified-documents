import type { DomainError } from '../../common/errors';

export type DeserializeErrorDetails =
  | { readonly subKind: 'INVALID_BASE64'; readonly reason: string }
  | { readonly subKind: 'INVALID_GZIP'; readonly reason: string }
  | { readonly subKind: 'INVALID_JSON'; readonly reason: string }
  | { readonly subKind: 'UNSUPPORTED_VERSION'; readonly received: unknown }
  | {
      readonly subKind: 'INVALID_SHAPE';
      readonly path: string;
      readonly reason: string;
    };

export type DeserializeError = DomainError<'INVALID_KEY', DeserializeErrorDetails>;

export const deserializeErr = {
  invalidBase64(reason: string): DeserializeError {
    return {
      kind: 'INVALID_KEY',
      message: `Invalid base64url encoding: ${reason}`,
      details: { subKind: 'INVALID_BASE64', reason },
    };
  },
  invalidGzip(reason: string): DeserializeError {
    return {
      kind: 'INVALID_KEY',
      message: `Invalid gzip payload: ${reason}`,
      details: { subKind: 'INVALID_GZIP', reason },
    };
  },
  invalidJson(reason: string): DeserializeError {
    return {
      kind: 'INVALID_KEY',
      message: `Invalid JSON payload: ${reason}`,
      details: { subKind: 'INVALID_JSON', reason },
    };
  },
  unsupportedVersion(received: unknown): DeserializeError {
    return {
      kind: 'INVALID_KEY',
      message: `Unsupported key version: ${JSON.stringify(received)}`,
      details: { subKind: 'UNSUPPORTED_VERSION', received },
    };
  },
  invalidShape(path: string, reason: string): DeserializeError {
    return {
      kind: 'INVALID_KEY',
      message: `Invalid payload shape at ${path}: ${reason}`,
      details: { subKind: 'INVALID_SHAPE', path, reason },
    };
  },
} as const;
