import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';

import { configureApp } from './configure-app';

describe('Validation (e2e)', () => {
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

  it('POST /redactions — 400 VALIDATION_ERROR when `text` is missing', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions')
      .send({ patterns: 'x' })
      .expect(400);

    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      kind: 'VALIDATION_ERROR',
    });
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.stringContaining('text')]),
    );
  });

  it('POST /redactions — 400 VALIDATION_ERROR when unknown field is sent (forbidNonWhitelisted)', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions')
      .send({ text: 'x', patterns: 'y', evil: 'payload' })
      .expect(400);

    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      kind: 'VALIDATION_ERROR',
    });
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.stringContaining('evil')]),
    );
  });

  it('POST /redactions/unredact — 400 VALIDATION_ERROR when `key` is empty', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions/unredact')
      .send({ redactedText: 'XXXX', key: '' })
      .expect(400);

    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      kind: 'VALIDATION_ERROR',
    });
  });

  it('POST /redactions — rejects non-string `options.caseSensitive`', async () => {
    const res = await request(app.getHttpServer())
      .post('/redactions')
      .send({
        text: 'x',
        patterns: 'y',
        options: { caseSensitive: 'yes please' },
      })
      .expect(400);

    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
