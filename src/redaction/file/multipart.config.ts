import { extname } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { memoryStorage } from 'multer';

import { LIMITS } from '../../common/limits';

export const ALLOWED_EXTENSIONS = ['.txt', '.md'] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

export const ALLOWED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/octet-stream',
] as const;

export const MIME_BY_EXTENSION: Readonly<Record<AllowedExtension, string>> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
};

export interface UploadedFileLike {
  readonly originalname?: string;
  readonly mimetype?: string;
  readonly size?: number;
  readonly buffer?: Buffer;
}

export function buildMulterOptions(): MulterOptions {
  return {
    storage: memoryStorage(),
    limits: {
      fileSize: LIMITS.MAX_DOCUMENT_BYTES,
      fieldSize: LIMITS.MAX_KEY_BYTES,
      fields: 8,
      files: 1,
    },
  };
}

export function normalizedExtension(filename: string): string {
  return extname(filename).toLowerCase();
}

export function isAllowedExtension(ext: string): ext is AllowedExtension {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(ext);
}

export function resolveDownloadMime(filename: string): string {
  const ext = normalizedExtension(filename);
  if (isAllowedExtension(ext)) return MIME_BY_EXTENSION[ext];
  return 'text/plain';
}

// eslint-disable-next-line no-control-regex
const DISALLOWED_FILENAME_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;

export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? 'document';
  const cleaned = base.replace(DISALLOWED_FILENAME_CHARS, '_').trim();
  if (cleaned.length === 0) return 'document';
  return cleaned.slice(0, 255);
}

export function derivedRedactedFilename(original: string): string {
  const safe = sanitizeFilename(original);
  const ext = normalizedExtension(safe);
  if (ext.length === 0) return `${safe}.redacted.txt`;
  const stem = safe.slice(0, safe.length - ext.length);
  return `${stem}.redacted${ext}`;
}

export interface ValidatedUploadedFile {
  readonly originalname: string;
  readonly mimetype: string;
  readonly size: number;
  readonly buffer: Buffer;
}

export function validationErrorFor(
  file: UploadedFileLike | undefined,
): string | null {
  if (file === undefined) return 'File is required';
  if (file.buffer === undefined) return 'File buffer missing';
  if (file.size === undefined || file.size === 0) return 'File is empty';
  if (file.size > LIMITS.MAX_DOCUMENT_BYTES) {
    return `File exceeds max size ${String(LIMITS.MAX_DOCUMENT_BYTES)} bytes`;
  }
  const ext = normalizedExtension(file.originalname ?? '');
  if (!isAllowedExtension(ext)) {
    return `Unsupported file extension. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`;
  }
  const mime = (file.mimetype ?? '').toLowerCase();
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    return `Unsupported MIME type: ${file.mimetype ?? '<none>'}`;
  }
  return null;
}

export function assertValidUploadedFile(
  file: UploadedFileLike | undefined,
): asserts file is ValidatedUploadedFile {
  const reason = validationErrorFor(file);
  if (reason !== null) throw new BadRequestException(reason);
}
