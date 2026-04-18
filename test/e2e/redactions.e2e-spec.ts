import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { LIMITS } from '../../src/common/limits';

import { configureApp } from './configure-app';

const CANONICAL_TEXT = 'I love Cheese Pizza and beer at Boston Red Sox games';
const CANONICAL_PATTERNS =
  'Hello world "Boston Red Sox", \'Pepperoni Pizza\', \'Cheese Pizza\', beer';
const CANONICAL_REDACTED = 'I love XXXX and XXXX at XXXX games';

describe('Redactions (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /redactions — canonical happy path', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions')
      .send({ text: CANONICAL_TEXT, patterns: CANONICAL_PATTERNS })
      .expect(200);

    expect(res.body).toMatchObject({
      redactedText: CANONICAL_REDACTED,
      stats: {
        matchCount: 3,
        documentBytes: CANONICAL_TEXT.length,
      },
    });
    expect(typeof res.body.key).toBe('string');
    expect(res.body.key.length).toBeGreaterThan(0);
    expect(typeof res.body.stats.patternCount).toBe('number');
    expect(res.body.stats.patternCount).toBeGreaterThan(0);
    expect(typeof res.body.stats.latencyMs).toBe('number');
  });

  it('POST /redactions + POST /redactions/unredact — round-trip recovers the original', async () => {
    const redactRes = await request(app.getHttpServer())
      .post('/redactions')
      .send({ text: CANONICAL_TEXT, patterns: CANONICAL_PATTERNS })
      .expect(200);

    const unredactRes = await request(app.getHttpServer())
      .post('/redactions/unredact')
      .send({
        redactedText: redactRes.body.redactedText,
        key: redactRes.body.key,
      })
      .expect(200);

    expect(unredactRes.body).toEqual({
      text: CANONICAL_TEXT,
      stats: {
        restoredCount: 3,
        latencyMs: expect.any(Number),
      },
    });
  });

  it('POST /redactions — caseSensitive: true prevents matches of different case', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions')
      .send({
        text: 'hello ALICE and alice',
        patterns: 'Alice',
        options: { caseSensitive: true },
      })
      .expect(200);

    expect(res.body.redactedText).toBe('hello ALICE and alice');
    expect(res.body.stats.matchCount).toBe(0);
  });

  it('POST /redactions — PARSE_ERROR on unbalanced quote', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions')
      .send({ text: 'x', patterns: '"unbalanced' })
      .expect(400);

    expect(res.body).toMatchObject({
      error: {
        code: 'PARSE_ERROR',
        kind: 'PARSE_ERROR',
        details: { subKind: 'UNBALANCED_QUOTE' },
      },
      path: '/redactions',
    });
    expect(res.body.error.details.position).toEqual(expect.any(Number));
    expect(res.body.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it('POST /redactions — PAYLOAD_TOO_LARGE when text exceeds MAX_DOCUMENT_BYTES', async () => {
    const oversized = 'a'.repeat(LIMITS.MAX_DOCUMENT_BYTES + 1);
    const res = await request(app.getHttpServer())
      .post('/redactions')
      .send({ text: oversized, patterns: 'a' })
      .expect(413);

    expect(res.body).toMatchObject({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        kind: 'LIMIT_EXCEEDED',
        details: {
          limit: 'MAX_DOCUMENT_BYTES',
          max: LIMITS.MAX_DOCUMENT_BYTES,
        },
      },
    });
    expect(res.body.error.details.actual).toBeGreaterThan(
      LIMITS.MAX_DOCUMENT_BYTES,
    );
  }, 60_000);

  it('POST /redactions/unredact — INVALID_KEY on malformed base64', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions/unredact')
      .send({ redactedText: 'XXXX', key: '!!!not_base64!!!' })
      .expect(400);

    expect(res.body).toMatchObject({
      error: {
        code: 'INVALID_KEY',
        kind: 'INVALID_KEY',
      },
      path: '/redactions/unredact',
    });
    expect(['INVALID_BASE64', 'INVALID_GZIP', 'INVALID_JSON']).toContain(
      res.body.error.details.subKind,
    );
  });

  it('POST /redactions/unredact — KEY_INTEGRITY_FAILURE when redactedText is tampered', async () => {
    const redactRes = await request(app.getHttpServer())
      .post('/redactions')
      .send({ text: 'I love Alice', patterns: 'Alice' })
      .expect(200);

    const tampered = (redactRes.body.redactedText as string).replace(
      'XXXX',
      'ZZZZ',
    );
    const res = await request(app.getHttpServer())
      .post('/redactions/unredact')
      .send({ redactedText: tampered, key: redactRes.body.key })
      .expect(422);

    expect(res.body).toMatchObject({
      error: {
        code: 'KEY_INTEGRITY_FAILURE',
        kind: 'KEY_INTEGRITY_FAILURE',
        details: { subKind: 'TOKEN_MISMATCH' },
      },
    });
  });
});
