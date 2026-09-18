import { Injectable } from '@nestjs/common';
import { NoCapacityError } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import {
  countOverlapping,
  insertHeld,
  type ReservedBooking,
  type ReserveInput,
  type ReserveStrategy,
} from './reserve.strategy';

/** A transaction-scoped advisory lock per resource: callers for the same resource queue up. */
@Injectable()
export class AdvisoryStrategy implements ReserveStrategy {
  readonly name = 'advisory' as const;

  constructor(private readonly prisma: PrismaService) {}

  reserve(input: ReserveInput): Promise<ReservedBooking> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.resource.id}))`;
      if ((await countOverlapping(tx, input)) >= input.resource.capacity) {
        throw new NoCapacityError(input.resource.id);
      }
      return insertHeld(tx, input);
    });
  }
}
