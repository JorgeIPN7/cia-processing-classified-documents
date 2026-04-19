import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';

const DEFAULT_TTL_SECONDS = 300;
const DEFAULT_STORAGE_DIR = './tmp/redactions';
const CLEANUP_INTERVAL_MS = 60_000;
const ID_BYTES = 32;
const ID_HEX_LENGTH = ID_BYTES * 2;
const STORAGE_DIR_MODE = 0o700;

const ID_PATTERN = /^[a-f0-9]{64}$/;

export interface StoredMeta {
  readonly filename: string;
  readonly mime: string;
}

interface Entry {
  readonly path: string;
  readonly meta: StoredMeta;
  readonly expiresAt: number;
}

export interface StoredRecord {
  readonly buffer: Buffer;
  readonly meta: StoredMeta;
}

export function isValidStorageId(id: string): boolean {
  return ID_PATTERN.test(id);
}

@Injectable()
export class FileStorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileStorageService.name);
  private readonly entries = new Map<string, Entry>();
  private readonly dir: string;
  private readonly ttlMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  public constructor() {
    const envDir = process.env['REDACTION_FILE_STORAGE_DIR'];
    this.dir = resolve(
      envDir !== undefined && envDir.length > 0 ? envDir : DEFAULT_STORAGE_DIR,
    );
    const envTtl = Number(process.env['REDACTION_FILE_TTL_SECONDS']);
    const ttlSeconds =
      Number.isFinite(envTtl) && envTtl > 0 ? envTtl : DEFAULT_TTL_SECONDS;
    this.ttlMs = ttlSeconds * 1000;
  }

  public async onModuleInit(): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: STORAGE_DIR_MODE });
    await this.wipeDirectory();
    this.cleanupTimer = setInterval(
      () => void this.sweepExpired(),
      CLEANUP_INTERVAL_MS,
    );
    this.cleanupTimer.unref();
  }

  public async onModuleDestroy(): Promise<void> {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.wipeDirectory();
    this.entries.clear();
  }

  public get ttlSeconds(): number {
    return Math.floor(this.ttlMs / 1000);
  }

  public async store(buffer: Buffer, meta: StoredMeta): Promise<string> {
    const id = randomBytes(ID_BYTES).toString('hex');
    const path = this.pathFor(id);
    await writeFile(path, buffer, { mode: 0o600 });
    this.entries.set(id, {
      path,
      meta,
      expiresAt: Date.now() + this.ttlMs,
    });
    return id;
  }

  public async consume(id: string): Promise<StoredRecord | null> {
    if (!isValidStorageId(id)) return null;
    const entry = this.entries.get(id);
    if (entry === undefined) return null;

    if (Date.now() > entry.expiresAt) {
      this.entries.delete(id);
      await this.safeUnlink(entry.path);
      return null;
    }

    if (!this.entries.delete(id)) return null;

    try {
      const buffer = await readFile(entry.path);
      return { buffer, meta: entry.meta };
    } finally {
      await this.safeUnlink(entry.path);
    }
  }

  public size(): number {
    return this.entries.size;
  }

  private pathFor(id: string): string {
    return join(this.dir, `${id}.bin`);
  }

  private async sweepExpired(): Promise<void> {
    const now = Date.now();
    const expired: { id: string; path: string }[] = [];
    for (const [id, entry] of this.entries.entries()) {
      if (now > entry.expiresAt) expired.push({ id, path: entry.path });
    }
    for (const { id, path } of expired) {
      this.entries.delete(id);
      await this.safeUnlink(path);
    }
  }

  private async wipeDirectory(): Promise<void> {
    if (!existsSync(this.dir)) return;
    try {
      const names = await readdir(this.dir);
      await Promise.all(
        names
          .filter((n) => n.endsWith('.bin'))
          .map((n) => this.safeUnlink(join(this.dir, n))),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to wipe storage dir ${this.dir}: ${this.describeError(err)}`,
      );
    }
  }

  private async safeUnlink(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (err) {
      if (this.isEnoent(err)) return;
      this.logger.warn(
        `Failed to unlink ${path}: ${this.describeError(err)}`,
      );
    }
  }

  private isEnoent(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'ENOENT'
    );
  }

  private describeError(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}

export const STORAGE_CONSTANTS = {
  ID_HEX_LENGTH,
  DEFAULT_TTL_SECONDS,
} as const;
