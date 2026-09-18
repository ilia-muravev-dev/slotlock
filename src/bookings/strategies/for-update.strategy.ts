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

/** Row lock on the resource: the same serialisation as the advisory lock, visible in the plan. */
@Injectable()
export class ForUpdateStrategy implements ReserveStrategy {
  readonly name = 'for_update' as const;

  constructor(private readonly prisma: PrismaService) {}

  reserve(input: ReserveInput): Promise<ReservedBooking> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM resources WHERE id = ${input.resource.id} FOR UPDATE`;
      if ((await countOverlapping(tx, input)) >= input.resource.capacity) {
        throw new NoCapacityError(input.resource.id);
      }
      return insertHeld(tx, input);
    });
  }
}
