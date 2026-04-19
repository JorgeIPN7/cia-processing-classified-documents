import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';

import { configureApp } from './configure-app';

const CANONICAL_TEXT = 'I love Cheese Pizza and beer at Boston Red Sox games';
const CANONICAL_PATTERNS =
  'Hello world "Boston Red Sox", \'Pepperoni Pizza\', \'Cheese Pizza\', beer';
const CANONICAL_REDACTED = 'I love XXXX and XXXX at XXXX games';

describe('Redactions file endpoints (e2e)', () => {
  let app: INestApplication;
  let storageDir: string;

  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'e2e-redact-file-'));
    process.env['REDACTION_FILE_STORAGE_DIR'] = storageDir;
    process.env['REDACTION_FILE_TTL_SECONDS'] = '300';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env['REDACTION_FILE_STORAGE_DIR'];
    delete process.env['REDACTION_FILE_TTL_SECONDS'];
    if (existsSync(storageDir)) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  it('POST /redactions/file — happy path returns id + downloadUrl + key', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions/file')
      .field('patterns', CANONICAL_PATTERNS)
      .attach('file', Buffer.from(CANONICAL_TEXT, 'utf8'), {
        filename: 'doc.txt',
        contentType: 'text/plain',
      })
      .expect(200);

    expect(res.body).toMatchObject({
      downloadUrl: expect.stringMatching(
        /^https?:\/\/[^/]+\/redactions\/file\/[a-f0-9]{64}$/,
      ),
      expiresInSeconds: 300,
      stats: {
        matchCount: 3,
        documentBytes: CANONICAL_TEXT.length,
      },
    });
    expect(res.body.id).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof res.body.key).toBe('string');
    expect(res.body.key.length).toBeGreaterThan(0);
  });

  it('POST /redactions/file + GET /redactions/file/:id — round-trip and single-use', async () => {
    const redactRes = await request(app.getHttpServer())
      .post('/redactions/file')
      .field('patterns', CANONICAL_PATTERNS)
      .attach('file', Buffer.from(CANONICAL_TEXT, 'utf8'), {
        filename: 'report.txt',
        contentType: 'text/plain',
      })
      .expect(200);

    const id = redactRes.body.id as string;

    const downloadRes = await request(app.getHttpServer())
      .get(`/redactions/file/${id}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          chunks.push(c);
        });
        res.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      })
      .expect(200);

    expect((downloadRes.body as Buffer).toString('utf8')).toBe(
      CANONICAL_REDACTED,
    );
    expect(downloadRes.headers['content-disposition']).toContain(
      'report.redacted.txt',
    );
    expect(downloadRes.headers['x-content-type-options']).toBe('nosniff');

    await request(app.getHttpServer())
      .get(`/redactions/file/${id}`)
      .expect(404);
  });

  it('GET /redactions/file/:id — 400 on malformed id', async () => {
    await request(app.getHttpServer())
      .get('/redactions/file/not-hex-id')
      .expect(400);
  });

  it('POST /redactions/file — 400 on unsupported extension', async () => {
    await request(app.getHttpServer())
      .post('/redactions/file')
      .field('patterns', 'foo')
      .attach('file', Buffer.from('hello', 'utf8'), {
        filename: 'doc.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
  });

  it('POST /redactions/file — 400 when file is missing', async () => {
    await request(app.getHttpServer())
      .post('/redactions/file')
      .field('patterns', 'foo')
      .expect(400);
  });

  it('POST /redactions/file — options JSON is applied (caseSensitive)', async () => {
    const redact = await request(app.getHttpServer())
      .post('/redactions/file')
      .field('patterns', 'Alice')
      .field('options', JSON.stringify({ caseSensitive: true }))
      .attach('file', Buffer.from('hello ALICE and alice', 'utf8'), {
        filename: 'case.md',
        contentType: 'text/markdown',
      })
      .expect(200);

    expect(redact.body.stats.matchCount).toBe(0);

    const download = await request(app.getHttpServer())
      .get(`/redactions/file/${redact.body.id as string}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          chunks.push(c);
        });
        res.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      })
      .expect(200);
    expect((download.body as Buffer).toString('utf8')).toBe(
      'hello ALICE and alice',
    );
  });

  it('POST /redactions/file — 400 on invalid options JSON', async () => {
    await request(app.getHttpServer())
      .post('/redactions/file')
      .field('patterns', 'Alice')
      .field('options', '{not json')
      .attach('file', Buffer.from('hello', 'utf8'), {
        filename: 'x.txt',
        contentType: 'text/plain',
      })
      .expect(400);
  });

  it('POST /redactions/unredact/file — returns restored file inline (sync)', async () => {
    const redact = await request(app.getHttpServer())
      .post('/redactions/file')
      .field('patterns', CANONICAL_PATTERNS)
      .attach('file', Buffer.from(CANONICAL_TEXT, 'utf8'), {
        filename: 'doc.txt',
        contentType: 'text/plain',
      })
      .expect(200);

    const unredact = await request(app.getHttpServer())
      .post('/redactions/unredact/file')
      .field('key', redact.body.key as string)
      .attach(
        'file',
        Buffer.from(CANONICAL_REDACTED, 'utf8'),
        { filename: 'doc.redacted.txt', contentType: 'text/plain' },
      )
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          chunks.push(c);
        });
        res.on('end', () => {
          cb(null, Buffer.concat(chunks));
        });
      })
      .expect(200);

    expect((unredact.body as Buffer).toString('utf8')).toBe(CANONICAL_TEXT);
    expect(unredact.headers['content-disposition']).toContain('doc.txt');
    expect(unredact.headers['x-unredact-restored-count']).toBe('3');
  });

  it('POST /redactions/unredact/file — 422 on tampered redacted text', async () => {
    const redact = await request(app.getHttpServer())
      .post('/redactions/file')
      .field('patterns', 'Alice')
      .attach('file', Buffer.from('I love Alice', 'utf8'), {
        filename: 'x.txt',
        contentType: 'text/plain',
      })
      .expect(200);

    const tampered = 'I love ZZZZ';
    const res = await request(app.getHttpServer())
      .post('/redactions/unredact/file')
      .field('key', redact.body.key as string)
      .attach('file', Buffer.from(tampered, 'utf8'), {
        filename: 'x.redacted.txt',
        contentType: 'text/plain',
      })
      .expect(422);

    expect(res.body).toMatchObject({
      error: {
        code: 'KEY_INTEGRITY_FAILURE',
        kind: 'KEY_INTEGRITY_FAILURE',
      },
    });
  });

  it('POST /redactions/unredact/file — 400 on invalid base64 key', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions/unredact/file')
      .field('key', '!!!not_base64!!!')
      .attach('file', Buffer.from('XXXX', 'utf8'), {
        filename: 'x.redacted.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    expect(res.body.error.kind).toBe('INVALID_KEY');
  });
});
