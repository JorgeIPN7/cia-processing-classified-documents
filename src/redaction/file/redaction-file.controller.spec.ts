import {
  BadRequestException,
  NotFoundException,
  StreamableFile,
} from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Request, Response } from 'express';

import { DomainHttpException } from '../../common/filters/domain-http.exception';

import { RedactionFileController } from './redaction-file.controller';
import { RedactionFileService } from './redaction-file.service';
import type { UploadedFileLike } from './multipart.config';

function makeFile(overrides: Partial<UploadedFileLike> = {}): UploadedFileLike {
  const buffer = Buffer.from('hello world');
  return {
    originalname: 'doc.txt',
    mimetype: 'text/plain',
    size: buffer.length,
    buffer,
    ...overrides,
  };
}

function makeRes(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader(name: string, value: string | number) {
      headers[name] = String(value);
    },
  } as unknown as Response;
  return { res, headers };
}

function makeReq(
  overrides: { protocol?: string; host?: string } = {},
): Request {
  const host = overrides.host ?? 'localhost:8888';
  const protocol = overrides.protocol ?? 'http';
  return {
    protocol,
    get(header: string): string | undefined {
      const h = header.toLowerCase();
      if (h === 'host') return host;
      return undefined;
    },
  } as unknown as Request;
}

describe('RedactionFileController', () => {
  let controller: RedactionFileController;
  let service: jest.Mocked<RedactionFileService>;

  beforeEach(async () => {
    const mock: jest.Mocked<RedactionFileService> = {
      redactFile: jest.fn(),
      consumeStored: jest.fn(),
      unredactFile: jest.fn(),
    } as unknown as jest.Mocked<RedactionFileService>;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedactionFileController],
      providers: [{ provide: RedactionFileService, useValue: mock }],
    }).compile();

    controller = module.get(RedactionFileController);
    service = module.get(RedactionFileService);
  });

  describe('POST /redactions/file', () => {
    it('returns id + absolute downloadUrl + key + stats on success', async () => {
      service.redactFile.mockResolvedValue({
        ok: true,
        value: {
          id: 'f'.repeat(64),
          filename: 'doc.redacted.txt',
          mime: 'text/plain',
          expiresInSeconds: 300,
          result: {
            redactedText: 'XXXX',
            key: 'opaque-key' as never,
            stats: {
              patternCount: 1,
              matchCount: 1,
              documentBytes: 11,
              latencyMs: 1,
            },
          },
        },
      });

      const dto = { patterns: 'hello' } as never;
      const resp = await controller.redactFile(makeFile(), dto, makeReq());

      expect(resp).toEqual({
        id: 'f'.repeat(64),
        downloadUrl: `http://localhost:8888/redactions/file/${'f'.repeat(64)}`,
        key: 'opaque-key',
        expiresInSeconds: 300,
        stats: {
          patternCount: 1,
          matchCount: 1,
          documentBytes: 11,
          latencyMs: 1,
        },
      });
    });

    it('throws BadRequest when no file is provided', async () => {
      const dto = { patterns: 'hello' } as never;
      await expect(
        controller.redactFile(undefined, dto, makeReq()),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequest when extension is unsupported', async () => {
      const file = makeFile({ originalname: 'evil.exe' });
      const dto = { patterns: 'hello' } as never;
      await expect(
        controller.redactFile(file, dto, makeReq()),
      ).rejects.toThrow(BadRequestException);
    });

    it('propagates domain errors as DomainHttpException', async () => {
      service.redactFile.mockResolvedValue({
        ok: false,
        error: {
          kind: 'PARSE_ERROR',
          message: 'boom',
          details: { subKind: 'UNBALANCED_QUOTE', position: 0 },
        } as never,
      });

      const dto = { patterns: '"bad' } as never;
      await expect(
        controller.redactFile(makeFile(), dto, makeReq()),
      ).rejects.toThrow(DomainHttpException);
    });
  });

  describe('GET /redactions/file/:id', () => {
    it('streams the stored file with proper headers', async () => {
      service.consumeStored.mockResolvedValue({
        buffer: Buffer.from('redacted text'),
        meta: { filename: 'doc.redacted.txt', mime: 'text/plain' },
      });
      const { res, headers } = makeRes();
      const out = await controller.downloadFile('a'.repeat(64), res);
      expect(out).toBeInstanceOf(StreamableFile);
      expect(headers['Content-Type']).toBe('text/plain');
      expect(headers['Content-Disposition']).toContain(
        'filename="doc.redacted.txt"',
      );
    });

    it('rejects malformed ids with 400', async () => {
      const { res } = makeRes();
      await expect(controller.downloadFile('nope', res)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('returns 404 when the id is unknown or expired', async () => {
      service.consumeStored.mockResolvedValue(null);
      const { res } = makeRes();
      await expect(
        controller.downloadFile('b'.repeat(64), res),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /redactions/unredact/file', () => {
    it('returns a StreamableFile with Content-Disposition headers', () => {
      service.unredactFile.mockReturnValue({
        ok: true,
        value: {
          buffer: Buffer.from('original'),
          filename: 'doc.txt',
          mime: 'text/plain',
          result: {
            text: 'original',
            stats: { restoredCount: 2, latencyMs: 1 },
          },
        },
      });
      const { res, headers } = makeRes();
      const out = controller.unredactFile(
        makeFile({ originalname: 'doc.redacted.txt' }),
        { key: 'opaque-key' } as never,
        res,
      );
      expect(out).toBeInstanceOf(StreamableFile);
      expect(headers['Content-Disposition']).toContain('filename="doc.txt"');
      expect(headers['X-Unredact-Restored-Count']).toBe('2');
    });

    it('propagates integrity failures as DomainHttpException', () => {
      service.unredactFile.mockReturnValue({
        ok: false,
        error: {
          kind: 'KEY_INTEGRITY_FAILURE',
          message: 'tampered',
          details: { subKind: 'TOKEN_MISMATCH', index: 0, pos: 0, expected: 'XXXX', actual: 'ZZZZ' },
        } as never,
      });
      const { res } = makeRes();
      expect(() =>
        controller.unredactFile(makeFile(), { key: 'k' } as never, res),
      ).toThrow(DomainHttpException);
    });

    it('throws BadRequest when file is missing', () => {
      const { res } = makeRes();
      expect(() =>
        controller.unredactFile(undefined, { key: 'k' } as never, res),
      ).toThrow(BadRequestException);
    });
  });
});
