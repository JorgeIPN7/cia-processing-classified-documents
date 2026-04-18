import { Test, type TestingModule } from '@nestjs/testing';

import { DomainHttpException } from '../common/filters/domain-http.exception';
import { err, ok } from '../common/result';

import type { MatcherOptionsDto } from './dto/matcher-options.dto';
import type { RedactRequestDto } from './dto/redact-request.dto';
import type { UnredactRequestDto } from './dto/unredact-request.dto';
import { deserializeErr } from './keys/deserialize-error';
import { createRedactionKey, type RedactionKey } from './keys/redaction-key';
import { limitExceeded, parseErr } from './parsers/parse-error';
import { RedactionController } from './redaction.controller';
import { integrityErr } from './redaction-error';
import {
  RedactionService,
  type RedactResult,
  type UnredactResult,
} from './redaction.service';

describe('RedactionController', () => {
  let controller: RedactionController;
  let serviceMock: { redact: jest.Mock; unredact: jest.Mock };

  beforeEach(async () => {
    serviceMock = { redact: jest.fn(), unredact: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RedactionController],
      providers: [{ provide: RedactionService, useValue: serviceMock }],
    }).compile();
    controller = module.get(RedactionController);
  });

  describe('redact', () => {
    const redactResult: RedactResult = {
      redactedText: 'I love XXXX',
      key: createRedactionKey('abc'),
      stats: {
        patternCount: 1,
        matchCount: 1,
        documentBytes: 11,
        latencyMs: 2,
      },
    };

    it('returns a RedactResponseDto and passes options through toMatcherOptions', () => {
      serviceMock.redact.mockReturnValue(ok(redactResult));
      const options: MatcherOptionsDto = {
        caseSensitive: true,
        wordBoundaries: false,
      };
      const dto: RedactRequestDto = {
        text: 'I love beer',
        patterns: 'beer',
        options,
      };

      const response = controller.redact(dto);

      expect(serviceMock.redact).toHaveBeenCalledTimes(1);
      expect(serviceMock.redact).toHaveBeenCalledWith('I love beer', 'beer', {
        caseSensitive: true,
        wordBoundaries: false,
      });
      expect(response).toEqual({
        redactedText: 'I love XXXX',
        key: 'abc',
        stats: {
          patternCount: 1,
          matchCount: 1,
          documentBytes: 11,
          latencyMs: 2,
        },
      });
    });

    it('passes undefined options when the DTO omits them', () => {
      serviceMock.redact.mockReturnValue(ok(redactResult));
      const dto: RedactRequestDto = { text: 'I love beer', patterns: 'beer' };

      controller.redact(dto);

      expect(serviceMock.redact).toHaveBeenCalledWith(
        'I love beer',
        'beer',
        undefined,
      );
    });

    it('throws DomainHttpException on ParseError', () => {
      serviceMock.redact.mockReturnValue(err(parseErr.unbalancedQuote(5)));
      const dto: RedactRequestDto = { text: 'x', patterns: '"bad' };

      expect.assertions(3);
      try {
        controller.redact(dto);
      } catch (e) {
        expect(e).toBeInstanceOf(DomainHttpException);
        const ex = e as DomainHttpException;
        expect(ex.domainError.kind).toBe('PARSE_ERROR');
        expect(ex.domainError.details).toEqual({
          subKind: 'UNBALANCED_QUOTE',
          position: 5,
        });
      }
    });

    it('throws DomainHttpException on LimitExceededError', () => {
      serviceMock.redact.mockReturnValue(
        err(limitExceeded('MAX_DOCUMENT_BYTES', 11_000_000, 10_485_760)),
      );
      const dto: RedactRequestDto = { text: 'a', patterns: 'b' };

      expect.assertions(3);
      try {
        controller.redact(dto);
      } catch (e) {
        expect(e).toBeInstanceOf(DomainHttpException);
        const ex = e as DomainHttpException;
        expect(ex.domainError.kind).toBe('LIMIT_EXCEEDED');
        expect(ex.domainError.details).toMatchObject({
          limit: 'MAX_DOCUMENT_BYTES',
          actual: 11_000_000,
          max: 10_485_760,
        });
      }
    });
  });

  describe('unredact', () => {
    const unredactResult: UnredactResult = {
      text: 'I love beer',
      stats: { restoredCount: 1, latencyMs: 1 },
    };

    it('returns an UnredactResponseDto and brands the key before calling service', () => {
      serviceMock.unredact.mockReturnValue(ok(unredactResult));
      const dto: UnredactRequestDto = {
        redactedText: 'I love XXXX',
        key: 'abc',
      };

      const response = controller.unredact(dto);

      expect(serviceMock.unredact).toHaveBeenCalledTimes(1);
      const [redactedText, passedKey] = serviceMock.unredact.mock.calls[0] as [
        string,
        RedactionKey,
      ];
      expect(redactedText).toBe('I love XXXX');
      expect(passedKey).toBe(createRedactionKey('abc'));
      expect(response).toEqual({
        text: 'I love beer',
        stats: { restoredCount: 1, latencyMs: 1 },
      });
    });

    it('throws DomainHttpException on DeserializeError (invalid key)', () => {
      serviceMock.unredact.mockReturnValue(
        err(deserializeErr.invalidBase64('bad')),
      );
      const dto: UnredactRequestDto = {
        redactedText: 'XXXX',
        key: '!!!',
      };

      expect.assertions(3);
      try {
        controller.unredact(dto);
      } catch (e) {
        expect(e).toBeInstanceOf(DomainHttpException);
        const ex = e as DomainHttpException;
        expect(ex.domainError.kind).toBe('INVALID_KEY');
        expect(ex.domainError.details).toMatchObject({
          subKind: 'INVALID_BASE64',
        });
      }
    });

    it('throws DomainHttpException on IntegrityError (token mismatch)', () => {
      serviceMock.unredact.mockReturnValue(
        err(integrityErr.tokenMismatch(0, 0, 'ZZZZ')),
      );
      const dto: UnredactRequestDto = {
        redactedText: 'ZZZZ',
        key: 'abc',
      };

      expect.assertions(3);
      try {
        controller.unredact(dto);
      } catch (e) {
        expect(e).toBeInstanceOf(DomainHttpException);
        const ex = e as DomainHttpException;
        expect(ex.domainError.kind).toBe('KEY_INTEGRITY_FAILURE');
        expect(ex.domainError.details).toMatchObject({
          subKind: 'TOKEN_MISMATCH',
        });
      }
    });

    it('throws DomainHttpException on LimitExceededError for redactedText too large', () => {
      serviceMock.unredact.mockReturnValue(
        err(limitExceeded('MAX_DOCUMENT_BYTES', 11_000_000, 10_485_760)),
      );
      const dto: UnredactRequestDto = { redactedText: 'x', key: 'abc' };

      expect.assertions(2);
      try {
        controller.unredact(dto);
      } catch (e) {
        expect(e).toBeInstanceOf(DomainHttpException);
        expect((e as DomainHttpException).domainError.kind).toBe(
          'LIMIT_EXCEEDED',
        );
      }
    });
  });
});
