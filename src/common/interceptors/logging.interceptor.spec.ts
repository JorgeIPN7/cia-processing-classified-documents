import {
  Logger,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';

import { LoggingInterceptor } from './logging.interceptor';

interface MockRequest {
  method: string;
  url: string;
  body: unknown;
}

interface MockResponse {
  statusCode: number;
}

function makeContext(body: unknown, statusCode = 200): ExecutionContext {
  const req: MockRequest = { method: 'POST', url: '/redactions', body };
  const res: MockResponse = { statusCode };
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

describe('LoggingInterceptor', () => {
  let interceptor: LoggingInterceptor;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    interceptor = new LoggingInterceptor();
    logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('logs a docHash when the body has `text` and never logs raw values', (done) => {
    const ctx = makeContext({ text: 'classified content', patterns: 'secret' });
    const handler: CallHandler = { handle: () => of({}) };

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        expect(logSpy).toHaveBeenCalledTimes(1);
        const [msg] = logSpy.mock.calls[0] as [string];
        expect(msg).toMatch(/method=POST/);
        expect(msg).toMatch(/path=\/redactions/);
        expect(msg).toMatch(/status=200/);
        expect(msg).toMatch(/latencyMs=\d+/);
        expect(msg).toMatch(/docHash=[0-9a-f]{12}/);
        expect(msg).not.toContain('classified content');
        expect(msg).not.toContain('secret');
        done();
      },
    });
  });

  it('uses `redactedText` for the hash when there is no `text`', (done) => {
    const ctx = makeContext({ redactedText: 'XXXX', key: 'abcd' });
    const handler: CallHandler = { handle: () => of({}) };

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        const [msg] = logSpy.mock.calls[0] as [string];
        expect(msg).toMatch(/docHash=[0-9a-f]{12}/);
        expect(msg).not.toContain('abcd');
        done();
      },
    });
  });

  it('omits docHash when neither `text` nor `redactedText` is present', (done) => {
    const ctx = makeContext({ foo: 'bar' });
    const handler: CallHandler = { handle: () => of({}) };

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        const [msg] = logSpy.mock.calls[0] as [string];
        expect(msg).not.toContain('docHash=');
        done();
      },
    });
  });

  it('handles null body without error', (done) => {
    const ctx = makeContext(null);
    const handler: CallHandler = { handle: () => of({}) };

    interceptor.intercept(ctx, handler).subscribe({
      complete: () => {
        const [msg] = logSpy.mock.calls[0] as [string];
        expect(msg).not.toContain('docHash=');
        done();
      },
    });
  });

  it('logs a warning on error without consuming it', (done) => {
    const ctx = makeContext({ text: 'hi' });
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('fail')),
    };

    interceptor.intercept(ctx, handler).subscribe({
      error: (e: unknown) => {
        expect(e).toBeInstanceOf(Error);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [msg] = warnSpy.mock.calls[0] as [string];
        expect(msg).toMatch(/error=Error/);
        expect(msg).toMatch(/docHash=[0-9a-f]{12}/);
        done();
      },
    });
  });

  it('falls back to status 500 when res.statusCode is not an error code on error', (done) => {
    const ctx = makeContext({ text: 'x' }, 200);
    const handler: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        const [msg] = warnSpy.mock.calls[0] as [string];
        expect(msg).toMatch(/status=500/);
        done();
      },
    });
  });

  it('preserves res.statusCode when already an error code', (done) => {
    const ctx = makeContext({ text: 'x' }, 422);
    const handler: CallHandler = {
      handle: () => throwError(() => ({ notAnError: true })),
    };

    interceptor.intercept(ctx, handler).subscribe({
      error: () => {
        const [msg] = warnSpy.mock.calls[0] as [string];
        expect(msg).toMatch(/status=422/);
        expect(msg).toMatch(/error=Unknown/);
        done();
      },
    });
  });
});
