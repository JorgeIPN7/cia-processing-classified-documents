import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import {
  ERROR_KIND_TO_CODE,
  ERROR_KIND_TO_HTTP,
  type ErrorKind,
} from '../errors';

import { DomainHttpException } from './domain-http.exception';

export type EnvelopeKind = ErrorKind | 'VALIDATION_ERROR';

export interface ErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly kind: EnvelopeKind;
    readonly message: string;
    readonly details?: Readonly<Record<string, unknown>> | readonly string[];
  };
  readonly timestamp: string;
  readonly path: string;
}

const HTTP_BAD_REQUEST = 400;

interface ValidationBody {
  readonly message: readonly string[];
}

function isValidationBody(value: unknown): value is ValidationBody {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as { message?: unknown };
  if (!Array.isArray(obj.message)) return false;
  return obj.message.every((m) => typeof m === 'string');
}

function extractHttpMessage(body: unknown, fallback: string): string {
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body !== null) {
    const obj = body as { message?: unknown };
    if (typeof obj.message === 'string') return obj.message;
  }
  return fallback;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const timestamp = new Date().toISOString();
    const path = request.url;

    if (exception instanceof DomainHttpException) {
      const { kind, message, details } = exception.domainError;
      const status = ERROR_KIND_TO_HTTP[kind];
      const envelope: ErrorEnvelope = {
        error: {
          code: ERROR_KIND_TO_CODE[kind],
          kind,
          message,
          details,
        },
        timestamp,
        path,
      };
      response.status(status).json(envelope);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();

      if (status === HTTP_BAD_REQUEST && isValidationBody(body)) {
        const envelope: ErrorEnvelope = {
          error: {
            code: 'VALIDATION_ERROR',
            kind: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: body.message,
          },
          timestamp,
          path,
        };
        response.status(status).json(envelope);
        return;
      }

      const envelope: ErrorEnvelope = {
        error: {
          code: 'HTTP_ERROR',
          kind: 'INTERNAL_ERROR',
          message: extractHttpMessage(body, exception.message),
        },
        timestamp,
        path,
      };
      response.status(status).json(envelope);
      return;
    }

    const message =
      exception instanceof Error ? exception.message : 'Unknown internal error';
    this.logger.error(
      `Unhandled exception on ${request.method} ${path}: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );
    const envelope: ErrorEnvelope = {
      error: {
        code: ERROR_KIND_TO_CODE.INTERNAL_ERROR,
        kind: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
      timestamp,
      path,
    };
    response.status(ERROR_KIND_TO_HTTP.INTERNAL_ERROR).json(envelope);
  }
}
