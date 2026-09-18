import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { from, Observable, of } from 'rxjs';
import { catchError, mergeMap, switchMap, tap } from 'rxjs/operators';
import { IdempotencyService, requestHash } from './idempotency.service';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const USER_HEADER = 'x-user-id';

/** Applies the idempotency-key protocol to a handler; the handler sees a normal request. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const key = header(request, IDEMPOTENCY_HEADER);
    const userId = header(request, USER_HEADER);
    if (!key || key.length > 128)
      throw new BadRequestException({
        code: 'idempotency_key_required',
        message: 'send an Idempotency-Key header (1–128 chars)',
      });
    if (!userId)
      throw new BadRequestException({ code: 'user_required', message: 'send an X-User-Id header' });
    const hash = requestHash(
      userId,
      request.method,
      request.url.split('?')[0] ?? request.url,
      request.body,
    );

    return from(this.idempotency.claim(userId, key, hash)).pipe(
      switchMap((claim) => {
        if (claim.kind === 'replay') {
          reply.status(claim.status);
          reply.header('idempotency-replayed', 'true');
          return of(claim.body);
        }
        return next.handle().pipe(
          mergeMap((body) =>
            from(this.idempotency.complete(userId, key, { status: reply.statusCode, body })).pipe(
              switchMap(() => of(body)),
            ),
          ),
          catchError((error: unknown) => {
            if (error instanceof HttpException && error.getStatus() < 500) {
              return from(
                this.idempotency.complete(userId, key, {
                  status: error.getStatus(),
                  body: error.getResponse(),
                }),
              ).pipe(
                tap(() => {
                  throw error;
                }),
              );
            }
            return from(this.idempotency.release(userId, key)).pipe(
              tap(() => {
                throw error;
              }),
            );
          }),
        );
      }),
    );
  }
}

function header(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
