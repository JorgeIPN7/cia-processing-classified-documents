import { createHash } from 'node:crypto';

import {
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap, type Observable } from 'rxjs';

interface MaybeDocBody {
  readonly text?: unknown;
  readonly redactedText?: unknown;
}

function hashDoc(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as MaybeDocBody;
  const source =
    typeof b.text === 'string'
      ? b.text
      : typeof b.redactedText === 'string'
        ? b.redactedText
        : undefined;
  if (source === undefined) return undefined;
  return createHash('sha256').update(source).digest('hex').slice(0, 12);
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  public intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const start = Date.now();
    const method = req.method;
    const path = req.url;
    const docHash = hashDoc(req.body);

    return next.handle().pipe(
      tap({
        next: () => {
          const latencyMs = Date.now() - start;
          this.logger.log(
            this.format(method, path, res.statusCode, latencyMs, docHash),
          );
        },
        error: (errUnknown: unknown) => {
          const latencyMs = Date.now() - start;
          const status = res.statusCode >= 400 ? res.statusCode : 500;
          const errName =
            errUnknown instanceof Error ? errUnknown.name : 'Unknown';
          this.logger.warn(
            `${this.format(method, path, status, latencyMs, docHash)} error=${errName}`,
          );
        },
      }),
    );
  }

  private format(
    method: string,
    path: string,
    status: number,
    latencyMs: number,
    docHash: string | undefined,
  ): string {
    const base = `method=${method} path=${path} status=${String(status)} latencyMs=${String(latencyMs)}`;
    return docHash === undefined ? base : `${base} docHash=${docHash}`;
  }
}
