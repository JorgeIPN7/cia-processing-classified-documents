import { Injectable } from '@nestjs/common';
import { gunzipSync, gzipSync } from 'node:zlib';

import { LIMITS } from '../../common/limits';
import { err, ok, type Result } from '../../common/result';
import { limitExceeded, type LimitExceededError } from '../parsers/parse-error';

import {
  deserializeErr,
  type DeserializeError,
} from './deserialize-error';
import type { Mapping, RedactionKeyPayload } from './mapping.interface';
import { createRedactionKey, type RedactionKey } from './redaction-key';

const BASE64URL_REGEX = /^[A-Za-z0-9_-]*={0,2}$/;

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function validateMapping(
  raw: unknown,
  index: number,
): Result<Mapping, DeserializeError> {
  if (!isObject(raw)) {
    return err(
      deserializeErr.invalidShape(
        `$.m[${String(index)}]`,
        'must be a non-null object',
      ),
    );
  }
  const pos = raw['pos'];
  const len = raw['len'];
  const original = raw['original'];
  if (typeof pos !== 'number' || !Number.isInteger(pos) || pos < 0) {
    return err(
      deserializeErr.invalidShape(
        `$.m[${String(index)}].pos`,
        'must be a non-negative integer',
      ),
    );
  }
  if (typeof len !== 'number' || !Number.isInteger(len) || len < 0) {
    return err(
      deserializeErr.invalidShape(
        `$.m[${String(index)}].len`,
        'must be a non-negative integer',
      ),
    );
  }
  if (typeof original !== 'string') {
    return err(
      deserializeErr.invalidShape(
        `$.m[${String(index)}].original`,
        'must be a string',
      ),
    );
  }
  return ok({ pos, len, original });
}

/**
 * Serializes and deserializes self-contained redaction keys.
 *
 * Pipeline on serialize: `{ v: 1, m: mappings }` → JSON → gzip → base64url.
 * Pipeline on deserialize is the reverse, with strict shape validation.
 *
 * SECURITY NOTE: this is OBFUSCATION, not cryptography. Anyone with access
 * to the key string can reconstruct the original text. For production use
 * with classified data, see docs/PART3_DESIGN.md for KMS/Vault-sealed keys.
 */
@Injectable()
export class KeySerializerService {
  serialize(mappings: readonly Mapping[]): RedactionKey {
    const payload: RedactionKeyPayload = { v: 1, m: mappings };
    const json = JSON.stringify(payload);
    const gz = gzipSync(Buffer.from(json, 'utf8'));
    return createRedactionKey(gz.toString('base64url'));
  }

  deserialize(
    key: RedactionKey,
  ): Result<readonly Mapping[], DeserializeError | LimitExceededError> {
    const raw: string = key;

    if (raw.length > LIMITS.MAX_KEY_BYTES) {
      return err(
        limitExceeded('MAX_KEY_BYTES', raw.length, LIMITS.MAX_KEY_BYTES),
      );
    }

    if (!BASE64URL_REGEX.test(raw)) {
      return err(
        deserializeErr.invalidBase64(
          'contains characters outside the base64url alphabet',
        ),
      );
    }

    const gzipped = Buffer.from(raw, 'base64url');

    let jsonBuf: Buffer;
    try {
      jsonBuf = gunzipSync(gzipped);
    } catch (e) {
      return err(deserializeErr.invalidGzip(errorMessage(e)));
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonBuf.toString('utf8'));
    } catch (e) {
      return err(deserializeErr.invalidJson(errorMessage(e)));
    }

    if (!isObject(parsed)) {
      return err(
        deserializeErr.invalidShape('$', 'root must be a non-null object'),
      );
    }

    const version = parsed['v'];
    if (version !== 1) {
      return err(deserializeErr.unsupportedVersion(version));
    }

    const m = parsed['m'];
    if (!Array.isArray(m)) {
      return err(deserializeErr.invalidShape('$.m', 'must be an array'));
    }

    const items: readonly unknown[] = m;
    const out: Mapping[] = [];
    for (let i = 0; i < items.length; i++) {
      const r = validateMapping(items[i], i);
      if (!r.ok) return r;
      out.push(r.value);
    }
    return ok(out);
  }
}
