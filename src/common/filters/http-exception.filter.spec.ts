import {
  BadRequestException,
  HttpException,
  Logger,
  NotFoundException,
  type ArgumentsHost,
} from '@nestjs/common';

import { deserializeErr } from '../../redaction/keys/deserialize-error';
import { limitExceeded, parseErr } from '../../redaction/parsers/parse-error';
import { integrityErr } from '../../redaction/redaction-error';

import { DomainHttpException } from './domain-http.exception';
import { HttpExceptionFilter } from './http-exception.filter';

interface MockResponse {
  status: jest.Mock;
  json: jest.Mock;
}

function makeHost(path = '/redactions'): {
  host: ArgumentsHost;
  response: MockResponse;
} {
  const response: MockResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const request = { url: path, method: 'POST' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

function capturedBody(response: MockResponse): unknown {
  const call = response.json.mock.calls[0];
  return call?.[0];
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  describe('DomainHttpException', () => {
    it('maps ParseError to 400 PARSE_ERROR', () => {
      const { host, response } = makeHost();
      filter.catch(
        new DomainHttpException(parseErr.unbalancedQuote(3)),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(400);
      expect(capturedBody(response)).toMatchObject({
        error: {
          code: 'PARSE_ERROR',
          kind: 'PARSE_ERROR',
          details: { subKind: 'UNBALANCED_QUOTE', position: 3 },
        },
        path: '/redactions',
      });
      const body = capturedBody(response) as { timestamp: string };
      expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('maps LimitExceededError to 413 PAYLOAD_TOO_LARGE', () => {
      const { host, response } = makeHost();
      filter.catch(
        new DomainHttpException(
          limitExceeded('MAX_DOCUMENT_BYTES', 11_000_000, 10_485_760),
        ),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(413);
      expect(capturedBody(response)).toMatchObject({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          kind: 'LIMIT_EXCEEDED',
        },
      });
    });

    it('maps DeserializeError to 400 INVALID_KEY', () => {
      const { host, response } = makeHost('/redactions/unredact');
      filter.catch(
        new DomainHttpException(deserializeErr.invalidBase64('bad')),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(400);
      expect(capturedBody(response)).toMatchObject({
        error: {
          code: 'INVALID_KEY',
          kind: 'INVALID_KEY',
          details: { subKind: 'INVALID_BASE64', reason: 'bad' },
        },
        path: '/redactions/unredact',
      });
    });

    it('maps IntegrityError to 422 KEY_INTEGRITY_FAILURE', () => {
      const { host, response } = makeHost('/redactions/unredact');
      filter.catch(
        new DomainHttpException(integrityErr.tokenMismatch(0, 0, 'ZZZZ')),
        host,
      );
      expect(response.status).toHaveBeenCalledWith(422);
      expect(capturedBody(response)).toMatchObject({
        error: {
          code: 'KEY_INTEGRITY_FAILURE',
          kind: 'KEY_INTEGRITY_FAILURE',
          details: { subKind: 'TOKEN_MISMATCH' },
        },
      });
    });
  });

  describe('HttpException', () => {
    it('maps ValidationPipe BadRequestException to 400 VALIDATION_ERROR', () => {
      const { host, response } = makeHost();
      const validation = new BadRequestException({
        message: ['text must be a string', 'patterns should not be empty'],
        error: 'Bad Request',
        statusCode: 400,
      });
      filter.catch(validation, host);
      expect(response.status).toHaveBeenCalledWith(400);
      expect(capturedBody(response)).toMatchObject({
        error: {
          code: 'VALIDATION_ERROR',
          kind: 'VALIDATION_ERROR',
          details: [
            'text must be a string',
            'patterns should not be empty',
          ],
        },
      });
    });

    it('maps non-validation HttpException preserving status', () => {
      const { host, response } = makeHost();
      filter.catch(new NotFoundException('nope'), host);
      expect(response.status).toHaveBeenCalledWith(404);
      expect(capturedBody(response)).toMatchObject({
        error: {
          code: 'HTTP_ERROR',
          kind: 'INTERNAL_ERROR',
          message: 'nope',
        },
      });
    });

    it('extracts message from HttpException with string body', () => {
      const { host, response } = makeHost();
      filter.catch(new HttpException('plain string body', 418), host);
      expect(response.status).toHaveBeenCalledWith(418);
      expect(capturedBody(response)).toMatchObject({
        error: {
          code: 'HTTP_ERROR',
          message: 'plain string body',
        },
      });
    });
  });

  describe('unknown / non-HttpException', () => {
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
      errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    it('maps native Error to 500 INTERNAL_ERROR and logs stack', () => {
      const { host, response } = makeHost();
      filter.catch(new Error('boom'), host);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(capturedBody(response)).toMatchObject({
        error: {
          code: 'INTERNAL_ERROR',
          kind: 'INTERNAL_ERROR',
          message: 'Internal server error',
        },
      });
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('maps non-Error exception to 500 with generic message', () => {
      const { host, response } = makeHost();
      filter.catch('some string', host);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(capturedBody(response)).toMatchObject({
        error: { code: 'INTERNAL_ERROR' },
      });
    });
  });
});
