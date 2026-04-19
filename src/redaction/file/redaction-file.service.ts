import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { ok, type Result } from '../../common/result';
import {
  MatcherOptionsDto,
  toMatcherOptions,
} from '../dto/matcher-options.dto';
import type { MatcherOptions } from '../interfaces/matcher-options.interface';
import { createRedactionKey } from '../keys/redaction-key';
import {
  RedactionService,
  type RedactError,
  type RedactResult,
  type UnredactError,
  type UnredactResult,
} from '../redaction.service';

import {
  derivedRedactedFilename,
  resolveDownloadMime,
  sanitizeFilename,
} from './multipart.config';
import { FileStorageService, type StoredRecord } from './file-storage.service';

export interface RedactFileInput {
  readonly buffer: Buffer;
  readonly originalFilename: string;
  readonly patterns: string;
  readonly optionsJson?: string;
}

export interface RedactFileOk {
  readonly id: string;
  readonly filename: string;
  readonly mime: string;
  readonly expiresInSeconds: number;
  readonly result: RedactResult;
}

export interface UnredactFileInput {
  readonly buffer: Buffer;
  readonly originalFilename: string;
  readonly key: string;
}

export interface UnredactFileOk {
  readonly buffer: Buffer;
  readonly filename: string;
  readonly mime: string;
  readonly result: UnredactResult;
}

@Injectable()
export class RedactionFileService {
  public constructor(
    private readonly svc: RedactionService,
    private readonly storage: FileStorageService,
  ) {}

  public async redactFile(
    input: RedactFileInput,
  ): Promise<Result<RedactFileOk, RedactError>> {
    const text = decodeUtf8(input.buffer);
    const options = parseOptions(input.optionsJson);

    const result = this.svc.redact(text, input.patterns, options);
    if (!result.ok) return result;

    const filename = derivedRedactedFilename(input.originalFilename);
    const mime = resolveDownloadMime(filename);
    const payload = Buffer.from(result.value.redactedText, 'utf8');

    const id = await this.storage.store(payload, { filename, mime });
    return ok({
      id,
      filename,
      mime,
      expiresInSeconds: this.storage.ttlSeconds,
      result: result.value,
    });
  }

  public async consumeStored(id: string): Promise<StoredRecord | null> {
    return this.storage.consume(id);
  }

  public unredactFile(
    input: UnredactFileInput,
  ): Result<UnredactFileOk, UnredactError> {
    const text = decodeUtf8(input.buffer);
    const result = this.svc.unredact(text, createRedactionKey(input.key));
    if (!result.ok) return result;

    const filename = restoredFilename(input.originalFilename);
    const mime = resolveDownloadMime(filename);
    const buffer = Buffer.from(result.value.text, 'utf8');

    return ok({ buffer, filename, mime, result: result.value });
  }
}

function decodeUtf8(buffer: Buffer): string {
  return buffer.toString('utf8');
}

function parseOptions(raw: string | undefined): MatcherOptions | undefined {
  if (raw === undefined || raw.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('options must be a valid JSON object');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new BadRequestException('options must be a JSON object');
  }
  const dto = plainToInstance(MatcherOptionsDto, parsed, {
    enableImplicitConversion: false,
  });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    const messages = errors.flatMap((e) =>
      Object.values(e.constraints ?? {}),
    );
    throw new BadRequestException(
      messages.length > 0 ? messages : 'invalid options',
    );
  }
  return toMatcherOptions(dto);
}

function restoredFilename(original: string): string {
  const safe = sanitizeFilename(original);
  return safe.replace(/\.redacted(?=\.[^.]+$|$)/i, '') || safe;
}
