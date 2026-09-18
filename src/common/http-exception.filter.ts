import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Logger } from 'nestjs-pino';

export interface ErrorBody {
  code: string;
  message: string;
  [extra: string]: unknown;
}

/**
 * Every error leaves as `{ code, message, … }`. Domain errors already carry a code; Nest's own
 * exceptions get one derived from their status; anything else is logged and becomes a 500 without
 * leaking its message.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const { status, body } = toErrorResponse(exception);
    if (status >= 500) {
      this.logger.error(
        { err: exception, method: request.method, url: request.url },
        'unhandled error',
      );
    }
    reply.status(status).send(body);
  }
}

export function toErrorResponse(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const response = exception.getResponse();
    if (typeof response === 'object' && response !== null && 'code' in response) {
      return { status, body: response as ErrorBody };
    }
    const message =
      typeof response === 'string'
        ? response
        : ((response as { message?: string | string[] }).message ?? exception.message);
    return {
      status,
      body: {
        code: codeForStatus(status),
        message: Array.isArray(message) ? message.join('; ') : message,
        ...(typeof response === 'object'
          ? omit(response as Record<string, unknown>, ['message', 'statusCode', 'error'])
          : {}),
      },
    };
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { code: 'internal_error', message: 'something went wrong on our side' },
  };
}

function codeForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'unprocessable';
    default:
      return `http_${status}`;
  }
}

function omit(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([k]) => !keys.includes(k)));
}
