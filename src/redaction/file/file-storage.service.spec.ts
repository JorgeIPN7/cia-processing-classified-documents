import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileStorageService,
  isValidStorageId,
  STORAGE_CONSTANTS,
} from './file-storage.service';

async function createService(ttlSeconds: number): Promise<{
  svc: FileStorageService;
  dir: string;
}> {
  const dir = await mkdtemp(join(tmpdir(), 'fs-storage-'));
  process.env['REDACTION_FILE_STORAGE_DIR'] = dir;
  process.env['REDACTION_FILE_TTL_SECONDS'] = String(ttlSeconds);
  const svc = new FileStorageService();
  await svc.onModuleInit();
  return { svc, dir };
}

async function teardown(svc: FileStorageService, dir: string): Promise<void> {
  await svc.onModuleDestroy();
  delete process.env['REDACTION_FILE_STORAGE_DIR'];
  delete process.env['REDACTION_FILE_TTL_SECONDS'];
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
}

describe('FileStorageService', () => {
  let svc: FileStorageService;
  let dir: string;

  beforeEach(async () => {
    ({ svc, dir } = await createService(300));
  });

  afterEach(async () => {
    await teardown(svc, dir);
  });

  it('stores a buffer and returns a valid 64-char hex id', async () => {
    const id = await svc.store(Buffer.from('hello'), {
      filename: 'a.txt',
      mime: 'text/plain',
    });
    expect(id).toHaveLength(STORAGE_CONSTANTS.ID_HEX_LENGTH);
    expect(isValidStorageId(id)).toBe(true);
  });

  it('consume returns the stored buffer and meta, then deletes (single-use)', async () => {
    const id = await svc.store(Buffer.from('secret'), {
      filename: 'report.txt',
      mime: 'text/plain',
    });

    const first = await svc.consume(id);
    expect(first).not.toBeNull();
    expect(first?.buffer.toString('utf8')).toBe('secret');
    expect(first?.meta).toEqual({ filename: 'report.txt', mime: 'text/plain' });

    const second = await svc.consume(id);
    expect(second).toBeNull();

    const remaining = await readdir(dir);
    expect(remaining.filter((f) => f.endsWith('.bin'))).toHaveLength(0);
  });

  it('consume returns null for an unknown id', async () => {
    const bogus = 'a'.repeat(64);
    const r = await svc.consume(bogus);
    expect(r).toBeNull();
  });

  it('consume rejects non-hex ids without reading disk', async () => {
    const r = await svc.consume('not-a-valid-id');
    expect(r).toBeNull();
  });

  it('expired entries are treated as missing and their files removed', async () => {
    await teardown(svc, dir);
    ({ svc, dir } = await createService(1));

    const id = await svc.store(Buffer.from('expiring'), {
      filename: 'x.md',
      mime: 'text/markdown',
    });
    await new Promise((r) => setTimeout(r, 1100));

    const r = await svc.consume(id);
    expect(r).toBeNull();

    const remaining = await readdir(dir);
    expect(remaining.filter((f) => f.endsWith('.bin'))).toHaveLength(0);
  });

  it('onModuleInit wipes orphan .bin files from previous runs', async () => {
    await teardown(svc, dir);

    const orphanDir = await mkdtemp(join(tmpdir(), 'fs-storage-orphan-'));
    await writeFile(join(orphanDir, 'stale.bin'), 'stale');

    process.env['REDACTION_FILE_STORAGE_DIR'] = orphanDir;
    process.env['REDACTION_FILE_TTL_SECONDS'] = '300';
    const fresh = new FileStorageService();
    await fresh.onModuleInit();

    const remaining = await readdir(orphanDir);
    expect(remaining.filter((f) => f.endsWith('.bin'))).toHaveLength(0);

    svc = fresh;
    dir = orphanDir;
  });

  it('isValidStorageId accepts only 64 lowercase hex chars', () => {
    expect(isValidStorageId('a'.repeat(64))).toBe(true);
    expect(isValidStorageId('A'.repeat(64))).toBe(false);
    expect(isValidStorageId('a'.repeat(63))).toBe(false);
    expect(isValidStorageId('../etc/passwd')).toBe(false);
    expect(isValidStorageId('')).toBe(false);
  });

  it('size() reflects active entries', async () => {
    expect(svc.size()).toBe(0);
    await svc.store(Buffer.from('a'), { filename: 'a.txt', mime: 'text/plain' });
    await svc.store(Buffer.from('b'), { filename: 'b.txt', mime: 'text/plain' });
    expect(svc.size()).toBe(2);
  });
});
